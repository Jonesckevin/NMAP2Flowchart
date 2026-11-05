import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
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

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    doc_json    TEXT NOT NULL,
    node_count  INTEGER NOT NULL DEFAULT 0,
    edge_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    revision    INTEGER NOT NULL DEFAULT 1,
    share_token TEXT,
    share_mode  TEXT,
    share_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS preferences (
    user_id    TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    risk_json  TEXT,
    updated_at INTEGER NOT NULL
  );
`;

/**
 * Indexes are created after the column migrations: a database from an older
 * release has the tables but not the columns they cover, and `CREATE INDEX` on
 * a missing column aborts the whole schema run.
 */
const INDEXES = `
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS projects_share ON projects(share_token);
`;

export class DuplicateUserError extends Error {
  constructor() {
    super('Username already exists');
    this.name = 'DuplicateUserError';
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    role: row.role,
    isGuest: row.is_guest === 1,
    createdAt: row.created_at,
  };
}

function projectSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nodeCount: row.node_count,
    edgeCount: row.edge_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision ?? 1,
    share: row.share_token
      ? { token: row.share_token, mode: row.share_mode === 'view' ? 'view' : 'edit', since: row.share_at ?? 0 }
      : null,
  };
}

/** Columns added after the first release; adopted on an existing database. */
const PROJECT_COLUMNS = [
  ['revision', 'INTEGER NOT NULL DEFAULT 1'],
  ['share_token', 'TEXT'],
  ['share_mode', 'TEXT'],
  ['share_at', 'INTEGER'],
];

function migrateProjectColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(projects)').all().map((column) => column.name));
  for (const [name, type] of PROJECT_COLUMNS) {
    if (existing.has(name)) continue;
    db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${type}`);
  }
}

