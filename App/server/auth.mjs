import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, dot, underscore or hyphen';
  }
  return null;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters';
  }
  if (password.length > 128) {
    return 'Password must be at most 128 characters';
  }
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include a number';
  return null;
}

export function validateEmail(email) {
  if (email === undefined || email === null || String(email).trim() === '') return null;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 254) {
    return 'That email address does not look valid';
  }
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  let expected;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const key = Buffer.from(await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length));
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function clientIp(request, trustProxy) {
  if (trustProxy) {
    const real = request.headers['x-real-ip'];
    const realValue = Array.isArray(real) ? real[0] : real;
    if (typeof realValue === 'string' && realValue.trim().length > 0) {
      return realValue.trim();
    }
    const forwarded = request.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof value === 'string' && value.length > 0) {
      const hops = value.split(',').map((hop) => hop.trim()).filter(Boolean);
      if (hops.length > 0) return hops[hops.length - 1];
    }
  }
  return request.socket?.remoteAddress || '-';
}

export function createRateLimiter({ max, windowSeconds }) {
  const windowMs = windowSeconds * 1000;
  const hits = new Map();

  const prune = (now) => {
    for (const [key, times] of hits) {
      const recent = times.filter((time) => now - time < windowMs);
      if (recent.length === 0) hits.delete(key);
      else hits.set(key, recent);
    }
  };

  return {
    ok(key, now = Date.now()) {
      if (hits.size > 5000) prune(now);
      const times = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      hits.set(key, times);
      return times.length < max;
    },
    fail(key, now = Date.now()) {
      const times = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      times.push(now);
      hits.set(key, times);
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
