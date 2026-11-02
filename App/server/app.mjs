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

function validateDoc(doc) {
  requireObject(doc, 'Diagram document must be an object');
  if (doc.version !== 2) throw new HttpError(400, 'Unsupported diagram version (expected 2)');
  if (!Array.isArray(doc.nodes)) throw new HttpError(400, 'Diagram document is missing nodes');
  if (!Array.isArray(doc.layers)) throw new HttpError(400, 'Diagram document is missing layers');
  if (doc.edges !== undefined && !Array.isArray(doc.edges)) {
    throw new HttpError(400, 'Diagram document edges must be an array');
  }
  return doc;
}

export function createApiHandler({ config, store, logger = console }) {
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

  function serializeDoc(doc) {
    const docJson = JSON.stringify(doc);
    const bytes = Buffer.byteLength(docJson);
    if (bytes > config.maxProjectBytes) {
      throw new HttpError(
        413,
        `Diagram is larger than the ${Math.round(config.maxProjectBytes / (1024 * 1024))} MB account limit`,
      );
    }
    return {
      docJson,
      nodeCount: doc.nodes.length,
      edgeCount: Array.isArray(doc.edges) ? doc.edges.length : 0,
    };
  }

  async function route(request, response, pathname) {
    const method = request.method || 'GET';
    const allow = (methods) => {
      response.setHeader('Allow', methods.join(', '));
      throw new HttpError(405, 'Method not allowed');
    };

    if (pathname === '/api/health') {
      if (method !== 'GET') allow(['GET']);
      sendJson(response, 200, { ok: true, authEnabled: config.authEnabled });
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
        version: 1,
      });
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
      logger.info?.(`accounts: registered ${username}`);
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
        logger.warn?.(`accounts: failed login for ${username || '(empty)'} from ${ip}`);
        throw new HttpError(401, 'Invalid username or password');
      }
      loginLimiter.reset(ip);
      const user = store.findUserById(row.user_id);
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
      logger.info?.(`accounts: guest session ${user.username}`);
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
      if (token) store.revokeSession(hashToken(token));
      sendJson(response, 200, { ok: true });
      return;
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
        const project = store.createProject(user.userId, { name, ...serializeDoc(doc) });
        sendJson(response, 201, { project });
        return;
      }

      allow(['GET', 'POST']);
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
        }
        if (hasDoc) {
          project = store.updateProjectDoc(user.userId, id, serializeDoc(validateDoc(body.doc)));
          if (!project) throw new HttpError(404, 'Project not found');
        }
        sendJson(response, 200, { project });
        return;
      }

      if (method === 'DELETE') {
        if (!store.deleteProject(user.userId, id)) throw new HttpError(404, 'Project not found');
        sendEmpty(response, 204);
        return;
      }

      allow(['GET', 'PUT', 'DELETE']);
    }

    throw new HttpError(404, 'Not found');
  }

  return (request, response) => {
    applySecurityHeaders(response);
    const started = Date.now();
    const pathname = (() => {
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
        logger.error?.(`accounts: unhandled error for ${request.method} ${pathname}`, error);
        sendJson(response, 500, { error: 'Internal server error' });
      })
      .finally(() => {
        response.on('finish', () => {
          if (Date.now() - started > 2000) {
            logger.warn?.(`accounts: slow request ${request.method} ${pathname} (${Date.now() - started}ms)`);
          }
        });
      });
  };
}

export function createApi({ config, store, logger = console }) {
  return http.createServer(createApiHandler({ config, store, logger }));
}
