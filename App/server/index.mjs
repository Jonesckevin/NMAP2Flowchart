import path from 'node:path';

import { appDatabasePath, loadConfig } from './config.mjs';
import { loggerFromConfig } from './log.mjs';
import { openStore } from './store.mjs';
import { createSharedHub, createSharedStore } from './shared.mjs';
import { createApi } from './app.mjs';

const config = loadConfig();
const logger = loggerFromConfig(config);
const log = logger.child('api');
const dbPath = config.dbPath || appDatabasePath(config.dataDir);
const store = config.authEnabled ? openStore(dbPath) : null;
config.sharedFile = config.sharedFile || path.join(config.dataDir, 'shared.json');
const hub = createSharedHub({ logger: log });
const shared = config.sharedEnabled
  ? { store: createSharedStore({ filePath: config.sharedFile, logger: log }), hub }
  : null;
const server = createApi({ config, store, shared, hub, logger });

if (store) {
  const purged = store.purgeExpired();
  if (purged.guests > 0 || purged.sessions > 0) {
    log.info('purged expired sessions', { sessions: purged.sessions, guests: purged.guests });
  }
  const timer = setInterval(() => {
    const result = store.purgeExpired();
    if (result.guests > 0 || result.sessions > 0) {
      log.debug('purged expired sessions', { sessions: result.sessions, guests: result.guests });
    }
  }, config.cleanupIntervalSeconds * 1000);
  timer.unref();
}

server.listen(config.port, config.host, () => {
  log.info('listening', {
    host: config.host,
    port: config.port,
    auth: config.authEnabled ? 'enabled' : 'disabled',
    shared: config.sharedEnabled ? 'enabled' : 'disabled',
    level: config.logLevel,
  });
  if (shared) log.info('shared diagram', { file: config.sharedFile });
  if (config.authEnabled) {
    log.info('accounts', {
      database: dbPath,
      registration: config.registrationEnabled ? 'on' : 'off',
      guestLogin: config.guestLoginEnabled ? 'on' : 'off',
    });
  }
});

function shutdown(signal) {
  log.info('shutting down', { signal });
  hub.close();
  server.close(() => {
    store?.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
