import { useEffect, useId, useRef, useState } from 'react';

import type { WorkspaceStatus } from '../doc/workspaceStore';

const LOCATION_LABEL: Record<WorkspaceStatus['location'], string> = {
  indexeddb: 'IndexedDB',
  local: 'localStorage',
  session: 'this tab only',
};

const LOCATION_HINT: Record<WorkspaceStatus['location'], string> = {
  indexeddb: 'survives a reload and closing the browser',
  local: 'the small fallback store – big diagrams may not fit',
  session: 'the browser was out of room, so a reload keeps it but closing does not',
};

function bytesLabel(bytes: number): string {
  if (bytes <= 0) return 'empty';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function ago(savedAt: number | null, now: number): string {
  if (!savedAt) return '';
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * The save chip: one glance tells you the diagram is safe, and the panel answers
 * the two questions people actually ask – where is it, and how big is it.
 */
export function SaveStatus({
  status,
  visible,
  onSaveCopy,
}: {
  status: WorkspaceStatus;
  visible: boolean;
  /** Hands the diagram over as a design file, for when storage is the problem. */
  onSaveCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!visible) return null;

  const tone = status.state === 'saving' ? 'saving' : status.state === 'error' ? 'error' : 'saved';
  const label =
    status.state === 'saving'
      ? 'Saving…'
      : status.state === 'error'
        ? 'Storage limited'
        : status.savedAt
          ? 'Saved locally'
          : 'Not saved yet';
  const quota = status.quota;
  const share = quota && quota.quota > 0 ? Math.min(1, quota.usage / quota.quota) : 0;

  return (
    <div
      className="save-status"
      ref={wrap}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={`save-status__chip save-status__chip--${tone}`}
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={`${label} – how this diagram is stored`}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!wrap.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <span className="save-status__dot" aria-hidden="true" />
        <span className="save-status__label">{label}</span>
        <svg className="save-status__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="8.4" />
          <path d="M12 11v6" />
          <circle cx="12" cy="7.9" r="1.1" className="save-status__glyph-dot" />
        </svg>
      </button>

      {open && (
        <div className="save-status__panel" id={panelId} role="tooltip">
          <div className="save-status__head">
            <span className={`save-status__dot save-status__dot--${tone}`} aria-hidden="true" />
            <strong>
              {status.state === 'error'
                ? 'Storage is limited'
                : status.state === 'saving'
                  ? 'Saving this diagram…'
                  : 'Saved in this browser'}
            </strong>
            <span className="save-status__when">{ago(status.savedAt, now)}</span>
          </div>

          <dl className="save-status__rows">
            <div>
              <dt>Location</dt>
              <dd>
                <span className="save-status__mono">{LOCATION_LABEL[status.location]}</span>
                <span className="save-status__hint">{LOCATION_HINT[status.location]}</span>
              </dd>
            </div>
            <div>
              <dt>Diagram</dt>
              <dd>
                <span className="save-status__mono">{bytesLabel(status.bytes)} on this canvas</span>
                {quota && (
                  <span className="save-status__hint">
                    {bytesLabel(quota.usage)} of {bytesLabel(quota.quota)} site storage in use
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className="save-status__meter" aria-hidden="true">
            {quota ? (
              <>
                <span className="save-status__meter-used" style={{ width: `${Math.max(2, share * 100)}%` }} />
                <span
                  className="save-status__meter-doc"
                  style={{ width: `${Math.max(2, Math.min(100, (status.bytes / Math.max(1, quota.quota)) * 100))}%` }}
                />
              </>
            ) : (
              <span className="save-status__meter-doc" style={{ width: '100%', opacity: 0.35 }} />
            )}
          </div>

          {quota && (
            <p className="save-status__legend">
              <span>
                <i className="save-status__key save-status__key--doc" aria-hidden="true" />
                this diagram
              </span>
              <span>
                <i className="save-status__key save-status__key--other" aria-hidden="true" />
                everything else for this site
              </span>
            </p>
          )}

          {status.error && <p className="save-status__error">{status.error}</p>}

          <button type="button" className="save-status__copy" onClick={onSaveCopy}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 4v10m0 0 4-4m-4 4-4-4" />
              <path d="M5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-1.5" />
            </svg>
            Download a copy of this diagram
          </button>

          <p className="save-status__note">
            Nothing leaves this browser. <strong>Export → Design file</strong> keeps a copy you can move
            to another machine.
          </p>
        </div>
      )}
    </div>
  );
}
