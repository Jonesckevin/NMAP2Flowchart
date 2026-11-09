import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DiagramDoc } from '../doc/types';
import type { NmapHost } from '../model/types';
import { CommonPortsDialog } from './CommonPortsDialog';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  RISK_COLORS,
  RISK_SCOPE_LABEL,
  cloneRiskPolicy,
  defaultRiskPolicy,
  describePortCount,
  hexToRgba,
  parsePortSpec,
  riskStats,
  uniqueLevelId,
  type RiskLevel,
  type RiskPolicy,
  type RiskScope,
} from '../doc/risk';

type EditScope = 'diagram' | 'account';

type RiskLevelsDialogProps = {
  open: boolean;
  onClose: () => void;
  doc: DiagramDoc | null;
  /** Policy currently in force, whatever layer it came from. */
  policy: RiskPolicy;
  scope: RiskScope;
  diagramPolicy: RiskPolicy | null;
  accountPolicy: RiskPolicy | null;
  serverPolicy: RiskPolicy | null;
  canUseAccount: boolean;
  onSaveDiagram: (policy: RiskPolicy | null) => void;
  onSaveAccount: (policy: RiskPolicy) => Promise<boolean>;
};

function hostsOf(doc: DiagramDoc | null): NmapHost[] {
  if (!doc) return [];
  return doc.nodes.filter((node) => node.host).map((node) => node.host as NmapHost);
}

function basePolicyFor(
  editScope: EditScope,
  { diagramPolicy, accountPolicy, serverPolicy, policy }: RiskLevelsDialogProps,
): RiskPolicy {
  if (editScope === 'diagram') {
    return cloneRiskPolicy(diagramPolicy ?? accountPolicy ?? serverPolicy ?? policy);
  }
  return cloneRiskPolicy(accountPolicy ?? serverPolicy ?? policy);
}

