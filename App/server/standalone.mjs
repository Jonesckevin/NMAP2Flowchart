import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

import { BUILD_INFO, EMBEDDED_APP } from '#app-bundle';

import { createApiHandler } from './app.mjs';
import { appDatabasePath, appDataDir, loadConfig } from './config.mjs';
import { loggerFromConfig } from './log.mjs';
import { createSharedHub, createSharedStore } from './shared.mjs';
import { createAssetStore, createStaticHandler, decodeEmbeddedAssets } from './static.mjs';
import { openStore } from './store.mjs';

const HELP = `
${BUILD_INFO.name} ${BUILD_INFO.version} – nmap scans to network diagrams, offline.

Usage: ${BUILD_INFO.name} [options]

  --port <n>        Port to listen on (default 8080; 0 picks a free port)
  --host <address>  Interface to bind (default 127.0.0.1, this machine only)
  --open            Open the app in the default browser
  --no-open         Never open a browser
  --auth            Enable local accounts and project autosave
  --shared          Serve one diagram to everyone who connects (see below)
  --data-dir <dir>  Where the accounts database and shared diagram are kept
  -v, --version     Print the version and exit
  -h, --help        Print this help and exit

Shared mode keeps a single diagram on this server. Everyone who opens the URL
sees the same drawing, edits are broadcast live to the other browsers, and the
mouse of each connected person is drawn on the canvas. Anyone who can reach the
port can change the diagram – run it on a network you trust, and note that
--shared binds every interface unless --host says otherwise. The diagram lives
in <data-dir>/shared.json (or NMAP_SHARED_FILE); copy that file to take a copy.

The usual NMAP_* environment variables are honoured: NMAP_API_HOST,
NMAP_API_PORT, NMAP_DATA_DIR, NMAP_AUTH_ENABLED, NMAP_SHARED, NMAP_SHARED_FILE,
the account limits, and the risk levels shared with every browser
(NMAP_RISK_LEVELS as inline JSON, or NMAP_RISK_POLICY_FILE pointing at a JSON
file).
`;

const RUNTIME = `${process.platform}-${process.arch}`;

/** True in the bundle built by `npm run standalone:shared`. */
const SHARED_DEFAULT = globalThis.__N2F_SHARED_DEFAULT__ === true;

function defaultDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return appDataDir(
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    );
  }
  if (process.platform === 'darwin') {
    return appDataDir(path.join(home, 'Library', 'Application Support'));
  }
  return appDataDir(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'));
}

function parseCli(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        'data-dir': { type: 'string' },
        open: { type: 'boolean' },
        'no-open': { type: 'boolean' },
        auth: { type: 'boolean' },
        shared: { type: 'boolean' },
        'no-shared': { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    return values;
  } catch (error) {
    console.error(`${error.message}\n${HELP}`);
    process.exit(2);
  }
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`--port expects a number between 0 and 65535, got "${value}"`);
    process.exit(2);
  }
  return port;
}

function isApiRequest(rawUrl) {
  const pathname = rawUrl || '/';
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/api?');
}

function listen(server, host, preferredPort) {
  const attempts = preferredPort === 0 ? 1 : 20;
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryOnce = () => {
      const port = preferredPort === 0 ? 0 : preferredPort + attempt;
      const onError = (error) => {
        server.off('listening', onListening);
        if (error.code === 'EADDRINUSE' && attempt < attempts) {
          attempt += 1;
          tryOnce();
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    };
    tryOnce();
  });
}

function browserCommand(url) {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', 'start', '""', url], verbatim: true };
  }
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

function openBrowser(url) {
  const { command, args, verbatim } = browserCommand(url);
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: verbatim === true,
    });
    child.on('error', () => {
      console.log(`  (could not start a browser – open ${url} yourself)`);
    });
    child.unref();
  } catch {
    console.log(`  (could not start a browser – open ${url} yourself)`);
  }
}

