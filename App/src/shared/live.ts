import type { DiagramDoc } from '../doc/types';

/**
 * Shared mode: one diagram for everyone who opens this server.
 *
 * The server owns the document and a revision number. We publish whatever the
 * local editor has (debounced), and apply what other browsers publish, so two
 * windows show the same drawing within half a second. Presence – who is here,
 * and where their pointer is – rides the same event stream.
 */
export type SharedUser = {
  id: string;
  name: string;
  color: string;
  address: string;
  since: number;
  cursor: { x: number; y: number } | null;
};

/**
 * Where the live document lives:
 * - `server`  – a `--shared` server with one diagram for everyone,
 * - `link`    – a project share link (`/s/<token>`) anyone can open,
 * - `project` – the owner's editor watching the room of their own shared project.
 */
export type SharedTarget =
  | { kind: 'server' }
  | { kind: 'link'; token: string }
  | { kind: 'project'; token: string };

export type SharedBoot =
  | { enabled: false }
  | {
      enabled: true;
      id: string;
      name: string;
      color: string;
      revision: number;
      doc: DiagramDoc | null;
      users: SharedUser[];
      /** `view` means the server refuses writes from this link. */
      mode: 'edit' | 'view';
      /** Title shown in the header – the project name for a share link. */
      title: string | null;
    };

export type SharedIncoming = {
  doc: DiagramDoc;
  revision: number;
  from: string | null;
  /** True when the server refused our save and handed back the winning document. */
  conflict: boolean;
  /** Increments for every document handed over, so the app applies each one once. */
  seq: number;
};

const NAME_KEY = 'nmap2flowchart.shared.name';
const PUBLISH_MS = 400;
const RETRY_MS = 2500;
const CURSOR_MS = 70;

function readStoredName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private-mode browser just forgets the chosen name.
  }
}

async function postJson(path: string, body: unknown, keepalive = false) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  });
}

export class SharedLive {
  enabled = false;
  status: 'connecting' | 'live' | 'offline' = 'connecting';
  id = '';
  name = '';
  color = '#2fd6a5';
  revision = 0;
  users: SharedUser[] = [];
  /** Remote pointers, in flow coordinates. */
  cursors = new Map<string, { x: number; y: number }>();
  incoming: SharedIncoming | null = null;
  /** `/api/shared` or `/api/share/<token>`. */
  base = '/api/shared';
  kind: SharedTarget['kind'] = 'server';
  mode: 'edit' | 'view' = 'edit';
  /** False for the owner's own project room: their edits save through the project API. */
  canPublish = true;
  title: string | null = null;

  private presenceListeners = new Set<() => void>();
  private cursorListeners = new Set<() => void>();
  private changeListeners = new Set<() => void>();
  private source: EventSource | null = null;
  private pending: { doc: DiagramDoc; json: string } | null = null;
  private sentJson: string | null = null;
  private publishTimer: number | undefined;
  private retryTimer: number | undefined;
  private lastCursorAt = 0;
  private disposed = false;

  start(
    session: {
      id: string;
      name: string;
      color: string;
      revision: number;
      users: SharedUser[];
      doc: DiagramDoc | null;
      mode?: 'edit' | 'view';
      title?: string | null;
    },
    target: SharedTarget & { base: string; canPublish: boolean },
  ) {
    this.enabled = true;
    this.id = session.id;
    this.name = session.name;
    this.color = session.color;
    this.revision = session.revision;
    this.users = session.users ?? [];
    this.base = target.base;
    this.kind = target.kind;
    this.canPublish = target.canPublish;
    this.mode = session.mode === 'view' ? 'view' : 'edit';
    this.title = session.title ?? null;
    window.addEventListener('pagehide', this.flushNow);
    if (session.doc) {
      this.sentJson = JSON.stringify(session.doc);
      this.incoming = { doc: session.doc, revision: session.revision, from: null, conflict: false, seq: 1 };
    }
    this.connect();
    this.emitPresence();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('pagehide', this.flushNow);
    this.source?.close();
    this.source = null;
    if (this.publishTimer !== undefined) window.clearTimeout(this.publishTimer);
    if (this.retryTimer !== undefined) window.clearTimeout(this.retryTimer);
    void postJson(`${this.base}/leave`, { id: this.id }, true).catch(() => {});
  }

  // ---------------------------------------------------------------- listeners
  onPresence(listener: () => void) {
    this.presenceListeners.add(listener);
    return () => {
      this.presenceListeners.delete(listener);
    };
  }

