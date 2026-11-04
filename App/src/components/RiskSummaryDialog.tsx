import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isLayerVisible, layerMap, type DiagramDoc } from '../doc/types';
import {
  RISK_SCOPE_LABEL,
  riskSummary,
  type RiskPolicy,
  type RiskScope,
  type RiskSummary,
} from '../doc/risk';
import type { RiskReportScope } from '../export/riskReport';

type RiskSummaryDialogProps = {
  open: boolean;
  onClose: () => void;
  doc: DiagramDoc | null;
  policy: RiskPolicy;
  /** Which layer supplied `policy`. */
  policyScope: RiskScope;
  onSelectNode: (nodeId: string) => void;
  /** Receives exactly what the panel is listing, filter included. */
  onExport: (format: 'csv' | 'json', summary: RiskSummary, scope: RiskReportScope, scopeNote: string) => void;
};

/** Narrows a summary to the rows whose level, port, service or host matches. */
function filterSummary(summary: RiskSummary, needle: string): RiskSummary {
  const value = needle.trim().toLowerCase();
  if (!value) return summary;
  return {
    ...summary,
    levels: summary.levels
      .map((entry) => {
        // A matching level name keeps the whole branch; otherwise keep the ports
        // that match by number/service, or just the hosts that match.
        const levelMatch = entry.level.label.toLowerCase().includes(value);
        const ports = levelMatch
          ? entry.ports
          : entry.ports.flatMap((port) => {
              if (`${port.port} ${port.service}`.toLowerCase().includes(value)) return [port];
              const hosts = port.hosts.filter((host) =>
                `${host.label} ${host.hostname} ${host.layer}`.toLowerCase().includes(value),
              );
              return hosts.length > 0 ? [{ ...port, hosts }] : [];
            });
        return { ...entry, ports };
      })
      .filter((entry) => entry.ports.length > 0),
  };
}

const distinctHosts = (entry: RiskSummary['levels'][number]) =>
  new Set(entry.ports.flatMap((port) => port.hosts.map((host) => host.nodeId))).size;

const opensOf = (entry: RiskSummary['levels'][number]) =>
  entry.ports.reduce((total, port) => total + port.hosts.length, 0);