export function RiskLevelsDialog(props: RiskLevelsDialogProps) {
  const { open, onClose, doc, policy, scope, serverPolicy, canUseAccount } = props;
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, open);
  const [editScope, setEditScope] = useState<EditScope>('diagram');
  const [draft, setDraft] = useState<RiskLevel[]>(() => cloneRiskPolicy(policy).levels);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commonOpen, setCommonOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextScope: EditScope = canUseAccount && scope === 'account' ? 'account' : 'diagram';
    setEditScope(nextScope);
    setDraft(basePolicyFor(nextScope, props).levels);
    setError(null);
    setBusy(false);
    setCommonOpen(false);
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('input, button:not([disabled])')?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
    };
    // Re-seed only when the dialog opens; typing must not reset the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewPolicy = useMemo<RiskPolicy>(() => ({ version: 1, levels: draft }), [draft]);
  const stats = useMemo(() => riskStats(hostsOf(doc), previewPolicy), [doc, previewPolicy]);
  const statsByLevel = useMemo(
    () => new Map(stats.levels.map((entry) => [entry.level.id, entry])),
    [stats],
  );
  const invalid = useMemo(
    () => draft.filter((level) => parsePortSpec(level.ports).invalid.length > 0),
    [draft],
  );

  if (!open) return null;

  const patch = (index: number, next: Partial<RiskLevel>) => {
    setDraft((levels) => levels.map((level, i) => (i === index ? { ...level, ...next } : level)));
  };

  const move = (index: number, delta: -1 | 1) => {
    setDraft((levels) => {
      const target = index + delta;
      if (target < 0 || target >= levels.length) return levels;
      const next = [...levels];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const remove = (index: number) => setDraft((levels) => levels.filter((_, i) => i !== index));

  const addLevel = () => {
    setDraft((levels) => {
      const label = `Level ${levels.length + 1}`;
      const level: RiskLevel = {
        id: uniqueLevelId(label, levels),
        label,
        color: RISK_COLORS[levels.length % RISK_COLORS.length],
        ports: '',
        enabled: true,
      };
      return [...levels, level];
    });
  };

  const switchScope = (next: EditScope) => {
    if (next === 'account' && !canUseAccount) return;
    setEditScope(next);
    setDraft(basePolicyFor(next, props).levels);
    setError(null);
  };

  const save = async () => {
    const cleaned = draft.map((level, index) => ({
      ...level,
      label: level.label.trim() || `Level ${index + 1}`,
      ports: level.ports.trim(),
    }));
    if (invalid.length > 0) {
      setError(`Fix the invalid port entries in ${invalid.map((level) => level.label).join(', ')} first.`);
      return;
    }
    if (editScope === 'account') {
      setBusy(true);
      setError(null);
      const ok = await props.onSaveAccount({ version: 1, levels: cleaned });
      setBusy(false);
      if (ok) onClose();
      else setError('The account service did not accept these levels.');
      return;
    }
    props.onSaveDiagram({ version: 1, levels: cleaned });
    onClose();
  };

  const inherit = () => {
    props.onSaveDiagram(null);
    onClose();
  };

  /** Appends a port to a level's spec without rewriting the ranges already there. */
  const addPortToLevel = (levelId: string, port: number) => {
    setDraft((levels) =>
      levels.map((level) => {
        if (level.id !== levelId) return level;
        if (parsePortSpec(level.ports).ports.includes(port)) return level;
        const spec = level.ports.trim().replace(/[,;\s]+$/, '');
        return { ...level, ports: spec ? `${spec}, ${port}` : String(port) };
      }),
    );
  };

  const scopeHint =
    editScope === 'diagram'
      ? scope === 'diagram'
        ? 'This diagram has its own levels, so it overrides the account and server defaults.'
        : `This diagram currently uses ${RISK_SCOPE_LABEL[scope]}.`
      : 'Levels saved to your account apply to every diagram that does not set its own.';

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
        className="dialog risk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="risk-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="account-eyebrow">Risk levels</span>
            <h2 id="risk-title">Which ports count as risky</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close risk levels" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="dialog__note">
          Each level has a list of ports – single ports (<code>22</code>) or ranges (<code>8000-8100</code>),
          separated by commas. A host takes the colour of the level highest in this list that has one of its
          open ports, so a red port always outranks an orange one.
        </p>

        <div className="risk-scope" role="radiogroup" aria-label="Where these levels apply">
          <button
            type="button"
            role="radio"
            aria-checked={editScope === 'diagram'}
            className={`risk-scope__option${editScope === 'diagram' ? ' is-on' : ''}`}
            onClick={() => switchScope('diagram')}
          >
            This diagram
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={editScope === 'account'}
            className={`risk-scope__option${editScope === 'account' ? ' is-on' : ''}`}
            disabled={!canUseAccount}
            title={canUseAccount ? undefined : 'Sign in to save levels for your account'}
            onClick={() => switchScope('account')}
          >
            My account
          </button>
          {serverPolicy && (
            <button
              type="button"
              className="risk-scope__option"
              onClick={() => setDraft(cloneRiskPolicy(serverPolicy).levels)}
            >
              Copy server levels
            </button>
          )}
        </div>
        <p className="dialog__note dialog__note--small">{scopeHint}</p>

        <ol className="risk-levels">
          {draft.map((level, index) => {
            const spec = parsePortSpec(level.ports);
            const levelStats = statsByLevel.get(level.id);
            const showInvalid = spec.invalid.length > 0;
            return (
              <li
                key={level.id}
                className={`risk-level${level.enabled ? '' : ' is-off'}`}
                style={{ '--level-color': level.color } as React.CSSProperties}
              >
                <div className="risk-level__head">
                  <span className="risk-level__rank" title="Priority – top wins">
                    {index + 1}
                  </span>
                  <div className="risk-level__move">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Raise ${level.label}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Lower ${level.label}`}
                      disabled={index === draft.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <input
                    type="color"
                    className="risk-level__color"
                    aria-label={`${level.label} colour`}
                    value={/^#[0-9a-f]{6}$/i.test(level.color) ? level.color : '#e5484d'}
                    onChange={(event) => patch(index, { color: event.target.value })}
                  />
                  <input
                    className="input risk-level__label"
                    aria-label="Level name"
                    value={level.label}
                    maxLength={40}
                    onChange={(event) => patch(index, { label: event.target.value })}
                  />
                  <label className="risk-level__toggle">
                    <input
                      type="checkbox"
                      checked={level.enabled}
                      onChange={(event) => patch(index, { enabled: event.target.checked })}
                    />
                    on
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${level.label}`}
                    onClick={() => remove(index)}
                  >
                    ✕
                  </button>
                </div>
                <div className="risk-level__body">
                  <input
                    className={`input input--mono risk-level__ports${showInvalid ? ' is-invalid' : ''}`}
                    aria-label={`${level.label} ports`}
                    placeholder="e.g. 21, 23, 8000-8100"
                    value={level.ports}
                    onChange={(event) => patch(index, { ports: event.target.value })}
                  />
                  <span className={`risk-level__hint${showInvalid ? ' is-error' : ''}`}>
                    {showInvalid
                      ? `Not a port or range: ${spec.invalid.join(', ')}`
                      : `${describePortCount(level.ports)}${
                          levelStats && levelStats.hosts > 0
                            ? ` · ${levelStats.hosts} host${levelStats.hosts === 1 ? '' : 's'} · ${levelStats.ports} open`
                            : ' · no matches in this diagram'
                        }`}
                  </span>
                </div>
                <div className="risk-level__palette">
                  {RISK_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`swatch${level.color.toLowerCase() === color ? ' is-active' : ''}`}
                      style={{ background: color }}
                      aria-label={`Use ${color} for ${level.label}`}
                      onClick={() => patch(index, { color })}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ol>

        {draft.length === 0 && (
          <p className="dialog__note dialog__note--small">No levels: nothing on this diagram is flagged.</p>
        )}

        <div className="risk-dialog__tools">
          <button type="button" className="btn btn--tiny" onClick={addLevel}>
            Add level
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            onClick={() => setDraft(defaultRiskPolicy().levels)}
          >
            Built-in defaults
          </button>
          <button
            type="button"
            className="btn btn--tiny risk-dialog__common"
            onClick={() => setCommonOpen(true)}
            title="Browse the common service ports and which level each one lands in"
          >
            Common ports…
          </button>
          <span className="risk-dialog__preview" aria-hidden="true">
            {draft
              .filter((level) => level.enabled)
              .map((level) => (
                <span
                  key={level.id}
                  className="risk-level__chip"
                  style={{
                    borderColor: hexToRgba(level.color, 0.5),
                    color: level.color,
                    background: hexToRgba(level.color, 0.14),
                  }}
                >
                  {level.label || 'Level'} · 445
                </span>
              ))}
          </span>
        </div>

        {error && <p className="dialog__error">{error}</p>}

        <div className="dialog__actions">
          {editScope === 'diagram' && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={!props.diagramPolicy}
              onClick={inherit}
              title="Stop overriding this diagram and use the inherited levels"
            >
              Use inherited levels
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--accent" disabled={busy || invalid.length > 0} onClick={() => void save()}>
            {busy ? 'Saving…' : editScope === 'diagram' ? 'Save to diagram' : 'Save to account'}
          </button>
        </div>
      </section>

      <CommonPortsDialog
        open={commonOpen}
        onClose={() => setCommonOpen(false)}
        policy={previewPolicy}
        onAddPort={addPortToLevel}
      />
    </div>,
    document.body,
  );
}
