/**
 * Server logging for container output.
 *
 * Everything goes to stdout/stderr, which is where Docker collects it
 * (`docker compose logs -f api`); nothing is written to a file, so a read-only
 * container keeps working. Levels are ordered; the default `info` reports the
 * big-picture events – sign-in, sessions, projects, shares, room activity –
 * and `debug` adds per-request detail.
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];

const LEVEL_RANK = { error: 0, warn: 1, info: 2, debug: 3 };

export function normalizeLevel(value, fallback = 'info') {
  const level = String(value ?? '').trim().toLowerCase();
  return LEVEL_RANK[level] === undefined ? fallback : level;
}

export function normalizeFormat(value) {
  return String(value ?? '').trim().toLowerCase() === 'json' ? 'json' : 'text';
}

function fieldsToString(fields) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return parts.join(' ');
}

/**
 * @param {{ level?: string, format?: 'text'|'json', stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream, scope?: string }} options
 */
export function createLogger(options = {}) {
  const level = normalizeLevel(options.level);
  const format = normalizeFormat(options.format);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const scope = options.scope ?? '';

  const threshold = LEVEL_RANK[level];

  function emit(entryLevel, message, fields = {}) {
    if (LEVEL_RANK[entryLevel] > threshold) return;
    const time = new Date().toISOString();
    const record = { time, level: entryLevel, msg: String(message) };
    if (scope) record.scope = scope;
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) record[key] = value;
    }
    const stream = entryLevel === 'error' || entryLevel === 'warn' ? stderr : stdout;
    if (format === 'json') {
      stream.write(`${JSON.stringify(record)}\n`);
      return;
    }
    const rest = fieldsToString({ ...fields, scope: undefined });
    const prefix = scope ? `${scope}: ` : '';
    stream.write(
      `${time} ${entryLevel.toUpperCase().padEnd(5)} ${prefix}${message}${rest ? `  ${rest}` : ''}\n`,
    );
  }

  return {
    level,
    format,
    error: (message, fields) => emit('error', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    info: (message, fields) => emit('info', message, fields),
    debug: (message, fields) => emit('debug', message, fields),
    /** A logger tagged with a subsystem, e.g. `logger.child('accounts')`. */
    child(childScope) {
      return createLogger({ level, format, stdout, stderr, scope: childScope });
    },
  };
}

export function loggerFromConfig(config) {
  return createLogger({ level: config.logLevel, format: config.logFormat });
}

/**
 * A logger-like object with every level, even when the caller passed a partial
 * one (tests and embedders do).
 */
export function scopedLogger(logger, scope) {
  if (logger?.child) return logger.child(scope);
  const noop = () => {};
  return {
    error: logger?.error?.bind(logger) ?? noop,
    warn: logger?.warn?.bind(logger) ?? noop,
    info: logger?.info?.bind(logger) ?? noop,
    debug: logger?.debug?.bind(logger) ?? noop,
  };
}
