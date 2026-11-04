import { NodeIcon } from '../icons/NodeIcon';
import { nodeSubtitle, nodeTitle, type DiagramNode } from '../doc/types';
import { hexToRgba, type NodeRisk } from '../doc/risk';
import { discoveryOnly, openPorts, serviceLabel } from '../model/types';

const MAX_PORTS = 10;
const MAX_SCRIPTS = 3;
const MAX_NOTES = 260;

type HoverCardProps = {
  node: DiagramNode;
  anchor: { left: number; top: number; right: number; bottom: number };
  childCount?: number;
  risk?: NodeRisk | null;
};

const KIND_LABEL: Record<DiagramNode['kind'], string> = {
  host: 'host',
  section: 'section',
  note: 'note',
  hop: 'hop',
  origin: 'scan origin',
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function HoverCard({ node, anchor, childCount, risk }: HoverCardProps) {
  const width = 380;
  const gap = 14;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const fitsRight = anchor.right + gap + width + 8 <= viewportW;
  const fitsLeft = anchor.left - gap - width >= 8;
  const left = clamp(
    fitsRight ? anchor.right + gap : fitsLeft ? anchor.left - gap - width : anchor.left,
    8,
    Math.max(8, viewportW - width - 8),
  );
  const top = clamp(
    fitsRight || fitsLeft ? anchor.top : anchor.bottom + 10,
    12,
    Math.max(12, viewportH - 420),
  );

  const host = node.host;
  const ports = host ? openPorts(host) : [];
  const shown = ports.slice(0, MAX_PORTS);
  const scripts = host ? [...host.scripts, ...host.ports.flatMap((port) => port.scripts)] : [];
  const notes = (node.notes ?? '').trim();

  return (
    <div className="hover-card" style={{ left: clamp(left, 8, viewportW - width - 8), top, width }} role="tooltip">
      <header className="hover-card__head">
        <NodeIcon id={node.icon ?? (node.kind === 'section' ? 'server' : 'unknown')} size={16} />
        <div className="hover-card__titles">
          <span className="hover-card__title mono">{nodeTitle(node)}</span>
          {nodeSubtitle(node) && <span className="hover-card__sub">{nodeSubtitle(node)}</span>}
        </div>
        <span className="hover-card__kind">{KIND_LABEL[node.kind]}</span>
      </header>

      {node.kind === 'section' && (
        <div className="hover-card__facts">
          <div>
            <span>Subnet</span>
            <strong className="mono">{node.cidr ?? '–'}</strong>
          </div>
          <div>
            <span>Nodes</span>
            <strong>{childCount ?? 0}</strong>
          </div>
          {node.collapsed && (
            <div>
              <span>State</span>
              <strong>collapsed</strong>
            </div>
          )}
        </div>
      )}

      {(node.kind === 'hop' || node.kind === 'origin') && (
        <div className="hover-card__facts">
          <div className={node.kind === 'origin' ? 'is-wide' : undefined}>
            <span>Address</span>
            <strong className="mono">{node.address ?? '–'}</strong>
          </div>
          {node.depth !== undefined && (
            <div>
              <span>Depth</span>
              <strong>{node.depth}</strong>
            </div>
          )}
          {node.subtitle && (
            <div>
              <span>Detail</span>
              <strong>{node.subtitle}</strong>
            </div>
          )}
        </div>
      )}

      {host && (
        <>
          <div className="hover-card__facts">
            <div>
              <span>Status</span>
              <strong className={host.status === 'down' ? 'is-down' : undefined}>{host.status}</strong>
            </div>
            {risk && (
              <div>
                <span>Risk</span>
                <strong style={{ color: risk.color }}>
                  {risk.label} · {risk.ports.length}
                </strong>
              </div>
            )}
            {host.hostnames.length > 0 && (
              <div className="is-wide">
                <span>Hostnames</span>
                <strong>{host.hostnames.join(', ')}</strong>
              </div>
            )}
            {host.mac && (
              <div className="is-wide">
                <span>MAC</span>
                <strong className="mono">
                  {host.mac}
                  {host.vendor ? <em> · {host.vendor}</em> : null}
                </strong>
              </div>
            )}
            {host.os.length > 0 && (
              <div>
                <span>OS</span>
                <strong>
                  {host.os[0].name}
                  {host.os[0].accuracy ? <em> ({host.os[0].accuracy}%)</em> : null}
                </strong>
              </div>
            )}
            {host.hops.length > 0 && (
              <div className="is-wide">
                <span>Route</span>
                <strong className="mono">{host.hops.join(' → ')}</strong>
              </div>
            )}
          </div>

          <div className="hover-card__block">
            <span className="hover-card__label">
              {discoveryOnly(host) ? 'Ports' : `Open ports (${ports.length})`}
            </span>
            {discoveryOnly(host) ? (
              <p className="hover-card__empty">Discovery scan – this host was never port-scanned.</p>
            ) : ports.length === 0 ? (
              <p className="hover-card__empty">No open ports.</p>
            ) : (
              <ul className="hover-card__ports">
                {shown.map((port) => {
                  const badge = risk?.badges[String(port.port)];
                  return (
                    <li key={`${port.protocol}-${port.port}`}>
                      <span
                        className={`hover-card__port mono${badge ? ' is-risky' : ''}`}
                        title={badge ? `${badge.label} port` : undefined}
                        style={
                          badge
                            ? { borderColor: hexToRgba(badge.color, 0.5), color: badge.color, background: hexToRgba(badge.color, 0.14) }
                            : undefined
                        }
                      >
                        {port.port}/{port.protocol}
                      </span>
                      <span className="hover-card__service">
                        {serviceLabel(port)}
                        {port.extrainfo ? <em> · {port.extrainfo}</em> : null}
                      </span>
                    </li>
                  );
                })}
                {ports.length > shown.length && (
                  <li className="hover-card__more">+{ports.length - shown.length} more in the inspector</li>
                )}
              </ul>
            )}
          </div>

          {scripts.length > 0 && (
            <div className="hover-card__block">
              <span className="hover-card__label">Scripts ({scripts.length})</span>
              <ul className="hover-card__scripts">
                {scripts.slice(0, MAX_SCRIPTS).map((script, index) => (
                  <li key={`${script.id}-${index}`}>
                    <span className="mono">{script.id}</span>
                    <em>{(script.output.split('\n')[0] ?? '').slice(0, 90)}</em>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {notes.length > 0 && (
        <div className="hover-card__block">
          <span className="hover-card__label">{node.kind === 'note' ? 'Note' : 'Notes'}</span>
          <p className="hover-card__notes">
            {notes.length > MAX_NOTES ? `${notes.slice(0, MAX_NOTES)}…` : notes}
          </p>
        </div>
      )}
    </div>
  );
}
