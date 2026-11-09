import { useCallback, useEffect, useState } from 'react';

import type { DiagramDoc } from '../doc/types';
import {
  IDLE_STATUS,
  restoreWorkspace,
  saveWorkspace,
  type RestoreResult,
  type WorkspaceStatus,
} from '../doc/workspaceStore';

/**
 * Keeps the working diagram in the browser and reports where it went.
 *
 * Restoring is a request the caller makes once, when it knows no room or account
 * has taken the page over; saving is automatic and debounced, so a drag writes
 * once it settles instead of on every pointer move.
 */
export function useWorkspaceStore({
  doc,
  enabled,
}: {
  doc: DiagramDoc | null;
  enabled: boolean;
}) {
  const [status, setStatus] = useState<WorkspaceStatus>(IDLE_STATUS);

  const restore = useCallback(async (): Promise<RestoreResult> => {
    const result = await restoreWorkspace();
    if (result.kind === 'restored') {
      setStatus({
        state: 'saved',
        location: result.location,
        bytes: result.bytes,
        savedAt: Date.now(),
        quota: null,
        error: result.location === 'session' ? 'Recovered from this tab only.' : null,
      });
    } else if (result.kind === 'unavailable') {
      setStatus((current) => ({ ...current, state: 'error', error: result.error }));
    }
    return result;
  }, []);

  useEffect(() => {
    if (!doc || !enabled) return;
    setStatus((current) => (current.state === 'saving' ? current : { ...current, state: 'saving' }));

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void saveWorkspace(doc).then((result) => {
        if (cancelled) return;
        setStatus({
          state: result.location === 'session' ? 'error' : 'saved',
          location: result.location,
          bytes: result.bytes,
          savedAt: result.location === 'session' ? null : Date.now(),
          quota: result.quota,
          error: result.error,
        });
      });
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, enabled]);

  return { status, restore };
}
