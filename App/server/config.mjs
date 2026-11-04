import fs from 'node:fs';
import path from 'node:path';
import { loadRiskPolicy } from './risk.mjs';

export const APP_SLUG = 'nmap2flowchart';
export const LEGACY_APP_SLUG = 'nmap2flowio';

function bool(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env = process.env) {
  return {
    authEnabled: bool(env.NMAP_AUTH_ENABLED, false),
    registrationEnabled: bool(env.NMAP_ALLOW_REGISTRATION, true),
    guestLoginEnabled: bool(env.NMAP_ALLOW_GUEST, true),
    trustProxy: bool(env.NMAP_TRUST_PROXY, false),

    host: env.NMAP_API_HOST || '0.0.0.0',
    port: positive(env.NMAP_API_PORT, 8090),
    dataDir: env.NMAP_DATA_DIR || 'data',
    dbPath: env.NMAP_DB_PATH || null,

    sessionTtlHours: positive(env.NMAP_SESSION_TTL_HOURS, 24 * 30),
    guestTtlHours: positive(env.NMAP_GUEST_TTL_HOURS, 24),
    maxProjectBytes: Math.round(positive(env.NMAP_MAX_PROJECT_MB, 16) * 1024 * 1024),
    maxProjectsPerUser: Math.round(positive(env.NMAP_MAX_PROJECTS, 200)),

    loginRateMax: Math.round(positive(env.NMAP_LOGIN_RATE_MAX, 5)),
    loginRateWindowSeconds: positive(env.NMAP_LOGIN_RATE_WINDOW, 900),
    registerRateMax: Math.round(positive(env.NMAP_REGISTER_RATE_MAX, 3)),
    registerRateWindowSeconds: positive(env.NMAP_REGISTER_RATE_WINDOW, 3600),
    cleanupIntervalSeconds: positive(env.NMAP_CLEANUP_INTERVAL, 3600),

    // Instance-wide risk levels, from NMAP_RISK_LEVELS (JSON) or
    // NMAP_RISK_POLICY_FILE (path). `null` means "let each browser use its
    // built-in defaults"; accounts and diagrams can still override it.
    riskPolicy: loadRiskPolicy(env),
  };
}

function migratePath(from, to) {
  if (from === to) return;
  try {
    if (fs.existsSync(to) || !fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } catch {
    // A locked or read-only legacy path just means this run starts a fresh one.
  }
}

/** SQLite file for `dataDir`, adopting a database written before the rename. */
export function appDatabasePath(dataDir) {
  const dbPath = path.join(dataDir, `${APP_SLUG}.db`);
  migratePath(path.join(dataDir, `${LEGACY_APP_SLUG}.db`), dbPath);
  return dbPath;
}

/** `<baseDir>/nmap2flowchart`, adopting the pre-rename `<baseDir>/nmap2flowio` folder. */
export function appDataDir(baseDir) {
  const dataDir = path.join(baseDir, APP_SLUG);
  migratePath(path.join(baseDir, LEGACY_APP_SLUG), dataDir);
  return dataDir;
}
