import crypto from 'node:crypto';
import http from 'node:http';
import {
  clientIp,
  createRateLimiter,
  hashPassword,
  hashToken,
  newSessionToken,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth.mjs';
import {
  applySecurityHeaders,
  bearerToken,
  HttpError,
  readJsonBody,
  sendEmpty,
  sendJson,
} from './http.mjs';
import { DuplicateUserError } from './store.mjs';
import { sanitizeRiskPolicy } from './risk.mjs';
import { serializeDoc, validateDoc } from './doc.mjs';
import { createSharedRoutes } from './shared.mjs';
import { createShareRoutes, shareRoomId } from './share.mjs';
import { scopedLogger } from './log.mjs';

const PROJECT_ID_RE = /^[0-9a-fA-F-]{36}$/;
const MAX_NAME_LENGTH = 80;

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, message);
  return value;
}

function validateProjectName(value, { fallback = null } = {}) {
  if (value === undefined && fallback !== null) return fallback;
  if (typeof value !== 'string') throw new HttpError(400, 'Project name must be a string');
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0) throw new HttpError(400, 'Project name cannot be empty');
  if (name.length > MAX_NAME_LENGTH) {
    throw new HttpError(400, `Project name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

export function createApiHandler({ config, store, shared = null, hub = null, logger = console }) {
  const loginLimiter = createRateLimiter({
    max: config.loginRateMax,
    windowSeconds: config.loginRateWindowSeconds,
  });
  const registerLimiter = createRateLimiter({
    max: config.registerRateMax,
    windowSeconds: config.registerRateWindowSeconds,
  });

  const sessionTtlMs = config.sessionTtlHours * 3600_000;
  const guestTtlMs = config.guestTtlHours * 3600_000;
  const roomHub = hub ?? shared?.hub ?? null;
  const handleShared = createSharedRoutes({ shared, config, logger });
  const handleShare = store && roomHub ? createShareRoutes({ store, hub: roomHub, config, logger }) : null;
  const log = scopedLogger(logger, 'accounts');

  function requireEnabled() {
    if (!config.authEnabled || !store) throw new HttpError(404, 'Accounts are disabled');
  }

  function authenticate(request) {
    const token = bearerToken(request);
    if (!token) throw new HttpError(401, 'Authentication required');
    const tokenHash = hashToken(token);
    const user = store.sessionUser(tokenHash);
    if (!user) throw new HttpError(401, 'Authentication required');
    return { user, tokenHash };
  }

  function issueSession(user) {
    const token = newSessionToken();
    const expiresAt = store.createSession(user.userId, hashToken(token), sessionTtlMs);
    return { user, token, expiresAt };
  }

  function serializeDocForAccount(doc) {
    return serializeDoc(doc, config.maxProjectBytes);
  }

  async function route(request, response, pathname) {
    const method = request.method || 'GET';
    const allow = (methods) => {
      response.setHeader('Allow', methods.join(', '));
      throw new HttpError(405, 'Method not allowed');
    };

    if (pathname === '/api/health') {
      if (method !== 'GET') allow(['GET']);
      sendJson(response, 200, { ok: true, authEnabled: config.authEnabled, sharedEnabled: Boolean(shared) });
      return;
    }

    if (pathname === '/api/config') {
      if (method !== 'GET') allow(['GET']);
      sendJson(response, 200, {
        authEnabled: config.authEnabled,
        registrationEnabled: config.authEnabled && config.registrationEnabled,
        guestLoginEnabled: config.authEnabled && config.guestLoginEnabled,
        guestTtlHours: config.authEnabled ? config.guestTtlHours : 0,
        maxProjectBytes: config.maxProjectBytes,
        // One diagram for everyone who opens this server (shared mode).
        sharedEnabled: Boolean(shared),
        // Instance-wide risk levels (NMAP_RISK_LEVELS / NMAP_RISK_POLICY_FILE).
        // Served even with accounts off, because it only shapes the diagram.
        risk: config.riskPolicy ?? null,
        version: 1,
      });
      return;
    }

    if (pathname === '/api/shared' || pathname.startsWith('/api/shared/')) {
      await handleShared(request, response, pathname, method);
      return;
    }

    if (pathname === '/api/share' || pathname.startsWith('/api/share/')) {
      if (!handleShare) throw new HttpError(404, 'Share links need the accounts database');
      const handled = await handleShare(request, response, pathname, method);
      if (handled === false) throw new HttpError(404, 'Not found');
      return;
    }


    if (pathname === '/api/auth/register') {
      if (method !== 'POST') allow(['POST']);
      requireEnabled();
      if (!config.registrationEnabled) throw new HttpError(404, 'Registration is disabled');
      const ip = clientIp(request, config.trustProxy);
      if (!registerLimiter.ok(ip)) {
        throw new HttpError(429, 'Too many registration attempts, please try again later');
      }
      registerLimiter.fail(ip);
      const body = requireObject(await readJsonBody(request, 64 * 1024), 'Request body must be an object');
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const usernameError = validateUsername(username);
      if (usernameError) throw new HttpError(400, usernameError);
      const passwordError = validatePassword(body.password);
      if (passwordError) throw new HttpError(400, passwordError);
      const emailError = validateEmail(body.email);
      if (emailError) throw new HttpError(400, emailError);
      const passwordHash = await hashPassword(body.password);
      let user;
      try {
        user = store.createUser({
          username,
          email: typeof body.email === 'string' ? body.email.trim() : null,
          passwordHash,
          role: store.countUsers() === 0 ? 'admin' : 'user',
        });
      } catch (error) {
        if (error instanceof DuplicateUserError) throw new HttpError(400, 'Username already exists');
        throw error;
      }
      log.info('account registered', { user: username, role: user.role, address: ip });
      sendJson(response, 201, issueSession(user));
      return;
    }

    if (pathname === '/api/auth/login') {
      if (method !== 'POST') allow(['POST']);
      requireEnabled();
      const ip = clientIp(request, config.trustProxy);
      if (!loginLimiter.ok(ip)) throw new HttpError(429, 'Too many login attempts, please try again later');
      const body = requireObject(await readJsonBody(request, 64 * 1024), 'Request body must be an object');
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const row = username ? store.credentialsFor(username) : null;
      const valid =
        row !== null &&
        row.is_guest !== 1 &&
        (row.expires_at === null || row.expires_at > Date.now()) &&
        (await verifyPassword(body.password, row.password_hash));
      if (!valid) {
        loginLimiter.fail(ip);
        log.warn('login failed', { user: username || '(empty)', address: ip });
        throw new HttpError(401, 'Invalid username or password');
      }
      loginLimiter.reset(ip);
      const user = store.findUserById(row.user_id);
      log.info('login', { user: user.username, address: ip });
      sendJson(response, 200, issueSession(user));
      return;
    }

    if (pathname === '/api/auth/guest') {
      if (method !== 'POST') allow(['POST']);
      requireEnabled();
      if (!config.guestLoginEnabled) throw new HttpError(404, 'Guest access is disabled');
      const ip = clientIp(request, config.trustProxy);
      if (!registerLimiter.ok(ip)) {
        throw new HttpError(429, 'Too many guest sessions, please try again later');
      }
      registerLimiter.fail(ip);
      const user = store.createGuest(Date.now(), guestTtlMs);
      log.info('guest session started', { user: user.username, address: ip });
      sendJson(response, 201, issueSession(user));
      return;
    }

    if (pathname === '/api/auth/me') {
      if (method !== 'GET') allow(['GET']);
      requireEnabled();
      const { user } = authenticate(request);
      sendJson(response, 200, { user });
      return;
    }

    if (pathname === '/api/auth/logout') {
      if (method !== 'POST') allow(['POST']);
      requireEnabled();
      const token = bearerToken(request);
      if (token) {
        const session = store.sessionUser(hashToken(token));
        store.revokeSession(hashToken(token));
        log.info('logout', { user: session?.username ?? '(expired)' });
      }
      sendJson(response, 200, { ok: true });
      return;
    }


    if (pathname === '/api/preferences') {
      requireEnabled();
      const { user } = authenticate(request);

      if (method === 'GET') {
        const riskJson = store.getRiskPreference(user.userId);
        let risk = null;
        if (riskJson) {
          try {
            risk = sanitizeRiskPolicy(JSON.parse(riskJson));
          } catch {
            risk = null;
          }
        }
        sendJson(response, 200, { risk });
        return;
      }

      if (method === 'PUT') {
        const body = requireObject(
          await readJsonBody(request, 64 * 1024),
          'Request body must be an object',
        );
        if (!('risk' in body)) throw new HttpError(400, 'Provide a risk policy or null to clear it');
        if (body.risk === null) {
          store.clearRiskPreference(user.userId);
          sendJson(response, 200, { risk: null });
          return;
        }
        const risk = sanitizeRiskPolicy(body.risk);
        if (!risk) throw new HttpError(400, 'Invalid risk policy');
        store.setRiskPreference(user.userId, JSON.stringify(risk));
        sendJson(response, 200, { risk });
        return;
      }

      allow(['GET', 'PUT']);
    }

    if (pathname === '/api/projects') {
      requireEnabled();
      const { user } = authenticate(request);

      if (method === 'GET') {
        sendJson(response, 200, { projects: store.listProjects(user.userId) });
        return;
      }

      if (method === 'POST') {
        const body = requireObject(
          await readJsonBody(request, config.maxProjectBytes + 64 * 1024),
          'Request body must be an object',
        );
        const name = validateProjectName(body.name, { fallback: 'Untitled project' });
        const doc = validateDoc(body.doc);
        if (store.countProjects(user.userId) >= config.maxProjectsPerUser) {
          throw new HttpError(409, `Account project limit reached (${config.maxProjectsPerUser})`);
        }
        const project = store.createProject(user.userId, { name, ...serializeDocForAccount(doc) });
        log.info('project created', { project: project.id, name: project.name, user: user.username, nodes: project.nodeCount });
        sendJson(response, 201, { project });
        return;
      }

      allow(['GET', 'POST']);
    }

    const shareMatch = /^\/api\/projects\/([^/]+)\/share$/.exec(pathname);
    if (shareMatch) {
      requireEnabled();
      const { user } = authenticate(request);
      const id = shareMatch[1];
      if (!PROJECT_ID_RE.test(id)) throw new HttpError(404, 'Project not found');

      if (method === 'POST') {
        const existing = store.getProject(user.userId, id);
        if (!existing) throw new HttpError(404, 'Project not found');
        const body = requireObject(await readJsonBody(request, 8 * 1024), 'Request body must be an object');
        const mode = body.mode === 'view' ? 'view' : 'edit';
        // Changing who can edit keeps the link; `rotate` retires it and mints a new one.
        const keep = existing.share && body.rotate !== true ? existing.share.token : null;
        const token = keep ?? crypto.randomBytes(18).toString('base64url');
        const project = store.setProjectShare(user.userId, id, { token, mode });
        if (!project) throw new HttpError(404, 'Project not found');
        if (keep === null && existing.share) roomHub?.closeRoom(shareRoomId(existing.share.token));
        log.info('share link created', { project: id, name: project.name, mode, user: user.username, rotated: keep === null });
        sendJson(response, 200, { project, url: `/s/${token}` });
        return;
      }

      if (method === 'DELETE') {
        const existing = store.getProject(user.userId, id);
        if (!existing) throw new HttpError(404, 'Project not found');
        const project = store.clearProjectShare(user.userId, id);
        if (existing.share) roomHub?.closeRoom(shareRoomId(existing.share.token));
        log.info('share link removed', { project: id, name: project.name, user: user.username });
        sendJson(response, 200, { project });
        return;
      }

      allow(['POST', 'DELETE']);
    }

    const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
    if (projectMatch) {
      requireEnabled();
      const { user } = authenticate(request);
      const id = projectMatch[1];
      if (!PROJECT_ID_RE.test(id)) throw new HttpError(404, 'Project not found');

      if (method === 'GET') {
        const project = store.getProject(user.userId, id);
        if (!project) throw new HttpError(404, 'Project not found');
        const { docJson, ...summary } = project;
        sendJson(response, 200, { project: { ...summary, doc: JSON.parse(docJson) } });
        return;
      }

      if (method === 'PUT') {
        const body = requireObject(
          await readJsonBody(request, config.maxProjectBytes + 64 * 1024),
          'Request body must be an object',
        );
        const hasName = body.name !== undefined;
        const hasDoc = body.doc !== undefined;
        if (!hasName && !hasDoc) throw new HttpError(400, 'Provide a name or a document to update');

        let project;
        if (hasName) {
          project = store.renameProject(user.userId, id, validateProjectName(body.name));
          if (!project) throw new HttpError(404, 'Project not found');
          log.info('project renamed', { project: id, name: project.name, user: user.username });
        }
        if (hasDoc) {
          project = store.updateProjectDoc(user.userId, id, serializeDocForAccount(validateDoc(body.doc)));
          if (!project) throw new HttpError(404, 'Project not found');
          // People on the share link are looking at this project; show them the edit.
          if (project.share) {
            roomHub?.broadcast(shareRoomId(project.share.token), 'change', {
              revision: project.revision,
              updatedAt: project.updatedAt,
              doc: body.doc,
              from: null,
            });
          }
        }
        sendJson(response, 200, { project });
        return;
      }

      if (method === 'DELETE') {
        const existing = store.getProject(user.userId, id);
        if (!store.deleteProject(user.userId, id)) throw new HttpError(404, 'Project not found');
        if (existing?.share) roomHub?.closeRoom(shareRoomId(existing.share.token));
        log.info('project deleted', { project: id, name: existing?.name, user: user.username });
        sendEmpty(response, 204);
        return;
      }

      allow(['GET', 'PUT', 'DELETE']);
    }

    throw new HttpError(404, 'Not found');
  }

  return (request, response) => {
    applySecurityHeaders(response);
    const started = Date.now();    const pathname = (() => {
      try {
        return new URL(request.url || '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
      } catch {
        return '/';
      }
    })();

    route(request, response, pathname)
      .catch((error) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        if (error instanceof HttpError) {
          sendJson(response, error.status, { error: error.message });
          return;
        }
        log.error('unhandled error', {
          method: request.method,
          path: pathname,
          error: error?.message ?? String(error),
        });
        sendJson(response, 500, { error: 'Internal server error' });
      })
      .finally(() => {
        response.on('finish', () => {
          const elapsed = Date.now() - started;
          if (elapsed > 2000) log.warn('slow request', { method: request.method, path: pathname, ms: elapsed });
          else log.debug('request', { method: request.method, path: pathname, status: response.statusCode, ms: elapsed });
        });
      });
  };
}

export function createApi({ config, store, shared = null, hub = null, logger = console }) {
  return http.createServer(createApiHandler({ config, store, shared, hub, logger }));
}
