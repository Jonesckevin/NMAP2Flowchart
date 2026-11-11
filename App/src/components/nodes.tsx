import { memo, useCallback, useRef } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { AppNode } from '../graph/buildRfGraph';
import { discoveryOnly, openPorts } from '../model/types';
import { hexToRgba } from '../doc/risk';
import { NodeIcon } from '../icons/NodeIcon';
import { nodeSubtitle, nodeTitle } from '../doc/types';
import { virtualPlatformOf } from '../model/device';

const MAX_BADGES = 2;

/** The four sides a line can leave from or arrive at, in tab order around the card. */
const HANDLE_SIDES = [
  { id: 'l', position: Position.Left },
  { id: 't', position: Position.Top },
  { id: 'r', position: Position.Right },
  { id: 'b', position: Position.Bottom },
] as const;

/**
 * Every card offers the same four connector points. React Flow runs in loose mode,
 * so a handle is a start *or* an end – you draw the line from whichever side you
 * want and drop it on whichever side of the other card.
 */
const NodeHandles = memo(function NodeHandles() {
  return (
    <>
      {HANDLE_SIDES.map((side) => (
        <Handle key={side.id} id={side.id} type="source" position={side.position} className="node-handle" />
      ))}
    </>
  );
});

export const HostNode = memo(function HostNode({ data, selected }: NodeProps<AppNode>) {
  const node = data.node;
  if (!node) return null;

  const host = node.host;
  const open = host ? openPorts(host) : [];
  const risk = data.risk ?? null;
  const shown = open.slice(0, open.length > MAX_BADGES ? MAX_BADGES - 1 : MAX_BADGES);
  const overflow = open.length - shown.length;
  const subtitle = nodeSubtitle(node);
  const vm = host ? virtualPlatformOf(host) : undefined;
  const osHint = host?.os[0] ? ` · ${host.os[0].name.split(' ').slice(0, 2).join(' ')}` : '';
  const meta = !host
    ? (node.notes?.split('\n')[0] ?? 'custom node')
    : host.status === 'down'
      ? 'host down'
      : discoveryOnly(host)
        ? 'discovered · no port scan'
        : `${open.length === 0 ? 'no open ports' : `${open.length} open`}${osHint}`;

  return (
    <article
      className={[
        'host-node',
        selected ? 'is-selected' : '',
        data.dimmed ? 'is-dimmed' : '',
        risk ? 'is-risky' : '',
        node.stale ? 'is-stale' : '',
        host?.status === 'down' ? 'is-down' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          ...(node.accent ? { '--node-accent': node.accent } : {}),
          ...(risk
            ? {
                '--risk-color': risk.color,
                '--risk-soft': hexToRgba(risk.color, 0.18),
              }
            : {}),
        } as React.CSSProperties
      }
      data-accent={node.accent || undefined}
    >
      <NodeHandles />
      <div className="host-node__head">
        <NodeIcon id={node.icon} size={20} />
        <div className="host-node__titles">
          <span className="mono host-node__title">{nodeTitle(node)}</span>
          {subtitle && <span className="host-node__sub">{subtitle}</span>}
        </div>
        <div className="host-node__flags">
          {host?.status === 'down' && <span className="tag tag--down">down</span>}
          {vm && (
            <span className="tag tag--vm" title={`Virtual machine on ${vm}`}>
              VM
            </span>
          )}
          {risk && (
            <span
              className="tag tag--risk"
              title={`${risk.label} · ${risk.tooltip}`}
              style={{ borderColor: hexToRgba(risk.color, 0.55), color: risk.color }}
            >
              {risk.label.toLowerCase()}
              <b>{risk.ports.length}</b>
            </span>
          )}
          {node.stale && <span className="tag tag--stale">stale</span>}
        </div>
      </div>
      <div className="host-node__meta">{meta}</div>
      {host && open.length > 0 && (
        <div className="host-node__badges">
          {shown.map((port) => {
            const badge = risk?.badges[String(port.port)];
            return (
              <span
                key={port.port}
                className={`badge${badge ? ' badge--risk' : ''}`}
                style={
                  badge
                    ? { borderColor: hexToRgba(badge.color, 0.45), color: badge.color, background: hexToRgba(badge.color, 0.12) }
                    : undefined
                }
                title={badge ? `${badge.label} port` : undefined}
              >
                {port.port}
                {port.service ? <em>{port.service.split('/').pop()}</em> : null}
              </span>
            );
          })}
          {overflow > 0 && <span className="badge badge--more">+{overflow}</span>}
        </div>
      )}

    </article>
  );
});

