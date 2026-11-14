import {
  edgeArrow,
  edgeLine,
  edgePath,
  edgeSides,
  nodeTitle,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
} from '../doc/types';
import { escapeDslString } from '../export/text';
import type { NmapHost } from '../model/types';
import type { RiskPolicy } from '../doc/risk';
import { expandCode, type CodeLayout } from './reflow';

/**
 * The canvas → code direction. One layer at a time, in the same shape `dsl.ts`
 * reads back, so editing the canvas and editing the code agree on what the
 * diagram is.
 *
 * Only the supported fields are written: whatever a round-trip drops is a deliberate
 * gap (node risk resolution is computed, not stored) rather than an accident.
 */

const INDENT = '  ';

const quote = (value: string) => `"${escapeDslString(value)}"`;

/** A single token that cannot be written bare (a level name, mostly). */
function plainOrQuoted(value: string): string {
  return /^[^\s;=#"]+$/.test(value) ? value : quote(value);
}

function attrsOf(entries: [string, string | undefined][]): string[] {
  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}: ${quote(value)}`);
}

function portText(host: NmapHost): string | undefined {
  if (host.ports.length === 0) return undefined;
  return host.ports
    .map((port) => {
      const bits = [String(port.port)];
      if (port.service) bits.push(port.service);
      if (port.state !== 'open') bits.push(port.state);
      return bits.join('/');
    })
    .join(', ');
}

/** A reference the parser accepts: starts with a letter, then word/dot/colon/dash. */
function refFromId(id: string, used: Set<string>): string {
  let base = id.replace(/^[A-Za-z]+:/, '');
  base = base.replace(/[^0-9A-Za-z_.:-]+/g, '_').replace(/^[-.]+/, '');
  if (!/^[A-Za-z_]/.test(base)) base = `n_${base}`;
  let candidate = base;
  let counter = 1;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${base}_${counter}`;
  }
  used.add(candidate);
  return candidate;
}

function nodeAttrs(node: DiagramNode): string[] {
  const lines = attrsOf([['icon', node.icon], ['accent', node.accent], ['subtitle', node.subtitle]]);
  if (node.z !== undefined) lines.push(`z: ${node.z}`);
  return lines;
}

type WriteContext = {
  refs: Map<string, string>;
  used: Set<string>;
};

function writeNode(node: DiagramNode, depth: number, context: WriteContext): string {
  const ref = context.refs.get(node.id)!;
  const pad = INDENT.repeat(depth);
  const bits: string[] = [];
  const body = nodeTitle(node);

  if (node.kind === 'section') {
    bits.push(`subgraph ${ref}[${quote(body)}]`);
    bits.push(...attrsOf([['cidr', node.cidr], ['icon', node.icon], ['accent', node.accent]]));
    if (node.size) bits.push(`size: ${quote(`${node.size.w}x${node.size.h}`)}`);
    if (node.manualSize) bits.push('manual-size: true');
    if (node.collapsed) bits.push('collapsed: true');
    return `${pad}${bits.join(' ')}`;
  }

  bits.push(`${ref}[${quote(body)}]`);
  bits.push(`kind: ${node.kind}`);

  if (node.kind === 'note') {
    bits.push(...attrsOf([['notes', node.notes], ['accent', node.accent], ['icon', node.icon]]));
    if (node.size) bits.push(`size: ${quote(`${node.size.w}x${node.size.h}`)}`);
    return `${pad}${bits.join(' ')}`;
  }

  if (node.kind === 'hop') {
    bits.push(...attrsOf([['address', node.address], ['subtitle', node.subtitle], ['icon', node.icon]]));
    if (node.depth !== undefined) bits.push(`depth: ${node.depth}`);
    return `${pad}${bits.join(' ')}`;
  }

  if (node.kind === 'origin') {
    bits.push(...attrsOf([['address', node.address], ['subtitle', node.subtitle], ['icon', node.icon]]));
    return `${pad}${bits.join(' ')}`;
  }

  const host = node.host;
  bits.push(...nodeAttrs(node));
  if (host) {
    bits.push(
      ...attrsOf([
        ['host', host.ip],
        ['hostname', host.hostnames.filter((name) => name.trim()).join(', ')],
        ['mac', host.mac],
        ['vendor', host.vendor],
        ['os', host.os.map((entry) => entry.name).join(', ')],
        ['ports', portText(host)],
      ]),
    );
  }
  if (node.stale) bits.push('stale: true');
  return `${pad}${bits.join(' ')}`;
}

