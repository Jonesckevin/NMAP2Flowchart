import type { DiagramDoc } from './types';
import { readDesignFile } from './designFile';

/**
 * Where the browser keeps the working diagram.
 *
 * `localStorage` is a 5 MB string box that blocks the main thread and fails hard
 * on a big scan; IndexedDB holds megabytes without a hitch, so it is the primary
 * store and `localStorage` only carries the small keys plus a migration path for
 * workspaces written by earlier builds. The last resort is a session-only recovery
 * copy, which at least survives a reload when the quota is full.
 */

export const WORKSPACE_STORAGE_KEY = 'nmap2flowchart.diagram.v2';
export const LEGACY_STORAGE_KEY = 'nmap2flowio.diagram.v2';
const RECOVERY_KEY = `${WORKSPACE_STORAGE_KEY}.recovery`;
const LEGACY_RECOVERY_KEY = `${LEGACY_STORAGE_KEY}.recovery`;

const DB_NAME = 'nmap2flowchart';
const DB_VERSION = 1;
const DB_STORE = 'workspace';
const DB_KEY = 'current';

/**
 * Version of the stored envelope (`{ storeVersion, version, doc }`). The document
 * carries its own `version`; this one is ours, and a bump means the read path has
 * to migrate what an older build wrote.
 */
export const STORE_VERSION = 3;

export type WorkspaceLocation = 'indexeddb' | 'local' | 'session';

export type WorkspaceQuota = { usage: number; quota: number } | null;

export type WorkspaceStatus = {
  state: 'idle' | 'saving' | 'saved' | 'error';
  location: WorkspaceLocation;
  /** Bytes of the stored document, so the chip can say how big it is. */
  bytes: number;
  savedAt: number | null;
  quota: WorkspaceQuota;
  /** Why the last write degraded, when it did. */
  error: string | null;
};

export const IDLE_STATUS: WorkspaceStatus = {
  state: 'idle',
  location: 'local',
  bytes: 0,
  savedAt: null,
  quota: null,
  error: null,
};

export type RestoreResult =
  | { kind: 'restored'; doc: DiagramDoc; location: WorkspaceLocation; bytes: number }
  | { kind: 'empty' }
  | { kind: 'unavailable'; error: string };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function canUseIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** Opens (and upgrades) the workspace database once per page. */
export function workspaceDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (!canUseIndexedDb()) {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => done(null);
      request.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

function readIndexedDb(): Promise<string | null> {
  return new Promise((resolve) => {
    void workspaceDb().then((db) => {
      if (!db) {
        resolve(null);
        return;
      }
      try {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  });
}

function writeIndexedDb(raw: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void workspaceDb().then((db) => {
      if (!db) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(raw, DB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('IndexedDB write failed'));
      }
    });
  });
}

function readLocal(): string | null {
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readRecovery(): string | null {
  try {
    return window.sessionStorage.getItem(RECOVERY_KEY) ?? window.sessionStorage.getItem(LEGACY_RECOVERY_KEY);
  } catch {
    return null;
  }
}

const parse = (raw: string): DiagramDoc | null => {
  const result = readDesignFile(raw);
  return result.ok ? result.doc : null;
};

const byteSize = (raw: string) => new TextEncoder().encode(raw).length;

export async function estimateQuota(): Promise<WorkspaceQuota> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate && typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
      return { usage: estimate.usage, quota: estimate.quota };
    }
  } catch {
    // No estimate API, or the browser refused to answer: the chip simply omits it.
  }
  return null;
}

/**
 * Reads the diagram this browser had open. IndexedDB wins, then the older
 * `localStorage` copy (moved over on first success), then a session recovery copy
 * left behind by a write that ran out of room.
 */
export async function restoreWorkspace(): Promise<RestoreResult> {
  const fromDb = await readIndexedDb();
  if (fromDb) {
    const doc = parse(fromDb);
    if (doc) return { kind: 'restored', doc, location: 'indexeddb', bytes: byteSize(fromDb) };
  }

  const fromLocal = readLocal();
  if (fromLocal) {
    const doc = parse(fromLocal);
    if (doc) {
      // Migrate quietly; a failure here is harmless, the next save retries.
      if (fromDb !== null || canUseIndexedDb()) await writeIndexedDb(fromLocal).catch(() => undefined);
      return { kind: 'restored', doc, location: 'local', bytes: byteSize(fromLocal) };
    }
  }

  const recovery = readRecovery();
  if (recovery) {
    const doc = parse(recovery);
    if (doc) return { kind: 'restored', doc, location: 'session', bytes: byteSize(recovery) };
  }

  if (!canUseIndexedDb() && readLocal() === null) {
    try {
      window.localStorage.setItem(`${WORKSPACE_STORAGE_KEY}.probe`, '1');
      window.localStorage.removeItem(`${WORKSPACE_STORAGE_KEY}.probe`);
    } catch {
      return { kind: 'unavailable', error: 'Browser storage is blocked in this tab.' };
    }
  }

  return { kind: 'empty' };
}

export type WorkspaceWriteResult = {
  location: WorkspaceLocation;
  bytes: number;
  quota: WorkspaceQuota;
  error: string | null;
};

/**
 * The stored envelope as it sits on disk, whatever shape the build that wrote it
 * used. Only the crash wall needs this: it is the escape hatch that hands the user
 * a file when the editor itself cannot run.
 */
export async function readStoredWorkspace(): Promise<{ raw: string; location: WorkspaceLocation } | null> {
  const fromDb = await readIndexedDb();
  if (fromDb) return { raw: fromDb, location: 'indexeddb' };
  const fromLocal = readLocal();
  if (fromLocal) return { raw: fromLocal, location: 'local' };
  const recovery = readRecovery();
  if (recovery) return { raw: recovery, location: 'session' };
  return null;
}

/** Persists the document, degrading to `localStorage` and then to the session. */
export async function saveWorkspace(doc: DiagramDoc): Promise<WorkspaceWriteResult> {
  // `storeVersion` describes the envelope itself, so a future change to how the
  // workspace is stored can migrate instead of guessing from the document version.
  const raw = JSON.stringify({ storeVersion: STORE_VERSION, version: 2, doc });
  const bytes = byteSize(raw);
  const quota = await estimateQuota();

  try {
    await writeIndexedDb(raw);
    // Keep the legacy key current for older builds and for the migration window.
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage is optional here.
    }
    return { location: 'indexeddb', bytes, quota, error: null };
  } catch (dbError) {
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, raw);
      try {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // Ignored: the new key already holds the document.
      }
      return {
        location: 'local',
        bytes,
        quota,
        error: dbError instanceof Error ? dbError.message : 'IndexedDB is unavailable',
      };
    } catch (localError) {
      try {
        window.sessionStorage.setItem(RECOVERY_KEY, raw);
        return {
          location: 'session',
          bytes,
          quota,
          error:
            localError instanceof Error && localError.name === 'QuotaExceededError'
              ? 'The browser is out of room for this diagram.'
              : 'Browser storage is unavailable.',
        };
      } catch {
        return {
          location: 'session',
          bytes,
          quota,
          error: 'Browser storage is unavailable.',
        };
      }
    }
  }
}

/** Forgets the stored workspace (used when a room takes over the page). */
export async function clearWorkspace(): Promise<void> {
  try {
    const db = await workspaceDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(DB_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  } catch {
    // Nothing to clear.
  }
  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    window.sessionStorage.removeItem(RECOVERY_KEY);
    window.sessionStorage.removeItem(LEGACY_RECOVERY_KEY);
  } catch {
    // Nothing to clear.
  }
}