async function main() {
  const values = parseCli(process.argv.slice(2));
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (values.version) {
    console.log(
      `${BUILD_INFO.name} ${BUILD_INFO.version} (${RUNTIME}, Node ${BUILD_INFO.nodeVersion}${
        BUILD_INFO.commit ? `, commit ${BUILD_INFO.commit}` : ''
      })`,
    );
    return;
  }

  const env = process.env;
  const defaults = loadConfig(env);
  const sharedEnabled =
    values['no-shared'] === true ? false : values.shared === true || SHARED_DEFAULT || defaults.sharedEnabled;
  const config = {
    ...defaults,
    authEnabled: values.auth === true || defaults.authEnabled,
    sharedEnabled,
    host:
      values.host ??
      (env.NMAP_API_HOST ? defaults.host : sharedEnabled ? '0.0.0.0' : '127.0.0.1'),
    port: values.port === undefined ? (env.NMAP_API_PORT ? defaults.port : 8080) : parsePort(values.port),
    dataDir: values['data-dir'] ?? (env.NMAP_DATA_DIR ? defaults.dataDir : defaultDataDir()),
  };
  config.dbPath = env.NMAP_DB_PATH || appDatabasePath(config.dataDir);
  config.sharedFile = defaults.sharedFile || path.join(config.dataDir, 'shared.json');

  const store = config.authEnabled ? openStore(config.dbPath) : null;
  if (store) {
    store.purgeExpired();
    const timer = setInterval(() => store.purgeExpired(), config.cleanupIntervalSeconds * 1000);
    timer.unref();
  }

  const logger = loggerFromConfig(config);
  const log = logger.child('server');
  // One hub for the whole process: the standalone room and every project share
  // link get their own room inside it.
  const hub = createSharedHub({ logger: log });
  const shared = config.sharedEnabled
    ? { store: createSharedStore({ filePath: config.sharedFile, logger: log }), hub }
    : null;

  const assets = createAssetStore(decodeEmbeddedAssets(EMBEDDED_APP));
  const staticHandler = createStaticHandler({ assets });
  const apiHandler = createApiHandler({ config, store, shared, hub, logger });

  const server = http.createServer((request, response) => {
    if (isApiRequest(request.url)) {
      apiHandler(request, response);
      return;
    }
    staticHandler(request, response);
  });

  let port;
  try {
    port = await listen(server, config.host, config.port);
  } catch (error) {
    store?.close();
    console.error(`Cannot listen on ${config.host}:${config.port} – ${error.message}`);
    process.exit(1);
  }

  const shownHost = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
  const url = `http://${shownHost.includes(':') ? `[${shownHost}]` : shownHost}:${port}/`;
  const lanUrls =
    config.host === '0.0.0.0' || config.host === '::'
      ? Object.values(os.networkInterfaces())
          .flat()
          .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
          .map((entry) => `http://${entry.address}:${port}/`)
      : [];

  console.log(`\n  ${BUILD_INFO.name} ${BUILD_INFO.version} · ${RUNTIME} · built ${BUILD_INFO.builtAt}`);
  console.log(`  ${assets.size} files embedded · no network access needed\n`);
  console.log(`  Open   ${url}`);
  for (const lanUrl of lanUrls) console.log(`         ${lanUrl}   (for everyone else)`);
  if (shared) {
    console.log('  Mode   shared · one diagram for everyone who opens this server');
    console.log(`         ${config.sharedFile}`);
    console.log('         anyone who can reach the port can edit it – trusted networks only');
  } else if (config.authEnabled) {
    console.log(`  Mode   accounts on · ${config.dbPath}`);
    console.log('         projects can be published with a share link from the Share button');
  } else {
    console.log('  Mode   browser storage only · nothing leaves this machine');
  }
  console.log(`  Logs   ${config.logLevel} (${config.logFormat}) · docker compose logs -f app`);
  console.log('  Stop   Ctrl+C\n');

  const autoOpen = values.open === true || (!shared && values['no-open'] !== true && process.stdout.isTTY);
  if (autoOpen) openBrowser(url);

  const shutdown = (signal) => {
    log.info('shutting down', { signal });
    shared?.hub.close();
    server.closeAllConnections?.();
    server.close(() => {
      store?.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('NMAP2Flowchart failed to start:', error);
  process.exit(1);
});
