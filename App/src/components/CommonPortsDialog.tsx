import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COMMON_PORTS, MAX_RISK_LEVELS, hexToRgba, levelForPort, type RiskLevel, type RiskPolicy } from '../doc/risk';

type CommonPortsDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The levels being edited, so the colours match what the user is looking at. */
  policy: RiskPolicy;
  /** Adds a port to a level's spec, e.g. "22, 445" → "22, 445, 8006". */
  onAddPort: (levelId: string, port: number) => void;
};

function covers(level: RiskLevel, port: number): boolean {
  for (const token of level.ports.split(/[,;\s]+/)) {
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(token);
    if (!match) continue;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (port >= from && port <= to) return true;
  }
  return false;
}

/** Mounted only while open, so the filter resets on every open. */
function CommonPortsPanel({
  onClose,
  policy,
  onAddPort,
}: Omit<CommonPortsDialogProps, 'open'>) {
  const dialogRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

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

  const levels = policy.levels.filter((level) => level.enabled);
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const rows = COMMON_PORTS.map((entry) => ({
      ...entry,
      level: levelForPort(entry.port, policy),
    })).filter(
      (entry) =>
        !needle ||
        String(entry.port).includes(needle) ||
        entry.service.toLowerCase().includes(needle) ||
        (entry.note ?? '').toLowerCase().includes(needle) ||
        (entry.level?.label ?? '').toLowerCase().includes(needle),
    );

    return {
      // Keep the policy order (highest priority first) and collect unmatched last.
      matched: levels
        .map((level) => ({ level, ports: rows.filter((row) => row.level?.id === level.id) }))
        .filter((group) => group.ports.length > 0),
      unassigned: rows.filter((row) => !row.level),
      total: rows.length,
    };
  }, [levels, needle, policy]);

  const levelCount = policy.levels.length;  const canAdd = levelCount < MAX_RISK_LEVELS;

  return createPortal(
    <div
      className="dialog-backdrop dialog-backdrop--stacked"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog common-ports"
        role="dialog"
        aria-modal="true"
        aria-labelledby="common-ports-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="account-eyebrow">Reference</span>
            <h2 id="common-ports-title">Common ports</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close common ports" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="dialog__note">
          The service ports a scan usually finds, grouped by the level each one lands in with the current
          levels. Use <strong>Add</strong> to put a port into the level above it – handy when a range in your
          own setup is missing a well-known port.
        </p>

        <div className="common-ports__toolbar">
          <input
            className="input"
            type="search"
            value={query}
            placeholder="Filter port, service or level…"
            aria-label="Filter common ports"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="common-ports__count">{groups.total} shown</span>
        </div>

        <div className="common-ports__body">
          {groups.matched.map(({ level, ports }) => (
            <section key={level.id} className="common-ports__group" style={{ '--level-color': level.color } as React.CSSProperties}>
              <h3 className="common-ports__grouphead">
                <i style={{ background: level.color }} />
                {level.label}
                <em>{ports.length} port{ports.length === 1 ? '' : 's'}</em>
              </h3>
              <ul className="common-ports__list">
                {ports.map((entry) => {
                  const listed = covers(level, entry.port);
                  return (
                    <li key={entry.port} className={listed ? 'is-listed' : ''}>
                      <span className="mono common-ports__port">{entry.port}</span>
                      <span className="common-ports__service">{entry.service}</span>
                      {entry.note && <span className="common-ports__note">{entry.note}</span>}
                      {listed ? (
                        <span className="common-ports__badge" title={`Already in ${level.label}`}>
                          listed
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--tiny common-ports__add"
                          style={{
                            borderColor: hexToRgba(level.color, 0.5),
                            color: level.color,
                            background: hexToRgba(level.color, 0.12),
                          }}
                          title={`Add ${entry.port} to ${level.label}`}
                          onClick={() => onAddPort(level.id, entry.port)}
                        >
                          Add
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {groups.unassigned.length > 0 && (
            <section className="common-ports__group common-ports__group--none">
              <h3 className="common-ports__grouphead">
                <i />
                Not flagged by any level
                <em>{groups.unassigned.length} ports</em>
              </h3>
              <ul className="common-ports__list">
                {groups.unassigned.map((entry) => (
                  <li key={entry.port}>
                    <span className="mono common-ports__port">{entry.port}</span>
                    <span className="common-ports__service">{entry.service}</span>
                    {entry.note && <span className="common-ports__note">{entry.note}</span>}
                    {levels[0] && canAdd && (
                      <button
                        type="button"
                        className="btn btn--tiny common-ports__add"
                        title={`Add ${entry.port} to ${levels[0].label}`}
                        onClick={() => onAddPort(levels[0].id, entry.port)}
                      >
                        Add
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groups.total === 0 && <p className="dialog__note">Nothing matches “{query}”.</p>}
        </div>

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}


export function CommonPortsDialog({ open, onClose, policy, onAddPort }: CommonPortsDialogProps) {
  if (!open) return null;
  return <CommonPortsPanel onClose={onClose} policy={policy} onAddPort={onAddPort} />;
}
