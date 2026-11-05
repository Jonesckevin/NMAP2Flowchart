import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { clientIp } from './auth.mjs';
import { serializeDoc, validateDoc } from './doc.mjs';
import { HttpError, readJsonBody, sendEmpty, sendJson } from './http.mjs';
import { scopedLogger } from './log.mjs';

/**
 * Presence and live document sync for rooms.
 *
 * A room is one document that several browsers are looking at: the standalone
 * `--shared` server has a single room, and every project share link gets one of
 * its own. Edits carry the revision they were built on, so a stale writer is
 * refused with the current document instead of silently dropping someone's work.
 */
const COLORS = ['#2fd6a5', '#4b9fff', '#f0a25c', '#c084fc', '#f472b6', '#facc15', '#38bdf8', '#fb7185'];
const MAX_NAME = 40;
const CURSOR_INTERVAL_MS = 60;
const HEARTBEAT_MS = 20_000;

/** The one diagram a `--shared` server hands to every browser that connects. */
export function createSharedStore({ filePath, logger = console }) {
  let state = { revision: 0, updatedAt: 0, doc: null };

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed.revision === 'number' && parsed.doc && typeof parsed.doc === 'object') {
      state = { revision: parsed.revision, updatedAt: Number(parsed.updatedAt) || 0, doc: parsed.doc };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn?.(`could not read ${filePath} – ${error.message}`);
  }

  function persist(next) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...next }));
    fs.renameSync(tmp, filePath);
  }

  return {
    filePath,
    get: () => state,
    save(doc, baseRevision) {
      if (baseRevision !== state.revision) return { ok: false, state };
      const next = { revision: state.revision + 1, updatedAt: Date.now(), doc };
      persist(next);
      state = next;
      return { ok: true, state };
    },
  };
}

/**
 * Who is connected to which room, plus the event stream that keeps them in sync.
 * A client is "here" while its stream is open – closing the tab is enough to
 * disappear from the list.
 */
export function createSharedHub({ logger = console } = {}) {
  const rooms = new Map();
  let guestNumber = 0;
  let heartbeat = null;

  function clientsOf(roomId) {
    return rooms.get(roomId) ?? new Map();
  }

  function ensureRoom(roomId) {
    let clients = rooms.get(roomId);
    if (!clients) {
      clients = new Map();
      rooms.set(roomId, clients);
    }
    return clients;
  }

  const list = (roomId) =>
    [...clientsOf(roomId).values()]
      .sort((a, b) => a.since - b.since)
      .map((client) => ({
        id: client.id,
        name: client.name,
        color: client.color,
        address: client.address,
        since: client.since,
        cursor: client.cursor,
      }));

  function write(client, event, data) {
    try {
      client.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      drop(client.roomId, client.id);
    }
  }

  function broadcast(roomId, event, data, { exceptId = null } = {}) {
    for (const client of clientsOf(roomId).values()) {
      if (client.id === exceptId || !client.response) continue;
      write(client, event, data);
    }
  }

  function presence(roomId) {
    const users = list(roomId);
    broadcast(roomId, 'presence', { users, count: users.length });
    return users;
  }

  function drop(roomId, id) {
    const clients = clientsOf(roomId);
    const client = clients.get(id);
    if (!client) return;
    clients.delete(id);
    try {
      client.response?.end();
    } catch {
      // The socket is already gone.
    }
    if (clients.size === 0) rooms.delete(roomId);
    presence(roomId);
  }

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    const printable = [...value]
      .filter((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 0x20 && code !== 0x7f;
      })
      .join('');
    return printable.trim().slice(0, MAX_NAME);
  }

  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const [roomId, clients] of rooms) {
        for (const client of clients.values()) {
          try {
            client.response.write(': ping\n\n');
          } catch {
            drop(roomId, client.id);
          }
        }
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
  }

  return {
    users: list,
    count: (roomId) => clientsOf(roomId).size,
    roomCount: () => rooms.size,
    broadcast,
    presence,

    join(roomId, { name, address, userAgent }) {
      guestNumber += 1;
      const id = crypto.randomBytes(9).toString('base64url');
      const client = {
        id,
        roomId,
        name: cleanName(name) || `Guest ${guestNumber}`,
        color: COLORS[(guestNumber - 1) % COLORS.length],
        address: address || '',
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 200) : '',
        since: Date.now(),
        cursor: null,
        response: null,
      };
      ensureRoom(roomId).set(id, client);
      presence(roomId);
      return { id: client.id, name: client.name, color: client.color };
    },

    rename(roomId, id, name) {
      const client = clientsOf(roomId).get(id);
      if (!client) return null;
      const next = cleanName(name);
      if (next) client.name = next;
      presence(roomId);
      return { id: client.id, name: client.name, color: client.color };
    },

    cursor(roomId, id, point) {
      const client = clientsOf(roomId).get(id);
      if (!client) return;
      const now = Date.now();
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        client.cursor = { x: Math.round(point.x), y: Math.round(point.y) };
      } else {
        client.cursor = null;
      }
      if (now - (client.cursorAt ?? 0) < CURSOR_INTERVAL_MS) return;
      client.cursorAt = now;
      broadcast(roomId, 'cursor', { id: client.id, cursor: client.cursor }, { exceptId: id });
    },

    subscribe(roomId, id, request, response) {
      const client = clientsOf(roomId).get(id);
      if (!client) return false;

      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.write(': connected\n\n');
      client.response = response;
      request.socket?.setNoDelay?.(true);

      const goodbye = () => drop(roomId, id);
      request.on('close', goodbye);
      request.on('error', goodbye);
      response.on('error', goodbye);
      presence(roomId);
      return true;
    },

    /** Ends every stream in a room, e.g. when a share link is switched off. */
    closeRoom(roomId) {
      for (const client of [...clientsOf(roomId).values()]) {
        try {
          write(client, 'closed', { reason: 'sharing-stopped' });
        } catch {
          // The stream is already gone.
        }
        drop(roomId, client.id);
      }
      rooms.delete(roomId);
    },

    drop,
    close() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      for (const [roomId, clients] of [...rooms]) {
        for (const client of [...clients.values()]) drop(roomId, client.id);
      }
      rooms.clear();
    },
    logger,
  };
}