  onCursors(listener: () => void) {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }

  onChange(listener: () => void) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private emitPresence() {
    for (const listener of [...this.presenceListeners]) listener();
  }

  private emitCursors() {
    for (const listener of [...this.cursorListeners]) listener();
  }

  private emitChange() {
    for (const listener of [...this.changeListeners]) listener();
  }

  private setStatus(status: SharedLive['status']) {
    if (this.status === status) return;
    this.status = status;
    this.emitPresence();
  }

  // ------------------------------------------------------------------- stream
  private connect() {
    if (this.disposed) return;
    this.source?.close();
    const source = new EventSource(`${this.base}/events?id=${encodeURIComponent(this.id)}`);
    this.source = source;

    source.addEventListener('open', () => this.setStatus('live'));
    source.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        revision: number;
        doc: DiagramDoc | null;
        users?: SharedUser[];
      };
      this.setStatus('live');
      if (data.users) {
        this.users = data.users;
        this.emitPresence();
      }
      if (data.doc) this.applyRemote(data.doc, data.revision, { from: null, conflict: false });
    });
    source.addEventListener('change', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        revision: number;
        doc: DiagramDoc;
        from: string | null;
      };
      if (data.from === this.id) {
        this.revision = data.revision;
        return;
      }
      this.applyRemote(data.doc, data.revision, { from: data.from, conflict: false });
    });
    source.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { users: SharedUser[] };
      this.users = data.users ?? [];
      this.emitPresence();
    });
    source.addEventListener('cursor', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as {
        id: string;
        cursor: { x: number; y: number } | null;
      };
      if (!data.id || data.id === this.id) return;
      if (data.cursor) this.cursors.set(data.id, data.cursor);
      else this.cursors.delete(data.id);
      this.emitCursors();
    });
    source.addEventListener('error', () => {
      this.setStatus('offline');
      // The server may have restarted and forgotten the session id.
      this.source?.close();
      this.source = null;
      this.scheduleRejoin();
    });
  }

  private scheduleRejoin() {
    if (this.disposed || this.retryTimer !== undefined) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      void this.rejoin();
    }, RETRY_MS);
  }

  private async rejoin() {
    if (this.disposed) return;
    try {
      const response = await postJson(`${this.base}/join`, { name: this.name });
      if (!response.ok) throw new Error('join failed');
      const session = (await response.json()) as {
        id: string;
        revision: number;
        doc: DiagramDoc | null;
        users: SharedUser[];
      };
      this.id = session.id;
      this.revision = session.revision;
      this.users = session.users ?? [];
      this.cursors.clear();
      this.emitPresence();
      this.emitCursors();
      if (session.doc && JSON.stringify(session.doc) !== this.sentJson) {
        this.applyRemote(session.doc, session.revision, { from: null, conflict: false });
      }
      this.connect();
      this.setStatus('live');
      if (this.pending) this.schedule();
    } catch {
      this.scheduleRejoin();
    }
  }

  private applyRemote(doc: DiagramDoc, revision: number, meta: { from: string | null; conflict: boolean }) {
    const json = JSON.stringify(doc);
    const unchanged = json === this.sentJson;
    this.revision = revision;
    this.sentJson = json;
    if (unchanged && this.incoming) return;
    this.incoming = { doc, revision, from: meta.from, conflict: meta.conflict, seq: (this.incoming?.seq ?? 0) + 1 };
    this.emitChange();
  }

  // ------------------------------------------------------------------ publish
  publish(doc: DiagramDoc) {
    if (!this.enabled || !this.canPublish || this.disposed) return;
    const json = JSON.stringify(doc);
    if (json === this.sentJson) return;
    this.sentJson = json;
    this.pending = { doc, json };
    this.schedule();
  }

  private schedule() {
    if (this.publishTimer !== undefined) return;
    this.publishTimer = window.setTimeout(() => {
      this.publishTimer = undefined;
      void this.flush();
    }, PUBLISH_MS);
  }

  private async flush() {
    const next = this.pending;
    if (!next || this.disposed) return;
    this.pending = null;
    try {
      const response = await fetch(this.base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: this.id, baseRevision: this.revision, doc: next.doc }),
      });
      if (response.status === 409) {
        const conflict = (await response.json()) as { doc?: DiagramDoc; revision?: number };
        if (conflict?.doc) {
          this.applyRemote(conflict.doc, conflict.revision ?? this.revision, { from: null, conflict: true });
        }
        return;
      }
      if (!response.ok) throw new Error(`save failed (${response.status})`);
      const saved = (await response.json()) as { revision?: number };
      this.revision = saved.revision ?? this.revision + 1;
      this.setStatus('live');
    } catch {
      this.pending = next;
      this.setStatus('offline');
      this.schedule();
      this.scheduleRejoin();
    }
  }

  /** Fire-and-forget save when the tab is closing, so the last edit is not lost. */
  private flushNow = () => {
    const next = this.pending;
    if (!next) return;
    this.pending = null;
    try {
      void fetch(this.base, {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: this.id, baseRevision: this.revision, doc: next.doc }),
      }).catch(() => {});
    } catch {
      // Nothing left to do while the page is going away.
    }
  };

  // ----------------------------------------------------------------- presence
  sendCursor(point: { x: number; y: number } | null) {
    if (!this.enabled || this.disposed) return;
    const now = performance.now();
    if (point && now - this.lastCursorAt < CURSOR_MS) return;
    this.lastCursorAt = now;
    // Pointers are disposable: no keepalive, so they never clog the browser's
    // keepalive request budget the way a page-close save would.
    void postJson(`${this.base}/cursor`, { id: this.id, cursor: point }).catch(() => {});
  }

  async rename(name: string) {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed || trimmed === this.name) return;
    this.name = trimmed;
    storeName(trimmed);
    try {
      await postJson(`${this.base}/name`, { id: this.id, name: trimmed });
    } catch {
      // The name is still shown locally; the next rename tries again.
    }
    this.emitPresence();
  }
}



