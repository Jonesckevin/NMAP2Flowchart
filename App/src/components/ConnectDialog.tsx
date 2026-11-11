import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionAnalysis } from '../connect/analyze';
import {
  CONNECT_OPTION_HINTS,
  DEFAULT_CONNECT_OPTIONS,
  type ConnectOptions,
} from '../connect/build';
import { DEVICE_KIND_LABELS, OS_FAMILY_LABELS } from '../model/device';
import { useDialogFocus } from '../hooks/useDialogFocus';

const TONE_LABEL: Record<ConnectionAnalysis['findings'][number]['tone'], string> = {
  route: 'Route',
  mac: 'Hardware',
  name: 'Name',
  device: 'Device',
  note: 'Note',
};

const SHOWN_FINDINGS = 8;

type ConnectDialogProps = {
  open: boolean;
  analysis: ConnectionAnalysis | null;
  onClose: () => void;
  /** `focus` asks the editor to show only the new layer. */
  onCreate: (options: ConnectOptions, focus: boolean) => void;
};

/**
 * The review step of "Try to connect": what the imports agree on, which links the
 * map will draw, and the joins that change the picture. Mounted only while open,
 * so every run starts from the defaults.
 */
function ConnectPanel({
  analysis,
  onClose,
  onCreate,
}: Omit<ConnectDialogProps, 'open' | 'analysis'> & { analysis: ConnectionAnalysis }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  const [options, setOptions] = useState<ConnectOptions>(DEFAULT_CONNECT_OPTIONS);
  const [focusLayer, setFocusLayer] = useState(true);
  const [allFindings, setAllFindings] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => dialogRef.current?.querySelector<HTMLElement>('.btn--accent')?.focus(),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  const { stats, findings } = analysis;
  const shown = allFindings ? findings : findings.slice(0, SHOWN_FINDINGS);
  const hidden = findings.length - shown.length;

  const lifted = [
    stats.devices > 0 ? `${stats.devices} router${stats.devices === 1 ? '' : 's'}` : '',
    stats.switches > 0 ? `${stats.switches} switch${stats.switches === 1 ? '' : 'es'}` : '',
  ].filter(Boolean);
  const paired =
    stats.pairs > 0
      ? `${stats.pairs} router${stats.pairs === 1 ? '' : 's'} read as a WAN and LAN address`
      : '';

  const optionCount = (key: keyof ConnectOptions): number => {
    if (key === 'macLinks') return stats.links['same-mac'] + stats.links['address-alias'];
    if (key === 'hostnameLinks') return stats.links['same-hostname'];
    return stats.joinable;
  };

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="eyebrow">Try to connect</span>
            <h2 id="connect-title">Find the network in this diagram</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close connect preview" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="connect-dialog__lede">
          Reads every host and hop card on every layer – traceroute hops, MAC addresses, PTR names and
          /24s – and draws a copy of the diagram as a path from the scan origin through its routers to
          each subnet. The current layers are not changed.
        </p>

        <div className="import-preview__grid">
          <div>
            <strong>{stats.hosts}</strong>
            <span>hosts</span>
          </div>
          <div>
            <strong>{stats.routers + stats.devices}</strong>
            <span>routers</span>
          </div>
          <div>
            <strong>{stats.segments}</strong>
            <span>subnets</span>
          </div>
          <div>
            <strong>{stats.routes}</strong>
            <span>routes</span>
          </div>
        </div>

        <p className="import-preview__effect">
          {stats.traced} traced · {stats.untraced} without a traceroute
          {lifted.length > 0 ? ` · ${lifted.join(' and ')} kept outside the subnet frames` : ''}
          {paired ? ` · ${paired}` : ''} ·{' '}
          {stats.layers === 1 ? 'one layer read' : `${stats.layers} layers read`}
        </p>

        {stats.kinds.length > 0 && (
          <ul className="connect-kinds" aria-label="What the signatures say these cards are">
            {stats.kinds.slice(0, 8).map(({ kind, count }) => (
              <li key={kind}>
                <b>{count}</b> {DEVICE_KIND_LABELS[kind]}
              </li>
            ))}
          </ul>
        )}
        {stats.systems.length > 0 && (
          <ul className="connect-kinds connect-kinds--os" aria-label="The platforms the signatures point at">
            {stats.systems.slice(0, 6).map(({ os, count }) => (
              <li key={os}>
                <b>{count}</b> {OS_FAMILY_LABELS[os]}
              </li>
            ))}
          </ul>
        )}
        {stats.platforms.length > 0 && (
          <ul className="connect-kinds connect-kinds--vm" aria-label="Cards whose NIC belongs to a hypervisor">
            {stats.platforms.slice(0, 4).map(({ platform, count }) => (
              <li key={platform}>
                <b>{count}</b> on {platform}
              </li>
            ))}
          </ul>
        )}

        <ul className="connect-findings" aria-label="What the imports agree on">
          {shown.map((finding, index) => (
            <li key={`${finding.tone}-${index}`} className={`connect-finding is-${finding.tone}`}>
              <span className="connect-finding__badge">{TONE_LABEL[finding.tone]}</span>
              <span>
                <strong>{finding.title}</strong>
                <em>{finding.detail}</em>
              </span>
            </li>
          ))}
        </ul>
        {!allFindings && hidden > 0 && (
          <button
            type="button"
            className="connect-dialog__more"
            onClick={() => setAllFindings(true)}
          >
            {hidden} more finding{hidden === 1 ? '' : 's'}
          </button>
        )}

        <fieldset className="connect-options">
          <legend>What to draw</legend>
          {CONNECT_OPTION_HINTS.map((entry) => {
            const count = optionCount(entry.key);
            return (
              <label key={entry.key} className={`connect-option${count === 0 ? ' is-empty' : ''}`}>
                <input
                  type="checkbox"
                  checked={options[entry.key]}
                  disabled={count === 0}
                  onChange={(event) =>
                    setOptions((current) => ({ ...current, [entry.key]: event.target.checked }))
                  }
                />
                <span>
                  <strong>
                    {entry.label}
                    <b>{count}</b>
                  </strong>
                  <em>{count === 0 ? 'nothing to join in these imports' : entry.hint}</em>
                </span>
              </label>
            );
          })}
          <label className="connect-option">
            <input
              type="checkbox"
              checked={focusLayer}
              onChange={(event) => setFocusLayer(event.target.checked)}
            />
            <span>
              <strong>Show only the new layer</strong>
              <em>hide the source layers while you review the map · the focus chip clears it</em>
            </span>
          </label>
        </fieldset>

        <p className="connect-dialog__footnote">
          The map is a copy on its own layer – undo removes it, and the layers it was built from keep
          their cards exactly where they are.
        </p>

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--accent" onClick={() => onCreate(options, focusLayer)}>
            Create map layer
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function ConnectDialog({ open, analysis, onClose, onCreate }: ConnectDialogProps) {
  if (!open || !analysis) return null;
  return <ConnectPanel analysis={analysis} onClose={onClose} onCreate={onCreate} />;
}
