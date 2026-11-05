import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApi } from './app.mjs';
import { loadConfig } from './config.mjs';
import { createSharedHub } from './shared.mjs';
import { openStore } from './store.mjs';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

const DOC = {
  version: 2,
  fileName: 'lab.nmap2flowchart.json',
  layers: [{ id: 'layer:main', name: 'Main', parentId: null, visible: true, color: '#4b9fff' }],
  nodes: [{ id: 'n1', kind: 'host', layerId: 'layer:main', position: { x: 0, y: 0 } }],
  edges: [],
  focusedLayerId: null,
};

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmap2flowchart-share-'));
  const config = {
    ...loadConfig({}),
    authEnabled: true,
    registrationEnabled: true,
    guestLoginEnabled: true,
    dbPath: path.join(dir, 'test.db'),
    registerRateMax: 100,
    maxProjectsPerUser: 50,
  };
  const store = openStore(config.dbPath);
  const hub = createSharedHub({ logger: LOGGER });
  const server = createApi({ config, store, hub, logger: LOGGER });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    store,
    async close() {
      hub.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      store.close();
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

async function signUp(base, username = 'owner') {
  const result = await call(base, '/api/auth/register', {
    method: 'POST',
    body: { username, password: 'Correct8HorseBattery' },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.token;
}

async function withProject(base) {
  const token = await signUp(base);
  const created = await call(base, '/api/projects', {
    method: 'POST',
    token,
    body: { name: 'Lab', doc: DOC },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return { token, project: created.body.project };
}

test('a share link exposes the project without signing in', async () => {
  const server = await startServer();
  try {
    const { token, project } = await withProject(server.base);
    assert.equal(project.share, null, 'projects start unshared');

    const shared = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'edit' },
    });
    assert.equal(shared.status, 200, JSON.stringify(shared.body));
    const shareUrl = shared.body.url;
    assert.match(shareUrl, /^\/s\/[A-Za-z0-9_-]{16,}$/);
    assert.equal(shared.body.project.share.mode, 'edit');

    const linkToken = shareUrl.replace('/s/', '');
    const publicView = await call(server.base, `/api/share/${linkToken}`);
    assert.equal(publicView.status, 200);
    assert.equal(publicView.body.enabled, true);
    assert.equal(publicView.body.title, 'Lab');
    assert.equal(publicView.body.mode, 'edit');
    assert.equal(publicView.body.doc.nodes.length, 1);
    assert.equal(publicView.body.revision, project.revision);

    // The owner sees the link on the project row, so the UI can show it.
    const listed = await call(server.base, '/api/projects', { token });
    assert.equal(listed.body.projects[0].share.mode, 'edit');

    const unknown = await call(server.base, '/api/share/not-a-real-token-at-all');
    assert.equal(unknown.status, 404);
  } finally {
    await server.close();
  }
});

test('share saves land in the project and are refused when stale', async () => {
  const server = await startServer();
  try {
    const { token, project } = await withProject(server.base);
    const shared = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'edit' },
    });
    const linkToken = shared.body.url.replace('/s/', '');

    const guest = await call(server.base, `/api/share/${linkToken}/join`, { method: 'POST', body: { name: 'Visitor' } });
    assert.equal(guest.status, 201);
    assert.equal(guest.body.mode, 'edit');
    assert.equal(guest.body.revision, project.revision);

    const edited = { ...DOC, nodes: [...DOC.nodes, { id: 'n2', kind: 'host', layerId: 'layer:main', position: { x: 40, y: 0 } }] };
    const saved = await call(server.base, `/api/share/${linkToken}`, {
      method: 'PUT',
      body: { id: guest.body.id, baseRevision: project.revision, doc: edited },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    // The owner reopens the project and sees the guest's drawing.
    const reopened = await call(server.base, `/api/projects/${project.id}`, { token });
    assert.equal(reopened.body.project.doc.nodes.length, 2);
    assert.equal(reopened.body.project.revision, project.revision + 1);

    const stale = await call(server.base, `/api/share/${linkToken}`, {
      method: 'PUT',
      body: { id: guest.body.id, baseRevision: project.revision, doc: DOC },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.doc.nodes.length, 2, 'the winning document comes back');

    const invalid = await call(server.base, `/api/share/${linkToken}`, {
      method: 'PUT',
      body: { id: guest.body.id, baseRevision: reopened.body.project.revision, doc: { version: 2 } },
    });
    assert.equal(invalid.status, 400);
  } finally {
    await server.close();
  }
});

test('a view-only link cannot be written through', async () => {
  const server = await startServer();
  try {
    const { token, project } = await withProject(server.base);
    const shared = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'view' },
    });
    const linkToken = shared.body.url.replace('/s/', '');

    const view = await call(server.base, `/api/share/${linkToken}`);
    assert.equal(view.body.mode, 'view');

    const guest = await call(server.base, `/api/share/${linkToken}/join`, { method: 'POST', body: {} });
    assert.equal(guest.body.mode, 'view');

    const attempt = await call(server.base, `/api/share/${linkToken}`, {
      method: 'PUT',
      body: { id: guest.body.id, baseRevision: view.body.revision, doc: DOC },
    });
    assert.equal(attempt.status, 403);
  } finally {
    await server.close();
  }
});

test('owners can rotate and switch off a link, and deletion retires it too', async () => {
  const server = await startServer();
  try {
    const { token, project } = await withProject(server.base);
    const first = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'edit' },
    });
    const firstToken = first.body.url.replace('/s/', '');

    // Switching who may edit keeps the same link.
    const demoted = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'view' },
    });
    assert.equal(demoted.body.url, `/s/${firstToken}`);
    assert.equal((await call(server.base, `/api/share/${firstToken}`)).body.mode, 'view');

    // Asking for a new link retires the old one.
    const rotated = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'view', rotate: true },
    });
    const secondToken = rotated.body.url.replace('/s/', '');
    assert.notEqual(firstToken, secondToken);
    assert.equal((await call(server.base, `/api/share/${firstToken}`)).status, 404, 'the old link is dead');
    assert.equal((await call(server.base, `/api/share/${secondToken}`)).status, 200);

    const removed = await call(server.base, `/api/projects/${project.id}/share`, { method: 'DELETE', token });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.project.share, null);
    assert.equal((await call(server.base, `/api/share/${secondToken}`)).status, 404);

    // Another user's project is not theirs to share.
    const otherToken = await signUp(server.base, 'intruder');
    const denied = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token: otherToken,
      body: { mode: 'edit' },
    });
    assert.equal(denied.status, 404);
  } finally {
    await server.close();
  }
});

test('deleting a project kills its share link', async () => {
  const server = await startServer();
  try {
    const { token, project } = await withProject(server.base);
    const shared = await call(server.base, `/api/projects/${project.id}/share`, {
      method: 'POST',
      token,
      body: { mode: 'edit' },
    });
    const linkToken = shared.body.url.replace('/s/', '');

    const deleted = await call(server.base, `/api/projects/${project.id}`, { method: 'DELETE', token });
    assert.equal(deleted.status, 204);
    assert.equal((await call(server.base, `/api/share/${linkToken}`)).status, 404);
  } finally {
    await server.close();
  }
});

test('share links need the accounts database', async () => {
  const config = { ...loadConfig({}), authEnabled: false };
  const server = createApi({ config, store: null, hub: createSharedHub({ logger: LOGGER }), logger: LOGGER });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const state = await call(base, '/api/share/abcdefghijklmnop');
    assert.equal(state.status, 404);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