function arrowOperator(edge: DiagramEdge): string {
  switch (edgeArrow(edge)) {
    case 'none':
      return '---';
    case 'source':
      return '<--';
    case 'both':
      return '<-->';
    default:
      return '-->';
  }
}

function writeEdge(edge: DiagramEdge, context: WriteContext): string {
  const from = context.refs.get(edge.source);
  const to = context.refs.get(edge.target);
  if (!from || !to) return '';
  const sides = edgeSides(edge);
  const bits = [`${from} ${arrowOperator(edge)}${edge.label ? `|${edge.label.replace(/\|/g, '/')}|` : ''} ${to}`];
  bits.push(`style: ${edgeLine(edge)}`);
  bits.push(`path: ${edgePath(edge)}`);
  bits.push(`from: ${sides.from}`, `to: ${sides.to}`, `arrow: ${edgeArrow(edge)}`, `kind: ${edge.kind}`);
  return `${INDENT}${bits.join(' ')}`;
}

function riskLine(policy: RiskPolicy): string {
  if (policy.levels.length === 0) {
    // `none` is "flag nothing", not "inherit" – the difference matters once an
    // account or server policy exists.
    return 'risk: none';
  }
  const parts = policy.levels.map(
    (level) =>
      `${plainOrQuoted(level.label)} = ${level.ports.replace(/;/g, ',')} ${level.color}${level.enabled ? '' : ' off'}`,
  );
  return `risk: ${parts.join(' ; ')}`;
}

/**
 * Serialise one layer. `layerId` is the layer the panel is pointed at; cards on
 * other layers are left out, and an edge that crosses a layer boundary becomes a
 * comment so its absence is explained rather than silent.
 *
 * The text is always built one statement per line and the `expanded` layout is a
 * reflow of that, so the two styles can never drift apart.
 */
export function docToCode(doc: DiagramDoc, layerId: string, layout: CodeLayout = 'compact'): string {
  const layer = doc.layers.find((item) => item.id === layerId);
  const nodes = doc.nodes.filter((node) => node.layerId === layerId);

  const context: WriteContext = { refs: new Map(), used: new Set() };
  for (const node of nodes) {
    context.refs.set(node.id, refFromId(node.id, context.used));
  }

  const lines: string[] = [
    `%% nmap2flowchart code · ${layer?.name ?? 'this layer'}`,
    'flowchart LR',
    `layer: ${quote(layer?.name ?? 'Layer')}${layer?.color ? ` color: ${layer.color}` : ''}`,
  ];
  if (doc.risk) lines.push(riskLine(doc.risk));

  const children = new Map<string | null, DiagramNode[]>();
  for (const node of nodes) {
    const key = node.parentId ?? null;
    const bucket = children.get(key);
    if (bucket) bucket.push(node);
    else children.set(key, [node]);
  }

  const writeGroup = (parentId: string | null, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (node.kind === 'section') {
        lines.push(writeNode(node, depth, context));
        writeGroup(node.id, depth + 1);
        lines.push(`${INDENT.repeat(depth)}end`);
      } else {
        lines.push(writeNode(node, depth, context));
      }
    }
  };
  writeGroup(null, 1);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const inside: DiagramEdge[] = [];
  let crossing = 0;
  for (const edge of doc.edges) {
    const hasSource = nodeIds.has(edge.source);
    const hasTarget = nodeIds.has(edge.target);
    if (hasSource && hasTarget) inside.push(edge);
    else if (hasSource || hasTarget) crossing += 1;
  }

  if (inside.length > 0) {
    lines.push('');
    for (const edge of inside) lines.push(writeEdge(edge, context));
  }
  if (crossing > 0) {
    lines.push(
      '',
      `%% ${crossing} connection${crossing === 1 ? '' : 's'} to another layer ${crossing === 1 ? 'is' : 'are'} not shown here`,
    );
  }

  const compact = `${lines.join('\n')}\n`;
  return layout === 'expanded' ? expandCode(compact) : compact;
}