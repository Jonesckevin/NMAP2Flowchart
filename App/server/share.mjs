import { clientIp } from './auth.mjs';
import { serializeDoc, validateDoc } from './doc.mjs';
import { HttpError, readJsonBody, sendEmpty, sendJson } from './http.mjs';
import { scopedLogger } from './log.mjs';

/**
 * Public share links for account projects.
 *
 * The owner turns a project into a room: `POST /api/projects/:id/share` returns a
 * token, and everyone who opens `/s/<token>` joins that room – seeing the drawing
 * and, unless the link is view-only, editing it live. Saves go into the owner's
 * project, so the work is still there the next time they open it.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function shareRoomId(token) {
  return `share:${token}`;
}

function roomState(store, token) {
  const project = store.projectByShareToken(token);
  if (!project) return null;
  return {
    project,
    doc: JSON.parse(project.docJson),
    revision: project.revision,
    updatedAt: project.updatedAt,
  };
}

export function createShareRoutes({ store, hub, config, logger = console }) {
  const log = scopedLogger(logger, 'share');
  const allow = (response, methods) => {
    response.setHeader('Allow', methods.join(', '));
    throw new HttpError(405, 'Method not allowed');
  };

  return async function handleShare(request, response, pathname, method) {
    const match = /^\/api\/share\/([^/]+)(\/[a-z]+)?$/.exec(pathname);
    if (!match) return false;

    const token = match[1];
    const action = match[2] ?? '';
    if (!TOKEN_RE.test(token)) throw new HttpError(404, 'That share link is not valid');

    const state = roomState(store, token);
    if (!state) throw new HttpError(404, 'That share link is not valid (it may have been switched off)');
    const { project } = state;
    const mode = project.share.mode === 'view' ? 'view' : 'edit';
    const roomId = shareRoomId(token);
    const base = {
      title: project.name,
      mode,
      revision: state.revision,
      updatedAt: state.updatedAt,
    };

    if (action === '') {
      if (method === 'GET') {
        sendJson(response, 200, {
          enabled: true,
          ...base,
          doc: state.doc,
          users: hub.users(roomId),
          maxBytes: config.maxProjectBytes,
        });
        return;
      }

      if (method === 'PUT') {
        if (mode === 'view') throw new HttpError(403, 'This link is view-only');
        const body = await readJsonBody(request, config.maxProjectBytes + 64 * 1024);
        const doc = validateDoc(body.doc);
        const size = serializeDoc(doc, config.maxProjectBytes);
        const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : -1;
        const saved = store.saveSharedProject(project.id, size, baseRevision);
        if (!saved.ok) {
          if (saved.reason === 'revoked') throw new HttpError(404, 'That share link has been switched off');
          if (saved.reason === 'stale') {
            sendJson(response, 409, {
              error: 'The diagram changed while you were editing',
              revision: saved.project.revision,
              updatedAt: saved.project.updatedAt,
              doc: JSON.parse(saved.project.docJson),
            });
            return;
          }
          throw new HttpError(404, 'That diagram is no longer there');
        }
        hub.broadcast(
          roomId,
          'change',
          {
            revision: saved.project.revision,
            updatedAt: saved.project.updatedAt,
            doc,
            from: typeof body.id === 'string' ? body.id : null,
          },
          { exceptId: typeof body.id === 'string' ? body.id : null },
        );
        log.debug('shared diagram saved', { project: project.id, revision: saved.project.revision });
        sendJson(response, 200, { revision: saved.project.revision, updatedAt: saved.project.updatedAt });
        return;
      }

      allow(response, ['GET', 'PUT']);
    }

    if (action === '/join') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 8 * 1024);
      const address = clientIp(request, config.trustProxy);
      const client = hub.join(roomId, {
        name: body.name,
        address,
        userAgent: request.headers['user-agent'],
      });
      const users = hub.count(roomId);
      if (users === 1) {
        log.info('share link opened', { project: project.id, mode, address, users });
      } else {
        log.debug('guest joined', { project: project.id, client: client.name, mode, address, users });
      }
      sendJson(response, 201, {
        enabled: true,
        ...client,
        ...base,
        doc: state.doc,
        users: hub.users(roomId),
      });
      return;
    }

    if (action === '/leave') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 8 * 1024);
      if (typeof body.id === 'string') {
        hub.drop(roomId, body.id);
        if (hub.count(roomId) === 0) log.info('share link closed', { project: project.id });
      }
      sendEmpty(response, 204);
      return;
    }

    if (action === '/events') {
      if (method !== 'GET') allow(response, ['GET']);
      const url = new URL(request.url || '/', 'http://localhost');
      const id = url.searchParams.get('id') || '';
      if (!hub.subscribe(roomId, id, request, response)) {
        sendJson(response, 404, { error: 'Unknown session – join again' });
        return;
      }
      response.write(
        `event: snapshot\ndata: ${JSON.stringify({
          revision: state.revision,
          updatedAt: state.updatedAt,
          doc: state.doc,
          users: hub.users(roomId),
        })}\n\n`,
      );
      return 'stream';
    }

    if (action === '/cursor') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 4 * 1024);
      if (typeof body.id === 'string') {
        hub.cursor(roomId, body.id, body.cursor && typeof body.cursor === 'object' ? body.cursor : null);
      }
      sendEmpty(response, 204);
      return;
    }

    if (action === '/name') {
      if (method !== 'POST') allow(response, ['POST']);
      const body = await readJsonBody(request, 4 * 1024);
      const user = typeof body.id === 'string' ? hub.rename(roomId, body.id, body.name) : null;
      if (!user) throw new HttpError(404, 'Unknown session');
      sendJson(response, 200, { user });
      return;
    }

    throw new HttpError(404, 'Not found');
  };
}