const SHARED_ROOM = 'shared';

/**
 * `/api/shared` and friends – the standalone shared server. Only mounted when the
 * server was started in shared mode; a normal build answers `{enabled:false}`.
 */
export function createSharedRoutes({ shared, config, logger = console }) {
  const allow = (response, methods) => {
    response.setHeader('Allow', methods.join(', '));
    throw new HttpError(405, 'Method not allowed');
  };
  const log = scopedLogger(logger, 'shared');

  return async function handleShared(request, response, pathname, method) {
    if (!shared) {
      if (pathname === '/api/shared' && method === 'GET') {
        sendJson(response, 200, { enabled: false });
        return;
      }
      throw new HttpError(404, 'Shared mode is not enabled on this server');
    }

    const { store, hub } = shared;

    if (pathname === '/api/shared') {
      if (method === 'GET') {
        const state = store.get();
        sendJson(response, 200, {
          enabled: true,
          revision: state.revision,
          updatedAt: state.updatedAt,
          doc: state.doc,
          users: hub.users(SHARED_ROOM),
          maxBytes: config.maxProjectBytes,
        });
        return;
      }

      if (method === 'PUT') {
        const body = await readJsonBody(request, config.maxProjectBytes + 64 * 1024);
        const doc = validateDoc(body.doc);
        serializeDoc(doc, config.maxProjectBytes);
        const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : -1;
        const result = store.save(doc, baseRevision);
        if (!result.ok) {
          sendJson(response, 409, {
            error: 'The diagram changed while you were editing',
            revision: result.state.revision,
            updatedAt: result.state.updatedAt,
            doc: result.state.doc,
          });
          return;
        }
        hub.broadcast(
          SHARED_ROOM,
          'change',
          {
            revision: result.state.revision,
            updatedAt: result.state.updatedAt,
            doc,
            from: typeof body.id === 'string' ? body.id : null,
          },
          { exceptId: typeof body.id === 'string' ? body.id : null },
        );
        log.debug('diagram saved', { revision: result.state.revision, nodes: doc.nodes.length });
        sendJson(response, 200, { revision: result.state.revision, updatedAt: result.state.updatedAt });
        return;
      }

      allow(response, ['GET', 'PUT']);
    }

    if (pathname === '/api/shared/join') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 8 * 1024);
      const address = clientIp(request, config.trustProxy);
      const client = hub.join(SHARED_ROOM, {
        name: body.name,
        address,
        userAgent: request.headers['user-agent'],
      });
      const state = store.get();
      const users = hub.count(SHARED_ROOM);
      if (users === 1) log.info('shared session opened', { address });
      else log.debug('browser joined', { client: client.name, address, users });
      sendJson(response, 201, {
        enabled: true,
        ...client,
        revision: state.revision,
        updatedAt: state.updatedAt,
        doc: state.doc,
        users: hub.users(SHARED_ROOM),
      });
      return;
    }

    if (pathname === '/api/shared/leave') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 8 * 1024);
      if (typeof body.id === 'string') hub.drop(SHARED_ROOM, body.id);
      sendEmpty(response, 204);
      return;
    }

    if (pathname === '/api/shared/events') {
      if (method !== 'GET') allow(response, ['GET']);
      const url = new URL(request.url || '/', 'http://localhost');
      const id = url.searchParams.get('id') || '';
      const state = store.get();
      const ok = hub.subscribe(SHARED_ROOM, id, request, response);
      if (!ok) {
        sendJson(response, 404, { error: 'Unknown session – join again' });
        return;
      }
      response.write(
        `event: snapshot\ndata: ${JSON.stringify({
          revision: state.revision,
          updatedAt: state.updatedAt,
          doc: state.doc,
          users: hub.users(SHARED_ROOM),
        })}\n\n`,
      );
      return 'stream';
    }

    if (pathname === '/api/shared/cursor') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 4 * 1024);
      if (typeof body.id === 'string') {
        hub.cursor(SHARED_ROOM, body.id, body.cursor && typeof body.cursor === 'object' ? body.cursor : null);
      }
      sendEmpty(response, 204);
      return;
    }

    if (pathname === '/api/shared/name') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 4 * 1024);
      const user = typeof body.id === 'string' ? hub.rename(SHARED_ROOM, body.id, body.name) : null;
      if (!user) throw new HttpError(404, 'Unknown session');
      sendJson(response, 200, { user });
      return;
    }

    throw new HttpError(404, 'Not found');
  };
}
