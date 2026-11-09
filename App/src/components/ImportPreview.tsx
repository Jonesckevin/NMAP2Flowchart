import type { ImportEffect, ImportMode } from '../doc/docFromScan';
import type { ImportPreview } from '../hooks/useImportFlow';
import { openPorts, discoveryOnly, type NmapScan } from '../model/types';

export const IMPORT_MODE_HINTS: Record<ImportMode, { label: string; hint: string }> = {
  merge: { label: 'Merge', hint: 'Refresh matching hosts, add new ones, keep the rest' },
  replace: { label: 'Replace', hint: 'Start over from this scan' },
  layer: { label: 'New layer', hint: 'Add this scan beside the current diagram' },
};

function subnetCount(scan: NmapScan) {
  const subnets = new Set<string>();
  scan.hosts.forEach((host) => {
    const match = /^(\d{1,3}\.){3}\d{1,3}$/.exec(host.ip);
    if (match) subnets.add(host.ip.split('.').slice(0, 3).join('.') + '.0/24');
  });
  return subnets.size;
}

/**
 * The review step of an import: what the file holds, how it should land, and
 * the scan metadata worth checking before committing. Shared by the standalone
 * preview (after a drag and drop) and by the guided import dialog.
 */
export function ImportPreviewBody({
  preview,
  effect,
  hasDiagram,
  onChooseMode,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  preview: ImportPreview;
  effect: ImportEffect | null;
  hasDiagram: boolean;
  onChooseMode: (mode: ImportMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const scan = preview.scan;
  const confirmLabel = !hasDiagram
    ? 'Import scan'
    : preview.mode === 'replace'
      ? 'Replace diagram'
      : preview.mode === 'layer'
        ? 'Add as layer'
        : 'Merge scan';

  return (
    <>
      <div className="import-preview__grid">
        <div>
          <strong>{scan.hosts.length}</strong>
          <span>hosts</span>
        </div>
        <div>
          <strong>{subnetCount(scan)}</strong>
          <span>subnets</span>
        </div>
        <div>
          <strong>{scan.hosts.reduce((count, host) => count + openPorts(host).length, 0)}</strong>
          <span>open ports</span>
        </div>
        <div>
          <strong>{scan.trace?.length ?? scan.hosts.reduce((count, host) => count + host.hops.length, 0)}</strong>
          <span>trace hops</span>
        </div>
      </div>

      {hasDiagram ? (
        <div className="import-preview__modes" role="radiogroup" aria-label="Import mode">
          {(Object.keys(IMPORT_MODE_HINTS) as ImportMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={preview.mode === mode}
              className={`import-mode${preview.mode === mode ? ' is-on' : ''}`}
              onClick={() => onChooseMode(mode)}
            >
              <strong>{IMPORT_MODE_HINTS[mode].label}</strong>
              <span>{IMPORT_MODE_HINTS[mode].hint}</span>
            </button>
          ))}
        </div>
      ) : (
        // Nothing to merge into or sit beside: there is one sensible outcome.
        <p className="import-preview__new">This scan becomes a new diagram.</p>
      )}

      {effect && (
        <p className={`import-preview__effect${preview.mode === 'replace' && hasDiagram ? ' is-warning' : ''}`}>
          {!hasDiagram
            ? `${effect.nodes} nodes · read in this browser, nothing uploaded`
            : preview.mode === 'merge'
              ? `${effect.added} new node${effect.added === 1 ? '' : 's'} · ${effect.matched} refreshed${
                  effect.stale > 0 ? ` · ${effect.stale} kept as stale` : ''
                }`
              : preview.mode === 'layer'
                ? `${effect.nodes} nodes on a new layer · the current diagram is untouched`
                : 'Replaces the open diagram – undo restores it'}
        </p>
      )}

      <dl className="import-preview__metadata">
        <div>
          <dt>Command</dt>
          <dd>{scan.args || 'Not reported'}</dd>
        </div>
        <div>
          <dt>Nmap version</dt>
          <dd>{scan.version || 'Not reported'}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{scan.startedAt || 'Not reported'}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{scan.elapsedSeconds != null ? `${scan.elapsedSeconds}s` : 'Not reported'}</dd>
        </div>
        <div>
          <dt>Discovery only</dt>
          <dd>{scan.hosts.filter((host) => discoveryOnly(host)).length} hosts without a port scan</dd>
        </div>
      </dl>

      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn--accent" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </>
  );
}