export const SectionNode = memo(function SectionNode({ data, selected }: NodeProps<AppNode>) {
  const node = data.node;
  if (!node) return null;
  const collapsed = Boolean(node.collapsed);

  return (
    <div
      className={[
        'section-node',
        selected ? 'is-selected' : '',
        collapsed ? 'is-collapsed' : '',
        data.dimmed ? 'is-dimmed' : '',
        data.dropTarget ? 'is-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={node.accent ? ({ '--node-accent': node.accent } as React.CSSProperties) : undefined}
      data-accent={node.accent || undefined}
    >
      <NodeHandles />
      {selected && !collapsed && (
        <NodeResizer
          minWidth={data.minW}
          minHeight={data.minH}
          lineClassName="section-resizer__line"
          handleClassName="section-resizer__handle"
          onResizeEnd={(_event, params) =>
            data.onResize?.(node.id, { w: Math.round(params.width), h: Math.round(params.height) })
          }
        />
      )}
      <div className="section-node__head">
        <NodeIcon id={node.icon ?? 'server'} size={16} />
        <span className="mono section-node__title">{nodeTitle(node)}</span>
        <span className="section-node__count">
          {data.childCount ?? 0} nodes
          {node.manualSize ? <em className="section-node__manual" title="Hand-resized: moving a card restores auto-size">manual</em> : null}
        </span>
        {!collapsed && (data.childCount ?? 0) > 0 && (
          <button
            type="button"
            className="nodrag section-node__toggle"
            title="Auto-organize the cards in this section into an even grid"
            aria-label="Arrange section in a grid"
            onClick={(event) => {
              event.stopPropagation();
              data.onTidy?.(node.id);
            }}
          >
            arrange
          </button>
        )}
        <button
          type="button"
          className="nodrag section-node__toggle"
          title={collapsed ? 'Expand section' : 'Collapse section'}
          aria-label={collapsed ? 'Expand section' : 'Collapse section'}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggle?.(node.id);
          }}
        >
          {collapsed ? 'expand' : 'minimize'}
        </button>
      </div>

    </div>
  );
});

export const HopNode = memo(function HopNode({ data, selected }: NodeProps<AppNode>) {
  const node = data.node;
  if (!node) return null;
  return (
    <div
      className={`hop-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      style={node.accent ? ({ '--node-accent': node.accent } as React.CSSProperties) : undefined}
      data-accent={node.accent || undefined}
    >
      <NodeHandles />
      <NodeIcon id={node.icon ?? 'router'} size={15} />
      <div className="hop-node__text">
        <span className="hop-node__depth">hop {node.depth ?? 1}</span>
        <span className="mono hop-node__ip">{nodeTitle(node)}</span>
        {node.subtitle && <span className="hop-node__name">{node.subtitle}</span>}
      </div>

    </div>
  );
});

export const OriginNode = memo(function OriginNode({ data, selected }: NodeProps<AppNode>) {
  const node = data.node;
  if (!node) return null;
  return (
    <div
      className={`origin-node${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      style={node.accent ? ({ '--node-accent': node.accent } as React.CSSProperties) : undefined}
      data-accent={node.accent || undefined}
    >
      <div className="origin-node__head">
        <NodeIcon id={node.icon ?? 'cloud'} size={16} />
        <span className="origin-node__eyebrow">{nodeTitle(node)}</span>
      </div>
      <span className="mono origin-node__args">{node.address ?? node.notes ?? 'imported scan'}</span>
      <span className="origin-node__meta">{node.subtitle ?? ''}</span>
      <NodeHandles />
    </div>
  );
});

export const NoteNode = memo(function NoteNode({ data, selected }: NodeProps<AppNode>) {
  const node = data.node;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const editing = Boolean(data.editing);

  const attachArea = useCallback((element: HTMLTextAreaElement | null) => {
    areaRef.current = element;
    if (element && document.activeElement !== element) {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, []);

  if (!node) return null;
  return (
    <div
      className={[
        'note-node',
        selected ? 'is-selected' : '',
        editing ? 'is-editing' : '',
        data.dimmed ? 'is-dimmed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={node.accent ? ({ '--node-accent': node.accent } as React.CSSProperties) : undefined}
    >
      <NodeHandles />
      <div className="note-node__head">
        <NodeIcon id={node.icon ?? 'iot'} size={14} />
        <span className="note-node__title">{nodeTitle(node)}</span>
        {selected && (
          <button
            type="button"
            className="note-node__delete nodrag"
            title="Delete note"
            aria-label="Delete note"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.(node.id);
            }}
          >
            ×
          </button>
        )}
      </div>
      {editing ? (
        <textarea
          ref={attachArea}
          className="note-node__input nodrag nowheel"
          value={node.notes ?? ''}
          placeholder="Type your note…"
          onFocus={() => data.onNoteFocus?.()}
          onChange={(event) => data.onNoteChange?.(node.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.blur();
              data.onStopEdit?.();
            }
            event.stopPropagation();
          }}
        />
      ) : (
        <p className="note-node__body">{node.notes?.trim() ? node.notes : 'Double-click to edit'}</p>
      )}

    </div>
  );
});
