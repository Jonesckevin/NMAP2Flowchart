import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramDoc } from '../doc/types';
import type { RiskPolicy } from '../doc/risk';
import {
  api,
  ApiError,
  BROWSER_FEATURES,
  clearStoredSession,
  readActiveProjectId,
  readStoredSession,
  writeActiveProjectId,
  writeStoredSession,
} from './api';
import type { AccountUser, AuthFeatures, AuthResponse, ProjectDetail, ProjectSummary } from './types';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type AccountController = {
  ready: boolean;
  features: AuthFeatures;
  user: AccountUser | null;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeProject: ProjectSummary | null;
  /** Risk levels saved to the signed-in account, if any. */
  riskPolicy: RiskPolicy | null;
  restoreProjectId: string | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  saveState: SaveState;
  clearFeedback: () => void;
  signIn: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, email?: string) => Promise<boolean>;
  continueAsGuest: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (name: string, doc: DiagramDoc) => Promise<ProjectSummary | null>;
  openProject: (id: string) => Promise<ProjectDetail | null>;
  renameProject: (id: string, name: string) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  /** Publishes a project as a link and returns its path, or null on failure. */
  shareProject: (id: string, mode: 'edit' | 'view', rotate?: boolean) => Promise<string | null>;
  stopSharing: (id: string) => Promise<boolean>;
  saveActiveProject: (doc: DiagramDoc, projectId?: string) => void;
  /** Stores the risk levels account-wide. Returns false when not signed in. */
  saveRiskPolicy: (policy: RiskPolicy | null) => Promise<boolean>;
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function summaryOf(project: ProjectDetail): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    nodeCount: project.nodeCount,
    edgeCount: project.edgeCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function useAccount(): AccountController {
  const [features, setFeatures] = useState<AuthFeatures>(BROWSER_FEATURES);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AccountUser | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [riskPolicy, setRiskPolicy] = useState<RiskPolicy | null>(null);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const [restoreProjectId, setRestoreProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const tokenRef = useRef<string | null>(null);
  const userRef = useRef<AccountUser | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const cleanDocRef = useRef<DiagramDoc | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    userRef.current = null;
    clearStoredSession();
    setUser(null);
    setProjects([]);
    setRiskPolicy(null);
    activeProjectIdRef.current = null;
    setActiveProjectIdState(null);
    setRestoreProjectId(null);
    cleanDocRef.current = null;
    setSaveState('idle');
  }, []);

  const setActiveProject = useCallback((id: string | null) => {
    activeProjectIdRef.current = id;
    setActiveProjectIdState(id);
    const userId = userRef.current?.userId;
    if (userId) writeActiveProjectId(userId, id);
  }, []);

  const fail = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        clearSession();
        setError('Your session expired. Sign in again.');
        return;
      }
      setError(messageFor(cause));
    },
    [clearSession],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let config: AuthFeatures = BROWSER_FEATURES;
      try {
        config = await api.config();
      } catch {
        config = BROWSER_FEATURES;
      }
      if (cancelled) return;
      setFeatures(config);

      const stored = config.authEnabled ? readStoredSession() : null;
      if (stored && stored.expiresAt > Date.now()) {
        try {
          const { user: me } = await api.me(stored.token);
          if (cancelled) return;
          tokenRef.current = stored.token;
          userRef.current = me;
          setUser(me);
          const { projects: list } = await api.listProjects(stored.token);
          if (cancelled) return;
          setProjects(list);
          try {
            const preferences = await api.getPreferences(stored.token);
            if (!cancelled) setRiskPolicy(preferences.risk ?? null);
          } catch {
            // Preferences are optional; the browser default still applies.
          }
          if (cancelled) return;
          const preferred = readActiveProjectId(me.userId);
          if (preferred && list.some((project) => project.id === preferred)) {
            setRestoreProjectId(preferred);
          }
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 401) clearStoredSession();
        }
      } else if (stored) {
        clearStoredSession();
      }
      if (!cancelled) setReady(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyAuth = useCallback(
    async (result: AuthResponse) => {
      tokenRef.current = result.token;
      userRef.current = result.user;
      writeStoredSession({ token: result.token, expiresAt: result.expiresAt });
      setUser(result.user);
      setError(null);
      setProjects([]);
      setRiskPolicy(null);
      activeProjectIdRef.current = null;
      setActiveProjectIdState(null);
      setRestoreProjectId(null);
      setSaveState('idle');
      setNotice(`Signed in as ${result.user.username}`);
      try {
        const { projects: list } = await api.listProjects(result.token);
        setProjects(list);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) clearSession();
      }
      try {
        const preferences = await api.getPreferences(result.token);
        setRiskPolicy(preferences.risk ?? null);
      } catch {
        // Preferences are optional.
      }
    },
    [clearSession],
  );

  const runAuth = useCallback(
    async (action: () => Promise<AuthResponse>) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await applyAuth(await action());
        return true;
      } catch (cause) {
        setError(messageFor(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyAuth],
  );

  const signIn = useCallback(
    (username: string, password: string) => runAuth(() => api.login(username.trim(), password)),
    [runAuth],
  );

  const register = useCallback(
    (username: string, password: string, email?: string) =>
      runAuth(() => api.register(username.trim(), password, email)),
    [runAuth],
  );

  const continueAsGuest = useCallback(() => runAuth(() => api.guest()), [runAuth]);

  const signOut = useCallback(async () => {
    const token = tokenRef.current;
    setBusy(true);
    setError(null);
    if (token) {
      try {
        await api.logout(token);
      } catch {
      }
    }
    clearSession();
    setNotice('Signed out. This diagram stays in the browser.');
    setBusy(false);
  }, [clearSession]);

  const refreshProjects = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { projects: list } = await api.listProjects(token);
      setProjects(list);
    } catch (cause) {
      fail(cause);
    }
  }, [fail]);

  const createProject = useCallback(
    async (name: string, doc: DiagramDoc) => {
      const token = tokenRef.current;
      if (!token) return null;
      setBusy(true);
      setError(null);
      try {
        const { project } = await api.createProject(token, name.trim() || 'Untitled project', doc);
        setProjects((list) => [project, ...list.filter((item) => item.id !== project.id)]);
        setActiveProject(project.id);
        cleanDocRef.current = doc;
        setSaveState('saved');
        setNotice(`“${project.name}” saved to your account`);
        return project;
      } catch (cause) {
        fail(cause);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fail, setActiveProject],
  );

  const openProject = useCallback(
    async (id: string) => {
      const token = tokenRef.current;
      if (!token) return null;
      setBusy(true);
      setError(null);
      try {
        const { project } = await api.getProject(token, id);
        const summary = summaryOf(project);
        setProjects((list) => [summary, ...list.filter((item) => item.id !== project.id)]);
        setActiveProject(project.id);
        cleanDocRef.current = project.doc;
        setSaveState('saved');
        setRestoreProjectId((current) => (current === id ? null : current));
        setNotice(`“${project.name}” opened`);
        return project;
      } catch (cause) {
        fail(cause);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fail, setActiveProject],
  );

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const token = tokenRef.current;
      if (!token) return false;
      const trimmed = name.trim().replace(/\s+/g, ' ');
      if (!trimmed) {
        setError('Project name cannot be empty.');
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const { project } = await api.updateProject(token, id, { name: trimmed });
        setProjects((list) => list.map((item) => (item.id === id ? project : item)));
        setNotice('Project renamed');
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      const token = tokenRef.current;
      if (!token) return false;
      setBusy(true);
      setError(null);
      try {
        await api.deleteProject(token, id);
        setProjects((list) => list.filter((item) => item.id !== id));
        if (activeProjectIdRef.current === id) {
          setActiveProject(null);
          cleanDocRef.current = null;
          setSaveState('idle');
        }
        setNotice('Project deleted');
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fail, setActiveProject],
  );

  const saveActiveProject = useCallback(
    (doc: DiagramDoc, scheduledFor?: string) => {
      const projectId = activeProjectIdRef.current;
      if (!tokenRef.current || !projectId) return;
      if (scheduledFor && scheduledFor !== projectId) return;
      if (cleanDocRef.current === doc) return;
      setSaveState('saving');
      saveChain.current = saveChain.current.then(async () => {
        const token = tokenRef.current;
        if (!token || activeProjectIdRef.current !== projectId) return;
        try {
          const { project } = await api.updateProject(token, projectId, { doc });
          setProjects((list) => list.map((item) => (item.id === project.id ? project : item)));
          if (activeProjectIdRef.current === projectId) {
            cleanDocRef.current = doc;
            setSaveState('saved');
          }
        } catch (cause) {
          if (cause instanceof ApiError && cause.status === 401) {
            clearSession();
            setError('Your session expired. Sign in again.');
            return;
          }
          if (activeProjectIdRef.current === projectId) {
            setError(messageFor(cause));
            setSaveState('error');
          }
        }
      });
    },
    [clearSession],
  );

  const saveRiskPolicy = useCallback(
    async (policy: RiskPolicy | null) => {
      const token = tokenRef.current;
      if (!token) {
        setError('Sign in to keep risk levels across diagrams.');
        return false;
      }
      setError(null);
      try {
        const result = await api.savePreferences(token, policy);
        setRiskPolicy(result.risk ?? null);
        setNotice(policy ? 'Risk levels saved to your account' : 'Account risk levels cleared');
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },
    [fail],
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  /** Publishes a project as a share link (or rotates it) and keeps the row in step. */
  const shareProject = useCallback(
    async (id: string, mode: 'edit' | 'view', rotate = false) => {
      const token = tokenRef.current;
      if (!token) return null;
      setBusy(true);
      setError(null);
      try {
        const { project, url } = await api.createShare(token, id, mode, rotate);
        setProjects((list) => list.map((item) => (item.id === id ? project : item)));
        setNotice(mode === 'view' ? 'Share link is view-only' : 'Share link is live');
        return url;
      } catch (cause) {
        fail(cause);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  const stopSharing = useCallback(
    async (id: string) => {
      const token = tokenRef.current;
      if (!token) return false;
      setBusy(true);
      setError(null);
      try {
        const { project } = await api.disableShare(token, id);
        setProjects((list) => list.map((item) => (item.id === id ? project : item)));
        setNotice('Share link switched off');
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fail],
  );

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  return {
    ready,
    features,
    user,
    projects,
    activeProjectId,
    activeProject,
    riskPolicy,
    restoreProjectId,
    busy,
    error,
    notice,
    saveState,
    clearFeedback,
    signIn,
    register,
    continueAsGuest,
    signOut,
    refreshProjects,
    createProject,
    openProject,
    renameProject,
    deleteProject,
    shareProject,
    stopSharing,
    saveActiveProject,
    saveRiskPolicy,
  };
}
