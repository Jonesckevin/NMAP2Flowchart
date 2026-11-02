import { appDatabasePath, loadConfig } from './config.mjs';
import { openStore } from './store.mjs';
import { createApi } from './app.mjs';

const config = loadConfig();
const dbPath = config.dbPath || appDatabasePath(config.dataDir);
const store = config.authEnabled ? openStore(dbPath) : null;
const server = createApi({ config, store });

if (store) {
  const purged = store.purgeExpired();
  if (purged.guests > 0 || purged.sessions > 0) {
    console.log(`accounts: purged ${purged.sessions} expired sessions and ${purged.guests} expired guests`);
  }
  const timer = setInterval(
    () => {
      const result = store.purgeExpired();
      if (result.guests > 0) console.log(`accounts: purged ${result.guests} expired guests`);
    },
    config.cleanupIntervalSeconds * 1000,
  );
  timer.unref();
}

server.listen(config.port, config.host, () => {
  console.log(
    `accounts API listening on ${config.host}:${config.port} (auth ${config.authEnabled ? 'ENABLED' : 'disabled'})`,
  );
  if (config.authEnabled) {
    console.log(`accounts: database ${dbPath}`);
    console.log(
      `accounts: registration ${config.registrationEnabled ? 'on' : 'off'}, guest login ${
        config.guestLoginEnabled ? 'on' : 'off'
      }`,
    );
  }
});

function shutdown(signal) {
  console.log(`accounts: ${signal} received, shutting down`);
  server.close(() => {
    store?.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
