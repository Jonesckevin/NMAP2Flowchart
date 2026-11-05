import assert from 'node:assert/strict';
import test from 'node:test';

import { createLogger, normalizeFormat, normalizeLevel } from './log.mjs';

function collector({ level = 'info', format = 'text', scope } = {}) {
  const out = [];
  const err = [];
  const logger = createLogger({
    level,
    format,
    scope,
    stdout: { write: (chunk) => out.push(String(chunk).trimEnd()) },
    stderr: { write: (chunk) => err.push(String(chunk).trimEnd()) },
  });
  return { logger, out, err };
}

test('levels filter and defaults', () => {
  assert.equal(normalizeLevel(undefined), 'info');
  assert.equal(normalizeLevel('DEBUG'), 'debug');
  assert.equal(normalizeLevel('loud'), 'info');
  assert.equal(normalizeFormat('JSON'), 'json');
  assert.equal(normalizeFormat('xml'), 'text');

  const { logger, out, err } = collector();
  logger.debug('ignored');
  logger.info('kept');
  logger.warn('careful');
  logger.error('broken');
  assert.deepEqual(
    out.map((line) => line.split(' ')[1]),
    ['INFO'],
  );
  assert.deepEqual(
    err.map((line) => line.split(' ')[1]),
    ['WARN', 'ERROR'],
  );
  assert.match(out[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO {2}kept$/);
});

test('level=debug shows everything, level=error shows only errors', () => {
  const debug = collector({ level: 'debug' });
  debug.logger.debug('detail');
  assert.equal(debug.out.length, 1);

  const quiet = collector({ level: 'error' });
  quiet.logger.info('hidden');
  quiet.logger.warn('hidden');
  quiet.logger.error('shown');
  assert.deepEqual(quiet.out, []);
  assert.equal(quiet.err.length, 1);
});

test('fields and scope are readable, and absent fields are skipped', () => {
  const { logger, out } = collector({ scope: 'accounts' });
  logger.info('login', { user: 'alice', ip: '10.0.0.5', count: 3, missing: undefined, blank: '' });
  assert.equal(out[0].split(' ').slice(2).join(' ').trimStart(), 'accounts: login  user=alice ip=10.0.0.5 count=3');
});

test('json format is one object per line', () => {
  const { logger, out } = collector({ format: 'json', scope: 'shared' });
  logger.info('room opened', { room: 'abc', users: 2 });
  const record = JSON.parse(out[0]);
  assert.equal(record.level, 'info');
  assert.equal(record.scope, 'shared');
  assert.equal(record.msg, 'room opened');
  assert.equal(record.room, 'abc');
  assert.match(record.time, /^\d{4}-\d{2}-\d{2}T/);
});

test('child loggers keep the level and format', () => {
  const { logger, out } = collector({ level: 'debug' });
  const child = logger.child('share');
  child.debug('pointer moved', { room: 'x' });
  assert.match(out[0], /DEBUG share: pointer moved  room=x/);
});