export class Store {
  constructor(db) {
    this.db = db;
    this.statements = {
      userById: db.prepare('SELECT * FROM users WHERE user_id = ?'),
      userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
      insertUser: db.prepare(
        `INSERT INTO users (user_id, username, email, password_hash, role, is_guest, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      countUsers: db.prepare('SELECT COUNT(*) AS total FROM users'),
      insertSession: db.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
      ),
      sessionUser: db.prepare(
        `SELECT s.token_hash, s.expires_at AS session_expires, u.*
         FROM sessions s JOIN users u ON u.user_id = s.user_id
         WHERE s.token_hash = ?`,
      ),
      touchSession: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?'),
      deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
      deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
      deleteExpiredGuests: db.prepare(
        'DELETE FROM users WHERE is_guest = 1 AND expires_at IS NOT NULL AND expires_at <= ?',
      ),
      listProjects: db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC'),
      countProjects: db.prepare('SELECT COUNT(*) AS total FROM projects WHERE user_id = ?'),
      getProject: db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?'),
      getProjectById: db.prepare('SELECT * FROM projects WHERE id = ?'),
      getProjectByShare: db.prepare('SELECT * FROM projects WHERE share_token = ?'),
      insertProject: db.prepare(
        `INSERT INTO projects (id, user_id, name, doc_json, node_count, edge_count, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ),
      renameProject: db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?'),
      updateProjectDoc: db.prepare(
        `UPDATE projects SET doc_json = ?, node_count = ?, edge_count = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND user_id = ?`,
      ),
      updateProjectDocById: db.prepare(
        `UPDATE projects SET doc_json = ?, node_count = ?, edge_count = ?, updated_at = ?, revision = revision + 1
         WHERE id = ?`,
      ),
      updateProjectDocIfRevision: db.prepare(
        `UPDATE projects SET doc_json = ?, node_count = ?, edge_count = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND revision = ?`,
      ),
      setProjectShare: db.prepare(
        'UPDATE projects SET share_token = ?, share_mode = ?, share_at = ? WHERE id = ? AND user_id = ?',
      ),
      clearProjectShare: db.prepare('UPDATE projects SET share_token = NULL, share_mode = NULL, share_at = NULL WHERE id = ? AND user_id = ?'),
      deleteProject: db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?'),
      getPreferences: db.prepare('SELECT risk_json, updated_at FROM preferences WHERE user_id = ?'),
      savePreferences: db.prepare(
        `INSERT INTO preferences (user_id, risk_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET risk_json = excluded.risk_json, updated_at = excluded.updated_at`,
      ),
      deletePreferences: db.prepare('DELETE FROM preferences WHERE user_id = ?'),
    };
  }

  close() {
    this.db.close();
  }


  countUsers() {
    return this.statements.countUsers.get().total;
  }

  findUserById(userId) {
    return publicUser(this.statements.userById.get(userId));
  }

  findUserByUsername(username) {
    return publicUser(this.statements.userByName.get(username));
  }

  credentialsFor(username) {
    return this.statements.userByName.get(username) ?? null;
  }

  createUser({ username, email, passwordHash, role = 'user', isGuest = false, expiresAt = null, now = Date.now() }) {
    const userId = randomUUID();
    try {
      this.statements.insertUser.run(
        userId,
        username,
        email ?? null,
        passwordHash,
        role,
        isGuest ? 1 : 0,
        expiresAt,
        now,
        now,
      );
    } catch (error) {
      if (String(error?.message ?? '').includes('UNIQUE')) throw new DuplicateUserError();
      throw error;
    }
    return publicUser(this.statements.userById.get(userId));
  }

  createGuest(now = Date.now(), ttlMs = 24 * 3600_000) {
    const username = `guest-${randomBytes(4).toString('hex')}`;
    return this.createUser({
      username,
      passwordHash: 'guest$no-password',
      role: 'guest',
      isGuest: true,
      expiresAt: now + ttlMs,
      now,
    });
  }


  createSession(userId, tokenHash, ttlMs, now = Date.now()) {
    const expiresAt = now + ttlMs;
    this.statements.insertSession.run(tokenHash, userId, now, expiresAt, now);
    return expiresAt;
  }

  sessionUser(tokenHash, now = Date.now()) {
    const row = this.statements.sessionUser.get(tokenHash);
    if (!row) return null;
    if (row.session_expires <= now) {
      this.statements.deleteSession.run(tokenHash);
      return null;
    }
    if (row.is_guest === 1 && row.expires_at !== null && row.expires_at <= now) {
      this.statements.deleteSession.run(tokenHash);
      return null;
    }
    this.statements.touchSession.run(now, tokenHash);
    return publicUser(row);
  }

  revokeSession(tokenHash) {
    this.statements.deleteSession.run(tokenHash);
  }

  purgeExpired(now = Date.now()) {
    const sessions = this.statements.deleteExpiredSessions.run(now).changes;
    const guests = this.statements.deleteExpiredGuests.run(now).changes;
    return { sessions, guests };
  }


  listProjects(userId) {
    return this.statements.listProjects.all(userId).map(projectSummary);
  }

  countProjects(userId) {
    return this.statements.countProjects.get(userId).total;
  }

  getProject(userId, id) {
    const row = this.statements.getProject.get(id, userId);
    if (!row) return null;
    return { ...projectSummary(row), docJson: row.doc_json };
  }

  createProject(userId, { name, docJson, nodeCount, edgeCount }, now = Date.now()) {
    const id = randomUUID();
    this.statements.insertProject.run(id, userId, name, docJson, nodeCount, edgeCount, now, now);
    return projectSummary(this.statements.getProject.get(id, userId));
  }

  renameProject(userId, id, name, now = Date.now()) {
    const result = this.statements.renameProject.run(name, now, id, userId);
    if (result.changes === 0) return null;
    return projectSummary(this.statements.getProject.get(id, userId));
  }

  updateProjectDoc(userId, id, { docJson, nodeCount, edgeCount }, now = Date.now()) {
    const result = this.statements.updateProjectDoc.run(docJson, nodeCount, edgeCount, now, id, userId);
    if (result.changes === 0) return null;
    return projectSummary(this.statements.getProject.get(id, userId));
  }

  /**
   * Writes a document through a share link, where there is no owning session.
   * The revision guard is what lets two browsers on the same link edit without
   * one silently dropping the other's drawing.
   */
  saveSharedProject(id, { docJson, nodeCount, edgeCount }, baseRevision, now = Date.now()) {
    const row = this.statements.getProjectById.get(id);
    if (!row) return { ok: false, reason: 'missing' };
    if (row.share_token === null) return { ok: false, reason: 'revoked' };
    if (baseRevision !== row.revision) return { ok: false, reason: 'stale', project: this.projectFromRow(row) };
    this.statements.updateProjectDocIfRevision.run(docJson, nodeCount, edgeCount, now, id, row.revision);
    return { ok: true, project: this.projectFromRow(this.statements.getProjectById.get(id)) };
  }

  /** The project behind a share token, or null when the link was revoked. */
  projectByShareToken(token) {
    const row = this.statements.getProjectByShare.get(token);
    return row ? this.projectFromRow(row) : null;
  }

  projectById(id) {
    const row = this.statements.getProjectById.get(id);
    return row ? this.projectFromRow(row) : null;
  }

  projectFromRow(row) {
    if (!row) return null;
    return { ...projectSummary(row), docJson: row.doc_json, userId: row.user_id };
  }

  setProjectShare(userId, id, { token, mode }, now = Date.now()) {
    const result = this.statements.setProjectShare.run(token, mode, now, id, userId);
    if (result.changes === 0) return null;
    return projectSummary(this.statements.getProject.get(id, userId));
  }

  clearProjectShare(userId, id) {
    const result = this.statements.clearProjectShare.run(id, userId);
    if (result.changes === 0) return null;
    return projectSummary(this.statements.getProject.get(id, userId));
  }

  deleteProject(userId, id) {
    return this.statements.deleteProject.run(id, userId).changes > 0;
  }

  /** Stored JSON text of the account's risk policy, or null. */
  getRiskPreference(userId) {
    const row = this.statements.getPreferences.get(userId);
    return row?.risk_json ?? null;
  }

  setRiskPreference(userId, riskJson, now = Date.now()) {
    this.statements.savePreferences.run(userId, riskJson ?? null, now);
  }

  clearRiskPreference(userId) {
    this.statements.deletePreferences.run(userId);
  }
}

export function openStore(dbPath) {
  const directory = path.dirname(dbPath);
  if (directory && directory !== '.') fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrateProjectColumns(db);
  db.exec(INDEXES);
  return new Store(db);
}
