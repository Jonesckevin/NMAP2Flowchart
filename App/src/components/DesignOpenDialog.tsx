import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { designCounts, type DesignFile, type DesignRepair } from '../doc/designFile';
import type { RiskPolicy } from '../doc/risk';
import type { DiagramDoc } from '../doc/types';

export type DesignPreview = {
  fileName: string;
  design: DesignFile;
  doc: DiagramDoc;
  repair: DesignRepair;
};

type DesignOpenDialogProps = {
  preview: DesignPreview;
  /** The diagram currently open, so the copy can warn before it is replaced. */
  hasDoc: boolean;
  onCancel: () => void;
  onOpen: (applyRisk: boolean) => void;
};

function when(iso: string): string {
  if (!iso) return 'not recorded';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'not recorded' : date.toLocaleString();
}

function levelNames(policy: RiskPolicy): string {
  if (policy.levels.length === 0) return 'nothing flagged';
  return policy.levels.map((level) => level.label).join(', ');
}

/** Mounted only while a design file is waiting, so the risk choice resets each time. */
function DesignOpenPanel({ preview, hasDoc, onCancel, onOpen }: DesignOpenDialogProps) {
  const { design, doc } = preview;
  const counts = designCounts(doc);
  const [applyRisk, setApplyRisk] = useState(Boolean(design.risk));
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('.btn--accent')?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dropped = preview.repair.nodes + preview.repair.edges + preview.repair.layers;
  const snapshot = design.risk;
  const ownRisk = doc.risk;

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog design-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-open-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="eyebrow">Design file</span>
            <h2 id="design-open-title">{preview.fileName}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close design preview" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="import-preview__grid">
          <div><strong>{counts.hosts}</strong><span>hosts</span></div>
          <div><strong>{counts.sections}</strong><span>sections</span></div>
          <div><strong>{counts.notes}</strong><span>notes</span></div>
          <div><strong>{counts.layers}</strong><span>layers</span></div>
        </div>

        <p className={`import-preview__effect${hasDoc ? ' is-warning' : ''}`}>
          {hasDoc ? 'Replaces the open diagram – undo restores it' : 'Starts a new diagram from this file'}
          {dropped > 0 ? ` · ${dropped} unreadable item${dropped === 1 ? '' : 's'} skipped` : ''}
        </p>

        <div className={`design-open__risk${applyRisk && snapshot ? ' is-on' : ''}`}>
          {snapshot ? (
            <label className="design-open__toggle">
              <input
                type="checkbox"
                checked={applyRisk}
                onChange={(event) => setApplyRisk(event.target.checked)}
              />
              <span>
                <strong>Keep the risk levels saved with this diagram</strong>
                <em>{levelNames(snapshot.policy)}</em>
              </span>
            </label>
          ) : ownRisk ? (
            <p className="design-open__note">
              <strong>Risk levels:</strong> {levelNames(ownRisk)}
            </p>
          ) : (
            <p className="design-open__note">
              <strong>No saved risk levels</strong> – the diagram uses the levels in force here.
            </p>
          )}
          {(snapshot ? applyRisk : false) && snapshot && (
            <p className="design-open__swatches" aria-hidden="true">
              {snapshot.policy.levels.map((level) => (
                <i key={level.id} style={{ background: level.color }} title={level.label} />
              ))}
            </p>
          )}
        </div>

        <dl className="import-preview__metadata">
          <div><dt>Exported</dt><dd>{when(design.exportedAt)}</dd></div>
          <div><dt>Source scan</dt><dd>{doc.fileName}</dd></div>
          <div><dt>Command</dt><dd>{doc.args || 'Not recorded'}</dd></div>
          <div>
            <dt>Contents</dt>
            <dd>
              {counts.hosts} host{counts.hosts === 1 ? '' : 's'} · {counts.openPorts} open port
              {counts.openPorts === 1 ? '' : 's'} · {counts.links} connection{counts.links === 1 ? '' : 's'}
              {counts.hops > 0 ? ` · ${counts.hops} trace point${counts.hops === 1 ? '' : 's'}` : ''}
            </dd>
          </div>
        </dl>

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--accent" onClick={() => onOpen(applyRisk)}>
            {hasDoc ? 'Replace diagram' : 'Open design'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function DesignOpenDialog(props: DesignOpenDialogProps) {
  return <DesignOpenPanel {...props} />;
}