function baseFor(target: SharedTarget): string {
  return target.kind === 'server' ? '/api/shared' : `/api/share/${target.token}`;
}

/** The token in `/s/<token>` (or `?share=<token>`), if this page is a share link. */
export function shareTokenFromLocation(): string | null {
  const match = /^\/s\/([A-Za-z0-9_-]{16,64})\/?$/.exec(window.location.pathname);
  if (match) return match[1];
  const query = new URLSearchParams(window.location.search).get('share') ?? '';
  return /^[A-Za-z0-9_-]{16,64}$/.test(query) ? query : null;
}

type JoinSession = {
  id: string;
  name: string;
  color: string;
  revision: number;
  doc: DiagramDoc | null;
  users: SharedUser[];
  mode?: 'edit' | 'view';
  title?: string | null;
};

/**
 * Joins the room behind a target. `false` means there is nothing to join – a normal
 * browser-storage build, or a link that was switched off. A server that is still
 * starting (or restarting) is retried a few times before giving up.
 */
export async function joinSharedSession(target: SharedTarget): Promise<SharedBoot> {
  const base = baseFor(target);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const probe = await fetch(base, { headers: { Accept: 'application/json' } });
      if (!probe.ok) return { enabled: false };
      const state = (await probe.json()) as { enabled?: boolean; title?: string; name?: string };
      if (!state?.enabled) return { enabled: false };

      const response = await postJson(`${base}/join`, { name: readStoredName() });
      if (!response.ok) return { enabled: false };
      const session = (await response.json()) as JoinSession;
      const live = new SharedLive();
      live.start(session, { ...target, base, canPublish: target.kind !== 'project' });
      ACTIVE.set(base, live);
      return {
        enabled: true,
        id: session.id,
        name: session.name,
        color: session.color,
        revision: session.revision,
        doc: session.doc ?? null,
        users: session.users ?? [],
        mode: session.mode === 'view' ? 'view' : 'edit',
        title: session.title ?? state.title ?? state.name ?? null,
      };
    } catch {
      // The server may be mid-restart; a moment later the same call works.
      if (attempt === 2) return { enabled: false };
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
  }
  return { enabled: false };
}

/** Sessions this page joined, so a React remount reuses rather than re-joins. */
const ACTIVE = new Map<string, SharedLive>();
const BOOTED = new Map<string, Promise<SharedBoot>>();

export function loadSharedSession(target: SharedTarget): Promise<SharedBoot> {
  const base = baseFor(target);
  const existing = BOOTED.get(base);
  if (existing) return existing;
  const pending = joinSharedSession(target);
  BOOTED.set(base, pending);
  return pending;
}

export function activeSharedLive(base: string): SharedLive | null {
  return ACTIVE.get(base) ?? null;
}

export function sharedBase(target: SharedTarget | null): string {
  return target ? baseFor(target) : '';
}
