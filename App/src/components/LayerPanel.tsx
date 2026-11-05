import { useCallback, useEffect, useRef, useState } from 'react';
import { flattenLayers, LAYER_COLORS, type Layer } from '../doc/types';

const PANEL_WIDTH_KEY = 'nmap2flowchart.layerPanelWidth';
const PANEL_MIN = 190;
const PANEL_MAX = 420;
const PANEL_DEFAULT = 236;

function clampWidth(width: number): number {
  const ceiling = Math.min(PANEL_MAX, Math.round(window.innerWidth * 0.45));
  return Math.max(PANEL_MIN, Math.min(ceiling, Math.round(width)));
}

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampWidth(stored);
  } catch {
    // Private mode or blocked storage: fall back to the default width.
  }
  return PANEL_DEFAULT;
}

type LayerPanelProps = {
  layers: Layer[];
  activeLayerId: string;
  focusedLayerId: string | null;
  counts: Map<string, number>;
  dropLayerId?: string | null;
  dragging?: boolean;
  onSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onFocus: (id: string | null) => void;
  onAdd: (parentId: string | null) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string, mode: 'keep' | 'all') => void;
  onMove: (id: string, delta: -1 | 1) => void;
  /** A view-only share link: only selecting and focusing stay interactive. */
  readOnly?: boolean;
  panelRef?: React.Ref<HTMLElement>;
};

