import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApi } from './app.mjs';
import { loadConfig } from './config.mjs';
import { createSharedHub, createSharedStore } from './shared.mjs';

const LOGGER = { info() {}, warn() {}, error() {} };

const DOC = {
  version: 2,
  fileName: 'scan.nmap2flowchart.json',
  layers: [{ id: 'layer:main', name: 'Main', parentId: null, visible: true, color: '#4b9fff' }],
  nodes: [{ id: 'n1', kind: 'host', layerId: 'layer:main', position: { x: 0, y: 0 } }],
  edges: [],
  focusedLayerId: null,
};

async function startServer({ enabled = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmap2flowchart-shared-'));
  const config = {
    ...loadConfig({}),
    authEnabled: false,
    dataDir: dir,
    sharedEnabled: enabled,
    sharedFile: path.join(dir, 'shared.json'),
  };
  const shared = enabled
    ? { store: createSharedStore({ filePath: config.sharedFile, logger: LOGGER }), hub: createSharedHub({ logger: LOGGER }) }
    : null;
  const server = createApi({ config, shared, logger: LOGGER });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    dir,
    config,
    shared,
    async close() {
      shared?.hub.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function call(base, route, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Collects server-sent events so a test can wait for a specific one. */
function openStream(base, id) {
  const controller = new AbortController();
  const events = [];
  const waiters = [];
  let buffer = '';

  const push = (event, data) => {
    const entry = { event, data };
    events.push(entry);
    for (const waiter of [...waiters]) {
      if (waiter.match(entry)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(entry);
      }
    }
  };

  const ready = (async () => {
    const response = await fetch(`${base}/api/shared/events?id=${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            let name = 'message';
            let payload = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) name = line.slice(6).trim();
              else if (line.startsWith('data:')) payload += line.slice(5).trim();
            }
            if (payload) push(name, JSON.parse(payload));
          }
        }
      } catch {
        // Aborted by the test.
      }
    })();
    return { ok: true, status: response.status };
  })();

  return {
    ready,
    events,
    next(event, predicate = () => true, timeoutMs = 3000) {
      const matches = (entry) => entry.event === event && !entry.seen && predicate(entry.data);
      const existing = events.find(matches);
      if (existing) {
        existing.seen = true;
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
        waiters.push({
          match: matches,
          resolve: (entry) => {
            clearTimeout(timer);
            entry.seen = true;
            resolve(entry);
          },
        });
      });
    },
    close() {
      controller.abort();
    },
  };
}

test('shared mode is advertised and joined by every visitor', async () => {
  const server = await startServer();
  try {
    const state = await call(server.base, '/api/shared');
    assert.equal(state.status, 200);
    assert.equal(state.body.enabled, true);
    assert.equal(state.body.doc, null);
    assert.equal(state.body.revision, 0);

    const alice = await call(server.base, '/api/shared/join', { method: 'POST', body: { name: 'Alice' } });
    assert.equal(alice.status, 201);
    assert.equal(alice.body.name, 'Alice');
    assert.ok(alice.body.id);
    assert.match(alice.body.color, /^#[0-9a-f]{6}$/i);

    const bob = await call(server.base, '/api/shared/join', { method: 'POST', body: {} });
    assert.equal(bob.status, 201);
    assert.match(bob.body.name, /^Guest \d+$/);
    assert.notEqual(bob.body.id, alice.body.id);

    const users = (await call(server.base, '/api/shared')).body.users;
    assert.equal(users.length, 2);
    assert.deepEqual(
      users.map((user) => user.name),
      ['Alice', bob.body.name],
    );
    assert.equal(users[0].address, '127.0.0.1');

    // The config endpoint tells the browser to expect a shared diagram.
    const config = await call(server.base, '/api/config');
    assert.equal(config.body.sharedEnabled, true);
  } finally {
    await server.close();
  }
});

test('a save is broadcast, refused when stale, and persisted to disk', async () => {
  const server = await startServer();
  try {
    const alice = (await call(server.base, '/api/shared/join', { method: 'POST', body: { name: 'Alice' } })).body;
    const bob = (await call(server.base, '/api/shared/join', { method: 'POST', body: { name: 'Bob' } })).body;
    const aliceStream = openStream(server.base, alice.id);
    const bobStream = openStream(server.base, bob.id);
    await aliceStream.ready;
    await bobStream.ready;
    await aliceStream.next('snapshot');
    await bobStream.next('snapshot');

    const first = await call(server.base, '/api/shared', {
      method: 'PUT',
      body: { id: alice.id, baseRevision: 0, doc: DOC },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.revision, 1);

    const change = await bobStream.next('change');
    assert.equal(change.data.revision, 1);
    assert.equal(change.data.from, alice.id);
    assert.equal(change.data.doc.nodes.length, 1);

    // Alice does not get her own save echoed back.
    assert.equal(
      aliceStream.events.some((entry) => entry.event === 'change'),
      false,
    );

    // Bob still believes the revision is 0 – his save must not win silently.
    const stale = await call(server.base, '/api/shared', {
      method: 'PUT',
      body: { id: bob.id, baseRevision: 0, doc: { ...DOC, fileName: 'bob.json' } },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.doc.fileName, 'scan.nmap2flowchart.json');
    assert.equal(stale.body.revision, 1);

    const afterBob = await call(server.base, '/api/shared', {
      method: 'PUT',
      body: { id: bob.id, baseRevision: 1, doc: { ...DOC, fileName: 'bob.json' } },
    });
    assert.equal(afterBob.status, 200);
    assert.equal(afterBob.body.revision, 2);

    const stored = JSON.parse(fs.readFileSync(server.config.sharedFile, 'utf8'));
    assert.equal(stored.revision, 2);
    assert.equal(stored.doc.fileName, 'bob.json');

    aliceStream.close();
    bobStream.close();
  } finally {
    await server.close();
  }
});

test('presence, cursors and names reach the other browsers', async () => {
  const server = await startServer();
  try {
    const alice = (await call(server.base, '/api/shared/join', { method: 'POST', body: { name: 'Alice' } })).body;
    const stream = openStream(server.base, alice.id);
    await stream.ready;
    await stream.next('snapshot');

    const bob = (await call(server.base, '/api/shared/join', { method: 'POST', body: { name: 'Bob' } })).body;
    const presence = await stream.next('presence', (data) => data.count === 2);
    assert.equal(presence.data.count, 2);
    assert.deepEqual(
      presence.data.users.map((user) => user.name),
      ['Alice', 'Bob'],
    );

    const bobStream = openStream(server.base, bob.id);
    await bobStream.ready;
    await bobStream.next('snapshot');

    await call(server.base, '/api/shared/cursor', {
      method: 'POST',
      body: { id: bob.id, cursor: { x: 120, y: 88 } },
    });
    const cursor = await stream.next('cursor');
    assert.equal(cursor.data.id, bob.id);
    assert.deepEqual(cursor.data.cursor, { x: 120, y: 88 });

    // A cursor leaving the canvas clears it for everyone else.
    await new Promise((resolve) => setTimeout(resolve, 80));
    await call(server.base, '/api/shared/cursor', { method: 'POST', body: { id: bob.id, cursor: null } });
    const cleared = await stream.next('cursor');
    assert.equal(cleared.data.cursor, null);

    const renamed = await call(server.base, '/api/shared/name', {
      method: 'POST',
      body: { id: bob.id, name: 'Bob (workshop)' },
    });
    assert.equal(renamed.body.user.name, 'Bob (workshop)');
    const renamedPresence = await stream.next('presence', (data) => data.users.some((user) => user.name === 'Bob (workshop)'));
    assert.equal(renamedPresence.data.users[1].name, 'Bob (workshop)');

    // Closing a browser removes it from the list.
    bobStream.close();
    const gone = await stream.next('presence', (data) => data.count === 1);
    assert.equal(gone.data.count, 1);

    stream.close();
  } finally {
    await server.close();
  }
});

test('leaving, bad documents and unknown sessions are rejected', async () => {
  const server = await startServer();
  try {
    const alice = (await call(server.base, '/api/shared/join', { method: 'POST', body: { name: 'Alice' } })).body;

    const invalid = await call(server.base, '/api/shared', {
      method: 'PUT',
      body: { id: alice.id, baseRevision: 0, doc: { version: 1 } },
    });
    assert.equal(invalid.status, 400);

    const noBody = await call(server.base, '/api/shared', { method: 'PUT', body: {} });
    assert.equal(noBody.status, 400);

    const unknownName = await call(server.base, '/api/shared/name', {
      method: 'POST',
      body: { id: 'nope', name: 'X' },
    });
    assert.equal(unknownName.status, 404);

    const left = await call(server.base, '/api/shared/leave', { method: 'POST', body: { id: alice.id } });
    assert.equal(left.status, 204);
    assert.equal((await call(server.base, '/api/shared')).body.users.length, 0);

    const unknownStream = await fetch(`${server.base}/api/shared/events?id=missing`);
    assert.equal(unknownStream.status, 404);
    await unknownStream.text();
  } finally {
    await server.close();
  }
});

test('a plain server keeps shared mode switched off', async () => {
  const server = await startServer({ enabled: false });
  try {
    const state = await call(server.base, '/api/shared');
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { enabled: false });

    const join = await call(server.base, '/api/shared/join', { method: 'POST', body: {} });
    assert.equal(join.status, 404);

    const config = await call(server.base, '/api/config');
    assert.equal(config.body.sharedEnabled, false);
  } finally {
    await server.close();
  }
});

test('the diagram survives a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmap2flowchart-shared-restart-'));
  const filePath = path.join(dir, 'shared.json');
  try {
    const first = createSharedStore({ filePath, logger: LOGGER });
    assert.equal(first.get().doc, null);
    assert.equal(first.save(DOC, 0).ok, true);

    const second = createSharedStore({ filePath, logger: LOGGER });
    assert.equal(second.get().revision, 1);
    assert.equal(second.get().doc.fileName, DOC.fileName);

    // The reloaded revision keeps guarding against stale writers.
    assert.equal(second.save({ ...DOC, fileName: 'stale.json' }, 0).ok, false);
    assert.equal(second.save({ ...DOC, fileName: 'next.json' }, 1).ok, true);
    assert.equal(createSharedStore({ filePath, logger: LOGGER }).get().doc.fileName, 'next.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
