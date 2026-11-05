import { useEffect, useState, type CSSProperties } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';

import type { SharedLive } from '../shared/live';

/**
 * The pointers of everyone else in the session, drawn over the canvas. Positions
 * are published in flow coordinates, so they follow this browser's own pan and
 * zoom instead of pointing at the wrong place.
 */
export function SharedCursors({ live }: { live: SharedLive | null }) {
  const { flowToScreenPosition } = useReactFlow();
  const [tick, setTick] = useState(0);
  useViewport();

  useEffect(() => {
    if (!live) return;
    return live.onCursors(() => setTick((value) => value + 1));
  }, [live]);

  if (!live) return null;
  void tick;

  const here = new Set(live.users.map((user) => user.id));
  const pointers = [...live.cursors.entries()].filter(([id]) => id !== live.id && here.has(id));
  if (pointers.length === 0) return null;

  return (
    <div className="shared-cursors" aria-hidden="true">
      {pointers.map(([id, point]) => {
        const user = live.users.find((entry) => entry.id === id);
        if (!user) return null;
        const screen = flowToScreenPosition(point);
        if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
        return (
          <div
            key={id}
            className="shared-cursor"
            style={{ left: `${screen.x}px`, top: `${screen.y}px`, '--cursor-color': user.color } as CSSProperties}
          >
            <svg width="13" height="17" viewBox="0 0 14 18" aria-hidden="true">
              <path
                d="M1.4 1.2 12 9.3l-5 .9 2.8 5.6-2 1-2.8-5.6-3.4 3.6z"
                fill="currentColor"
                stroke="rgba(3, 6, 10, 0.65)"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
            <span>{user.name}</span>
          </div>
        );
      })}
    </div>
  );
}