export function LayerPanel({
  layers,
  activeLayerId,
  focusedLayerId,
  counts,
  dropLayerId,
  dragging,
  onSelect,
  onToggleVisible,
  onFocus,
  onAdd,
  onRename,
  onRecolor,
  onDelete,
  onMove,
  readOnly = false,
  panelRef,
}: LayerPanelProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const rows = flattenLayers(layers);

  const commitWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    } catch {
      // Non-fatal: the width just will not survive a reload.
    }
  }, []);

  // Re-clamp when the window shrinks so the panel never eats the canvas.
  useEffect(() => {
    const onResize = () => setWidth((current) => clampWidth(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <aside className="layer-panel" ref={panelRef} style={{ width }}>
      <div
        className={`layer-panel__resizer${resizing ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the layers panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={PANEL_MAX}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        data-tooltip="Drag to resize"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startX: event.clientX, startWidth: width };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          setWidth(clampWidth(state.startWidth + (event.clientX - state.startX)));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          setResizing(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          commitWidth(width);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setResizing(false);
        }}
        onDoubleClick={() => commitWidth(PANEL_DEFAULT)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            commitWidth(width - 16);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            commitWidth(width + 16);
          } else if (event.key === 'Home') {
            event.preventDefault();
            commitWidth(PANEL_DEFAULT);
          }
        }}
      />
      <header className="layer-panel__head">
        <span>Layers</span>
        {!readOnly && (
          <button type="button" className="icon-button" title="New top-level layer" data-tooltip="New top-level layer" aria-label="New top-level layer" onClick={() => onAdd(null)}>
            +
          </button>
        )}
      </header>

      <div className="layer-panel__list">
        {rows.map(({ layer, depth }) => {
          const count = counts.get(layer.id) ?? 0;
          const isFocused = focusedLayerId === layer.id;
          const siblings = layers.filter((item) => item.parentId === layer.parentId);
          const siblingIndex = siblings.findIndex((item) => item.id === layer.id);
          const canMoveUp = siblingIndex > 0;
          const canMoveDown = siblingIndex >= 0 && siblingIndex < siblings.length - 1;

          if (confirming === layer.id) {
            return (
              <div key={layer.id} className="layer-confirm" style={{ paddingLeft: 10 + depth * 12 }}>
                <p>
                  Delete <strong>{layer.name}</strong>?
                </p>
                <div className="layer-confirm__actions">
                  <button
                    type="button"
                    className="btn btn--tiny"
                    onClick={() => {
                      onDelete(layer.id, 'keep');
                      setConfirming(null);
                    }}
                  >
                    Keep {count} node{count === 1 ? '' : 's'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--tiny btn--danger"
                    onClick={() => {
                      onDelete(layer.id, 'all');
                      setConfirming(null);
                    }}
                  >
                    Delete all
                  </button>
                  <button type="button" className="btn btn--tiny btn--ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={layer.id}
              data-layer-id={layer.id}
              className={`layer-row${layer.id === activeLayerId ? ' is-active' : ''}${
                isFocused ? ' is-focused' : ''
              }${layer.visible ? '' : ' is-hidden'}${dropLayerId === layer.id ? ' is-drop-target' : ''}${
                dragging && dropLayerId !== layer.id ? ' is-droppable' : ''
              }`}
              style={{ paddingLeft: 6 + depth * 13 }}
              onClick={() => onSelect(layer.id)}
            >
              <button
                type="button"
                className="layer-row__eye"
                title={layer.visible ? 'Hide layer' : 'Show layer'}
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                data-tooltip={readOnly ? undefined : layer.visible ? 'Hide layer' : 'Show layer'}
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisible(layer.id);
                }}
              >
                <span aria-hidden="true">{layer.visible ? '◉' : '◌'}</span>
                <span className="sr-only">{layer.visible ? 'Visible' : 'Hidden'}</span>
              </button>
              <button
                type="button"
                className="layer-row__swatch"
                title={readOnly ? 'Layer colour' : 'Cycle colour'}
                aria-label="Cycle layer colour"
                data-tooltip={readOnly ? undefined : 'Cycle colour'}
                style={{ background: layer.color }}
                disabled={readOnly}
                onClick={(event) => {
                  event.stopPropagation();
                  const index = LAYER_COLORS.indexOf(layer.color);
                  onRecolor(layer.id, LAYER_COLORS[(index + 1) % LAYER_COLORS.length]);
                }}
              />
              {renaming === layer.id ? (
                <input
                  autoFocus
                  className="layer-row__input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    onRename(layer.id, draft.trim() || layer.name);
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span
                  className="layer-row__name"
                  onDoubleClick={(event) => {
                    if (readOnly) return;
                    event.stopPropagation();
                    setDraft(layer.name);
                    setRenaming(layer.id);
                  }}
                  title={readOnly ? layer.name : 'Double-click to rename'}
                >
                  {layer.name}
                </span>
              )}
              <span className="layer-row__count">{count}</span>
              <div className="layer-row__actions">
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      className="layer-row__action layer-row__action--shift"
                      title="Move layer up (draws over the layers below)"
                      aria-label="Move layer up"
                      data-tooltip="Move layer up"
                      disabled={!canMoveUp}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMove(layer.id, -1);
                      }}
                    >
                      ▴
                    </button>
                    <button
                      type="button"
                      className="layer-row__action layer-row__action--shift"
                      title="Move layer down (draws under the layers above)"
                      aria-label="Move layer down"
                      data-tooltip="Move layer down"
                      disabled={!canMoveDown}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMove(layer.id, 1);
                      }}
                    >
                      ▾
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`layer-row__action${isFocused ? ' is-on' : ''}`}
                  title={isFocused ? 'Stop focusing' : 'Focus layer'}
                  aria-label={isFocused ? 'Stop focusing layer' : 'Focus layer'}
                  data-tooltip={isFocused ? 'Stop focusing' : 'Focus layer'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFocus(isFocused ? null : layer.id);
                  }}
                >
                  ◎
                </button>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      className="layer-row__action"
                      title="New sublayer"
                      aria-label={`Add sublayer to ${layer.name}`}
                      data-tooltip="New sublayer"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAdd(layer.id);
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="layer-row__action"
                      title="Delete layer"
                      aria-label={`Delete layer ${layer.name}`}
                      data-tooltip="Delete layer"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (count === 0) onDelete(layer.id, 'keep');
                        else setConfirming(layer.id);
                      }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="layer-panel__hint">
        {readOnly
          ? 'This link is view only – layers can be inspected, not edited.'
          : dropLayerId
            ? 'Release to move the selection onto this layer.'
            : dragging
              ? 'Drop the node on a layer to move it there.'
              : 'Drag nodes from the canvas onto a layer to move them, or click a layer to make it active.'}
      </p>

      <footer className="layer-panel__foot">
        <a
          className="layer-panel__credit"
          href="https://github.com/jonesckevin"
          target="_blank"
          rel="noreferrer noopener"
          title="github.com/jonesckevin"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          Jonesckevin
        </a>
      </footer>
    </aside>
  );
}
