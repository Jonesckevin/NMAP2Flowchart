import type { DiagramDoc } from '../doc/types';
import type { RiskPolicy } from '../doc/risk';
import type { AccountUser, AuthFeatures, AuthResponse, ProjectDetail, ProjectSummary } from './types';


const BASE = '/api';
const SESSION_KEY = 'nmap2flowchart.session.v1';
const LEGACY_SESSION_KEY = 'nmap2flowio.session.v1';

export const BROWSER_FEATURES: AuthFeatures = {
  authEnabled: false,
  registrationEnabled: false,
  guestLoginEnabled: false,
  guestTtlHours: 0,
  maxProjectBytes: 0,
  risk: null,
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Cannot reach the account service.', 0);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export type StoredSession = { token: string; expiresAt: number };

export function readStoredSession(): StoredSession | null {
  try {
    const raw =
      window.localStorage.getItem(SESSION_KEY) ?? window.localStorage.getItem(LEGACY_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export function writeStoredSession(session: StoredSession) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
  }
}

export function clearStoredSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
  }
}

function activeProjectKey(userId: string) {
  return `nmap2flowchart.activeProject.${userId}`;
}

function legacyActiveProjectKey(userId: string) {
  return `nmap2flowio.activeProject.${userId}`;
}

export function readActiveProjectId(userId: string): string | null {
  try {
    return (
      window.localStorage.getItem(activeProjectKey(userId)) ??
      window.localStorage.getItem(legacyActiveProjectKey(userId))
    );
  } catch {
    return null;
  }
}

export function writeActiveProjectId(userId: string, projectId: string | null) {
  try {
    window.localStorage.removeItem(legacyActiveProjectKey(userId));
    if (projectId) window.localStorage.setItem(activeProjectKey(userId), projectId);
    else window.localStorage.removeItem(activeProjectKey(userId));
  } catch {
  }
}

export const api = {
  config: () => request<AuthFeatures>('/config'),

  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),

  register: (username: string, password: string, email?: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, password, email } }),

  guest: () => request<AuthResponse>('/auth/guest', { method: 'POST' }),

  me: (token: string) => request<{ user: AccountUser }>('/auth/me', { token }),

  logout: (token: string) => request<{ ok: boolean }>('/auth/logout', { method: 'POST', token }),

  listProjects: (token: string) => request<{ projects: ProjectSummary[] }>('/projects', { token }),

  getProject: (token: string, id: string) => request<{ project: ProjectDetail }>(`/projects/${id}`, { token }),

  createProject: (token: string, name: string, doc: DiagramDoc) =>
    request<{ project: ProjectSummary }>('/projects', { method: 'POST', token, body: { name, doc } }),

  updateProject: (token: string, id: string, patch: { name?: string; doc?: DiagramDoc }) =>
    request<{ project: ProjectSummary }>(`/projects/${id}`, { method: 'PUT', token, body: patch }),

  deleteProject: (token: string, id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE', token }),

  createShare: (token: string, id: string, mode: 'edit' | 'view', rotate = false) =>
    request<{ project: ProjectSummary; url: string }>(`/projects/${id}/share`, {
      method: 'POST',
      token,
      body: { mode, rotate },
    }),

  disableShare: (token: string, id: string) =>
    request<{ project: ProjectSummary }>(`/projects/${id}/share`, { method: 'DELETE', token }),

  getPreferences: (token: string) => request<{ risk: RiskPolicy | null }>('/preferences', { token }),

  savePreferences: (token: string, risk: RiskPolicy | null) =>
    request<{ risk: RiskPolicy | null }>('/preferences', { method: 'PUT', token, body: { risk } }),
};