/** Mounted only while open, so scope, filter and expansion reset on every open. */
function RiskSummaryPanel(props: Omit<RiskSummaryDialogProps, 'open'> & { doc: DiagramDoc }) {
  const { onClose, doc, policy, policyScope, onSelectNode, onExport } = props;
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const [scope, setScope] = useState<RiskReportScope>('view');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const timer = window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('input')?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const layers = useMemo(() => layerMap(doc.layers), [doc]);
  const viewNodes = useMemo(
    () => doc.nodes.filter((node) => node.host && isLayerVisible(layers, node.layerId, doc.focusedLayerId)),
    [doc, layers],
  );
  const allNodes = useMemo(() => doc.nodes.filter((node) => node.host), [doc]);

  const full = useMemo(
    () => riskSummary(scope === 'view' ? viewNodes : allNodes, policy, layers),
    [scope, viewNodes, allNodes, policy, layers],
  );
  const shown = useMemo(() => filterSummary(full, query), [full, query]);

  const filtered = query.trim().length > 0;
  // While filtering, the totals describe the rows that match, not the whole scope.
  const totals = filtered
    ? {
        hosts: new Set(
          shown.levels.flatMap((entry) => entry.ports.flatMap((port) => port.hosts.map((host) => host.nodeId))),
        ).size,
        open: shown.levels.reduce((total, entry) => total + opensOf(entry), 0),
        ports: shown.levels.reduce((total, entry) => total + entry.ports.length, 0),
      }
    : { hosts: full.hosts, open: full.open, ports: full.ports };
  const scopeNote = (() => {
    if (scope === 'diagram') return 'whole diagram (hidden cards included)';
    const hidden = allNodes.length - viewNodes.length;
    const focus = doc.focusedLayerId ? layers.get(doc.focusedLayerId)?.name : null;
    const parts: string[] = [];
    if (focus) parts.push(`focused layer “${focus}”`);
    if (hidden > 0) parts.push(`${hidden} card${hidden === 1 ? '' : 's'} hidden`);
    return parts.length > 0 ? `current view (${parts.join(' · ')})` : 'current view (everything is visible)';
  })();

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const expandAll = () =>
    setExpanded(
      new Set(
        shown.levels.flatMap((entry) => [
          `level:${entry.level.id}`,
          ...entry.ports.map((port) => `port:${entry.level.id}:${port.port}`),
        ]),
      ),
    );

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
        className="dialog risk-dialog risk-summary"
        role="dialog"
        aria-modal="true"
        aria-labelledby="risk-summary-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="account-eyebrow">Risk</span>
            <h2 id="risk-summary-title">Risk summary</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close risk summary" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="risk-scope" role="radiogroup" aria-label="Which cards to summarise">
          <button
            type="button"
            role="radio"
            aria-checked={scope === 'view'}
            className={`risk-scope__option${scope === 'view' ? ' is-on' : ''}`}
            onClick={() => setScope('view')}
          >
            This view
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scope === 'diagram'}
            className={`risk-scope__option${scope === 'diagram' ? ' is-on' : ''}`}
            onClick={() => setScope('diagram')}
          >
            Whole diagram
          </button>
        </div>
        <p className="dialog__note dialog__note--small">
          {scopeNote} · levels from {RISK_SCOPE_LABEL[policyScope]}
        </p>

        <div className="risk-summary__totals">
          <div>
            <strong>{totals.hosts}</strong>
            <span>flagged card{totals.hosts === 1 ? '' : 's'}</span>
          </div>
          <div>
            <strong>{totals.open}</strong>
            <span>flagged ports</span>
          </div>
          <div>
            <strong>{totals.ports}</strong>
            <span>distinct ports</span>
          </div>
        </div>

        <div className="risk-summary__toolbar">
          <input
            className="input risk-summary__search"
            type="search"
            value={query}
            placeholder="Filter level, port, service or host…"
            aria-label="Filter risk summary"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="btn btn--tiny" onClick={expandAll}>
            Expand all
          </button>
          <button type="button" className="btn btn--tiny" onClick={() => setExpanded(new Set())}>
            Collapse all
          </button>
        </div>

        <div className="risk-summary__tree">
          {shown.levels.length === 0 && (
            <p className="dialog__note">
              {filtered
                ? 'Nothing matches that filter.'
                : `No flagged ports in the ${scope === 'view' ? 'current view' : 'diagram'}.`}
            </p>
          )}
          {shown.levels.map((entry) => {
            const levelKey = `level:${entry.level.id}`;
            const levelOpen = expanded.has(levelKey);
            if (entry.ports.length === 0) {
              return (
                <div
                  key={entry.level.id}
                  className="risk-node risk-node--empty"
                  style={{ '--level-color': entry.level.color } as React.CSSProperties}
                >
                  <span className="risk-node__dot" />
                  <span className="risk-node__label">{entry.level.label}</span>
                  <span className="risk-node__meta">no matches</span>
                </div>
              );
            }
            const hosts = distinctHosts(entry);
            const opens = opensOf(entry);
            return (
              <div key={entry.level.id} className="risk-branch">
                <button
                  type="button"
                  className={`risk-node risk-node--level${levelOpen ? ' is-open' : ''}`}
                  style={{ '--level-color': entry.level.color } as React.CSSProperties}
                  aria-expanded={levelOpen}
                  onClick={() => toggle(levelKey)}
                >
                  <span className="risk-node__caret" aria-hidden="true">
                    ▸
                  </span>
                  <span className="risk-node__dot" />
                  <span className="risk-node__label">{entry.level.label}</span>
                  <span className="risk-node__meta">
                    {hosts} card{hosts === 1 ? '' : 's'} · {opens} port{opens === 1 ? '' : 's'}
                    {!filtered && entry.topHosts > 0 && entry.topHosts !== hosts
                      ? ` · ${entry.topHosts} lead here`
                      : ''}
                  </span>
                </button>
                {levelOpen && (
                  <ul className="risk-children">
                    {entry.ports.map((port) => {
                      const portKey = `port:${entry.level.id}:${port.port}`;
                      const portOpen = expanded.has(portKey);
                      return (
                        <li key={port.port}>
                          <button
                            type="button"
                            className={`risk-node risk-node--port${portOpen ? ' is-open' : ''}`}
                            aria-expanded={portOpen}
                            onClick={() => toggle(portKey)}
                          >
                            <span className="risk-node__caret" aria-hidden="true">
                              ▸
                            </span>
                            <span className="mono risk-node__port">{port.port}</span>
                            {port.service && <span className="risk-node__service">{port.service}</span>}
                            <span className="risk-node__meta">
                              {port.hosts.length} host{port.hosts.length === 1 ? '' : 's'}
                            </span>
                          </button>
                          {portOpen && (
                            <ul className="risk-children risk-children--hosts">
                              {port.hosts.map((host) => (
                                <li key={host.nodeId}>
                                  <button
                                    type="button"
                                    className="risk-node risk-node--host"
                                    title="Select this card on the canvas"
                                    onClick={() => {
                                      onSelectNode(host.nodeId);
                                      onClose();
                                    }}
                                  >
                                    <span className="mono">{host.label}</span>
                                    {host.hostname && <span className="risk-node__service">{host.hostname}</span>}
                                    {host.layer && <span className="risk-node__meta">{host.layer}</span>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="dialog__actions risk-summary__actions">
          <span className="risk-summary__footnote">
            Exports follow this {filtered ? 'filter and scope' : 'scope'}
            {filtered ? ` (${query.trim()})` : ''} · one row per flagged card and port.
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => onExport('json', shown, scope, scopeNote)}>
            Export JSON
          </button>
          <button type="button" className="btn btn--accent" onClick={() => onExport('csv', shown, scope, scopeNote)}>
            Export CSV
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function RiskSummaryDialog({ open, doc, ...rest }: RiskSummaryDialogProps) {
  if (!open || !doc) return null;
  return <RiskSummaryPanel doc={doc} {...rest} />;
}
