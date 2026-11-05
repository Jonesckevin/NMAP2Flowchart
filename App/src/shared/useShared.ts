import { useCallback, useEffect, useState } from 'react';

import type { DiagramDoc } from '../doc/types';
import {
  activeSharedLive,
  loadSharedSession,
  sharedBase,
  type SharedIncoming,
  type SharedLive,
  type SharedTarget,
  type SharedUser,
} from './live';

export type SharedSession = {
  /** False until the page knows whether there is a room to join. */
  ready: boolean;
  enabled: boolean;
  live: SharedLive | null;
  users: SharedUser[];
  status: 'connecting' | 'live' | 'offline';
  incoming: SharedIncoming | null;
  kind: SharedTarget['kind'] | null;
  /** A view-only share link: the editor is locked and nothing is saved. */
  readOnly: boolean;
  /** True when this browser may write into the room (a share link with edit rights). */
  canPublish: boolean;
  /** The project name behind a share link, for the header. */
  title: string | null;
};

/**
 * Joins the room the page belongs to – a `--shared` server, a project share link,
 * or the owner's own shared project – and re-renders when the people here or the
 * document change. Pointer positions are deliberately not part of this: the cursor
 * overlay subscribes to those on its own.
 */
export function useSharedSession(target: SharedTarget | null): SharedSession & { publish: (doc: DiagramDoc) => void } {
  const key = sharedBase(target);
  const [ready, setReady] = useState(!target);
  const [live, setLive] = useState<SharedLive | null>(null);
  const [incoming, setIncoming] = useState<SharedIncoming | null>(null);
  const [, setPresenceTick] = useState(0);

  useEffect(() => {
    if (!target) {
      setLive(null);
      setIncoming(null);
      setReady(true);
      return;
    }
    let alive = true;
    setReady(false);
    void loadSharedSession(target).then(() => {
      if (!alive) return;
      setLive(activeSharedLive(key));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [key, target]);

  useEffect(() => {
    if (!live) return;
    setIncoming(live.incoming);
    const offPresence = live.onPresence(() => setPresenceTick((tick) => tick + 1));
    const offChange = live.onChange(() => setIncoming(live.incoming));
    return () => {
      offPresence();
      offChange();
    };
  }, [live]);

  // Stable identity: the autosave effect depends on it and must not re-run per render.
  const publish = useCallback(
    (next: DiagramDoc) => {
      if (!key) return;
      activeSharedLive(key)?.publish(next);
    },
    [key],
  );

  return {
    ready,
    enabled: Boolean(live),
    live,
    users: live?.users ?? [],
    status: live?.status ?? 'connecting',
    incoming,
    kind: live?.kind ?? null,
    readOnly: live?.mode === 'view',
    canPublish: Boolean(live?.canPublish),
    title: live?.title ?? null,
    publish,
  };
}
