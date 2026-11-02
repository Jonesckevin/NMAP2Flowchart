import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clientIp } from './auth.mjs';
import { createApi } from './app.mjs';
import { loadConfig } from './config.mjs';
import { openStore } from './store.mjs';

const LOGGER = { info() {}, warn() {}, error() {} };

const DOC = {
  version: 2,
  fileName: 'scan.nmap2flowchart.json',
  layers: [{ id: 'layer:main', name: 'Main', parentId: null, visible: true, color: '#4b9fff' }],
  nodes: [{ id: 'n1', kind: 'host', layerId: 'layer:main', position: { x: 0, y: 0 } }],
  edges: [],
  focusedLayerId: null,
};

async function startApi(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmap2flowchart-api-'));
  const config = {
    ...loadConfig({}),
    authEnabled: true,
    dbPath: path.join(dir, 'test.db'),
    registerRateMax: 100,
    ...overrides,
  };
  const store = config.authEnabled ? openStore(config.dbPath) : null;
  const server = createApi({ config, store, logger: LOGGER });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    config,
    store,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      store?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function call(base, route, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function register(base, username, password = 'correct-horse-9B') {
  const result = await call(base, '/api/auth/register', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

test('accounts are disabled unless NMAP_AUTH_ENABLED is set', async () => {
  const api = await startApi({ authEnabled: false });
  try {
    const config = await call(api.base, '/api/config');
    assert.equal(config.status, 200);
    assert.equal(config.body.authEnabled, false);
    assert.equal(config.body.registrationEnabled, false);
    assert.equal(config.body.guestLoginEnabled, false);

    assert.equal((await call(api.base, '/api/auth/login', { method: 'POST', body: {} })).status, 404);
    assert.equal((await call(api.base, '/api/auth/guest', { method: 'POST' })).status, 404);
    assert.equal((await call(api.base, '/api/projects')).status, 404);
    assert.equal(api.store, null);
  } finally {
    await api.close();
  }
});

test('registers, authenticates, restores and revokes a session', async () => {
  const api = await startApi();
  try {
    const created = await register(api.base, 'alice');
    assert.equal(created.user.username, 'alice');
    assert.equal(created.user.isGuest, false);
    assert.equal(created.user.role, 'admin');
    assert.equal(typeof created.token, 'string');
    assert.ok(created.expiresAt > Date.now());

    const me = await call(api.base, '/api/auth/me', { token: created.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.userId, created.user.userId);

    const login = await call(api.base, '/api/auth/login', {
      method: 'POST',
      body: { username: 'alice', password: 'correct-horse-9B' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.username, 'alice');

    assert.equal((await call(api.base, '/api/auth/logout', { method: 'POST', token: login.body.token })).status, 200);
    assert.equal((await call(api.base, '/api/auth/me', { token: login.body.token })).status, 401);
    assert.equal((await call(api.base, '/api/auth/me')).status, 401);
  } finally {
    await api.close();
  }
});

test('rejects duplicate usernames, weak passwords and unknown users', async () => {
  const api = await startApi();
  try {
    await register(api.base, 'bob');
    const duplicate = await call(api.base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'BOB', password: 'correct-horse-9B' },
    });
    assert.equal(duplicate.status, 400);
    assert.match(duplicate.body.error, /already exists/i);

    const weak = await call(api.base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'charlie', password: 'short' },
    });
    assert.equal(weak.status, 400);

    const login = await call(api.base, '/api/auth/login', {
      method: 'POST',
      body: { username: 'nobody', password: 'correct-horse-9B' },
    });
    assert.equal(login.status, 401);
  } finally {
    await api.close();
  }
});

test('rate limits repeated failed logins', async () => {
  const api = await startApi({ loginRateMax: 2 });
  try {
    await register(api.base, 'dana');
    const attempt = () =>
      call(api.base, '/api/auth/login', {
        method: 'POST',
        body: { username: 'dana', password: 'wrong-password-1A' },
      });
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 429);
  } finally {
    await api.close();
  }
});

test('guest sessions are allowed only when the feature is on', async () => {
  const api = await startApi({ guestLoginEnabled: false });
  try {
    assert.equal((await call(api.base, '/api/auth/guest', { method: 'POST' })).status, 404);

    const enabled = await startApi({ guestLoginEnabled: true });
    try {
      const guest = await call(enabled.base, '/api/auth/guest', { method: 'POST' });
      assert.equal(guest.status, 201);
      assert.equal(guest.body.user.isGuest, true);
      assert.match(guest.body.user.username, /^guest-/);

      const project = await call(enabled.base, '/api/projects', {
        method: 'POST',
        token: guest.body.token,
        body: { name: 'Guest diagram', doc: DOC },
      });
      assert.equal(project.status, 201);

      enabled.store.purgeExpired(Date.now() + 48 * 3600_000);
      assert.equal((await call(enabled.base, '/api/projects', { token: guest.body.token })).status, 401);
    } finally {
      await enabled.close();
    }
  } finally {
    await api.close();
  }
});

test('creates, lists, opens, renames and deletes projects', async () => {
  const api = await startApi();
  try {
    const { token } = await register(api.base, 'erin');

    const created = await call(api.base, '/api/projects', {
      method: 'POST',
      token,
      body: { name: '  Lab   network  ', doc: DOC },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.name, 'Lab network');
    assert.equal(created.body.project.nodeCount, 1);
    assert.equal(created.body.project.edgeCount, 0);
    assert.equal(created.body.project.doc, undefined);

    const id = created.body.project.id;
    const list = await call(api.base, '/api/projects', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.projects.length, 1);

    const opened = await call(api.base, `/api/projects/${id}`, { token });
    assert.equal(opened.status, 200);
    assert.deepEqual(opened.body.project.doc, DOC);
    assert.equal(opened.body.project.docJson, undefined);

    const renamed = await call(api.base, `/api/projects/${id}`, {
      method: 'PUT',
      token,
      body: { name: 'Home lab' },
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.project.name, 'Home lab');

    const updatedDoc = { ...DOC, fileName: 'second.xml', nodes: [...DOC.nodes, { ...DOC.nodes[0], id: 'n2' }] };
    const updated = await call(api.base, `/api/projects/${id}`, {
      method: 'PUT',
      token,
      body: { doc: updatedDoc },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.project.name, 'Home lab');
    assert.equal(updated.body.project.nodeCount, 2);

    assert.equal((await call(api.base, `/api/projects/${id}`, { method: 'DELETE', token })).status, 204);
    assert.equal((await call(api.base, `/api/projects/${id}`, { token })).status, 404);
    assert.equal((await call(api.base, '/api/projects', { token })).body.projects.length, 0);
  } finally {
    await api.close();
  }
});

test('keeps projects private to their owner', async () => {
  const api = await startApi();
  try {
    const alice = await register(api.base, 'alice2');
    const bob = await register(api.base, 'bob2');

    const created = await call(api.base, '/api/projects', {
      method: 'POST',
      token: alice.token,
      body: { name: 'Alice only', doc: DOC },
    });
    const id = created.body.project.id;

    assert.equal((await call(api.base, `/api/projects/${id}`, { token: bob.token })).status, 404);
    assert.equal((await call(api.base, `/api/projects/${id}`, { method: 'DELETE', token: bob.token })).status, 404);
    assert.equal(
      (await call(api.base, `/api/projects/${id}`, { method: 'PUT', token: bob.token, body: { name: 'x' } })).status,
      404,
    );
    assert.equal((await call(api.base, '/api/projects', { token: bob.token })).body.projects.length, 0);
    assert.equal((await call(api.base, `/api/projects/${id}`, { token: alice.token })).status, 200);
  } finally {
    await api.close();
  }
});

test('uses the proxy-appended address so rate-limit keys cannot be spoofed', () => {
  const socket = { remoteAddress: '172.18.0.1' };
  assert.equal(
    clientIp({ headers: { 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '10.9.9.9, 203.0.113.5' }, socket }, true),
    '203.0.113.5',
  );
  assert.equal(
    clientIp({ headers: { 'x-forwarded-for': '10.9.9.9, 203.0.113.5' }, socket }, true),
    '203.0.113.5',
  );
  assert.equal(clientIp({ headers: { 'x-real-ip': '203.0.113.5' }, socket }, false), '172.18.0.1');
});

test('rejects malformed diagrams and missing payloads', async () => {
  const api = await startApi();
  try {
    const { token } = await register(api.base, 'frank');
    const noDoc = await call(api.base, '/api/projects', { method: 'POST', token, body: { name: 'x' } });
    assert.equal(noDoc.status, 400);

    const wrongVersion = await call(api.base, '/api/projects', {
      method: 'POST',
      token,
      body: { name: 'x', doc: { ...DOC, version: 1 } },
    });
    assert.equal(wrongVersion.status, 400);

    const noNodes = await call(api.base, '/api/projects', {
      method: 'POST',
      token,
      body: { name: 'x', doc: { ...DOC, nodes: 'nope' } },
    });
    assert.equal(noNodes.status, 400);

    assert.equal((await call(api.base, '/api/projects', { method: 'POST', token })).status, 400);
  } finally {
    await api.close();
  }
});
