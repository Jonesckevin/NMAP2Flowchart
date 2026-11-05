import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { openStore } from './store.mjs';

/** The projects table as the first release created it – no share columns yet. */
const OLD_SCHEMA = `
  CREATE TABLE users (
    user_id       TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    is_guest      INTEGER NOT NULL DEFAULT 0,
    expires_at    INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    doc_json    TEXT NOT NULL,
    node_count  INTEGER NOT NULL DEFAULT 0,
    edge_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE preferences (
    user_id    TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    risk_json  TEXT,
    updated_at INTEGER NOT NULL
  );
`;

function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmap2flowchart-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return path.join(dir, 'upgrade.db');
}

test('openStore upgrades a database created by the first release', (t) => {
  const file = tempDb(t);

  const old = new DatabaseSync(file);
  old.exec(OLD_SCHEMA);
  old
    .prepare(
      `INSERT INTO users (user_id, username, email, password_hash, role, is_guest, expires_at, created_at, updated_at)
       VALUES ('u1', 'alice', NULL, 'x', 'user', 0, NULL, 1, 1)`,
    )
    .run();
  old
    .prepare(
      `INSERT INTO projects (id, user_id, name, doc_json, node_count, edge_count, created_at, updated_at)
       VALUES ('p1', 'u1', 'Lab', '{"version":2}', 1, 0, 1, 1)`,
    )
    .run();
  old.close();

  const store = openStore(file);
  try {
    const projects = store.listProjects('u1');
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'Lab');
    assert.equal(projects[0].revision, 1);
    assert.equal(projects[0].share, null);

    // The unique index that used to abort the schema run now exists, so a share
    // token can be set and looked up on the upgraded rows.
    store.setProjectShare('u1', 'p1', { token: 'tok-1', mode: 'edit' });
    assert.equal(store.projectByShareToken('tok-1')?.id, 'p1');
  } finally {
    store.close();
  }
});

test('openStore keeps working on a database that is already current', (t) => {
  const file = tempDb(t);

  const first = openStore(file);
  const user = first.createUser({ username: 'bob', email: null, passwordHash: 'x', role: 'admin' });
  first.close();

  const second = openStore(file);
  try {
    assert.equal(second.listProjects(user.userId).length, 0);
  } finally {
    second.close();
  }
});
