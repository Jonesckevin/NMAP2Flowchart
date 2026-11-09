import { useRef, useState } from 'react';

import type { ProjectShare } from '../account/types';
import { useDialogFocus } from '../hooks/useDialogFocus';

type ShareDialogProps = {
  open: boolean;
  projectName: string;
  share: ProjectShare | null;
  busy: boolean;
  /** `rotate` retires the current link and mints a new one. */
  onShare: (mode: 'edit' | 'view', rotate: boolean) => void;
  onStop: () => void;
  onClose: () => void;
};

function linkFor(token: string): string {
  return `${window.location.origin}/s/${token}`;
}

/**
 * Turns an account project into a room: whoever opens the link sees the drawing,
 * and edits live unless the link is view-only. The link is the project's, so the
 * work is stored in the project either way.
 */
export function ShareDialog({ open, projectName, share, busy, onShare, onStop, onClose }: ShareDialogProps) {
  const [mode, setMode] = useState<'edit' | 'view'>(share?.mode ?? 'edit');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  useDialogFocus(sectionRef, open);

  if (!open) return null;

  const url = share ? linkFor(share.token) : '';

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      fieldRef.current?.select();
      setError('Copy did not work – select the link and copy it by hand.');
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={sectionRef}
        className="dialog share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="eyebrow">Share link</span>
            <h2 id="share-dialog-title">{projectName}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close share dialog" onClick={onClose}>
            ×
          </button>
        </div>

        {share ? (
          <>
            <p className="dialog__note">
              Anyone with this link sees the diagram, and{' '}
              {share.mode === 'edit' ? 'edits it live with everyone else' : 'can look but not change it'}.
              It saves into this project.
            </p>
            <div className="share-dialog__link">
              <input
                ref={fieldRef}
                className="input"
                readOnly
                value={url}
                aria-label="Share link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="btn" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="import-preview__modes share-dialog__modes" role="radiogroup" aria-label="Link permissions">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'edit'}
                className={`import-mode${mode === 'edit' ? ' is-on' : ''}`}
                onClick={() => {
                  setMode('edit');
                  if (share.mode !== 'edit') onShare('edit', false);
                }}
              >
                <strong>Can edit</strong>
                <span>Live collaboration – changes reach everyone on the link</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'view'}
                className={`import-mode${mode === 'view' ? ' is-on' : ''}`}
                onClick={() => {
                  setMode('view');
                  if (share.mode !== 'view') onShare('view', false);
                }}
              >
                <strong>View only</strong>
                <span>See the drawing and the pointers, with the editor locked</span>
              </button>
            </div>

            {error && <p className="import-preview__effect is-warning">{error}</p>}

            <div className="dialog__actions">
              <button type="button" className="btn btn--danger" disabled={busy} onClick={onStop}>
                Stop sharing
              </button>
              <span className="share-dialog__spacer" />
              <button type="button" className="btn" disabled={busy} onClick={() => onShare(mode, true)}>
                New link
              </button>
              <button type="button" className="btn btn--accent" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dialog__note">
              Publish this project as a link. Everyone who opens it sees the same diagram; leave it editable
              for live collaboration or view-only for a read-only copy.
            </p>
            <div className="import-preview__modes share-dialog__modes" role="radiogroup" aria-label="Link permissions">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'edit'}
                className={`import-mode${mode === 'edit' ? ' is-on' : ''}`}
                onClick={() => setMode('edit')}
              >
                <strong>Can edit</strong>
                <span>Live collaboration – changes reach everyone on the link</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'view'}
                className={`import-mode${mode === 'view' ? ' is-on' : ''}`}
                onClick={() => setMode('view')}
              >
                <strong>View only</strong>
                <span>See the drawing and the pointers, with the editor locked</span>
              </button>
            </div>
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--accent" disabled={busy} onClick={() => onShare(mode, false)}>
                Create link
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
