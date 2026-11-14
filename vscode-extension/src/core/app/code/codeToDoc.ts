import { detectIcon } from '../icons/registry';
import { absolutePosition, measureSection, nodeSize } from '../doc/measure';
import { emptyHost } from '../doc/operations';
import { RISK_COLORS, type RiskLevel, type RiskPolicy } from '../doc/risk';
import type { DiagramDoc, DiagramEdge, DiagramNode, Layer } from '../doc/types';
import type { NmapHost, NmapPort } from '../model/types';
import { parseCode, type CodeAttrs, type CodeItem, type CodeModel, type CodeRiskLevel } from './dsl';
import { layoutBounds, layoutCode, type PlacedItem } from './layout';

/**
 * Turning a code block into one layer of the document. The rest of the diagram is
 * left alone: this replaces the nodes and edges that belong to `layerId`, and the
 * new layout is centred on the box the old content occupied so the layer stays
 * where the author left it.
 */

export type ApplyCodeOk = { ok: true; doc: DiagramDoc; added: number; removed: number };
export type ApplyCodeFailure = { ok: false; error: string; line: number };
export type ApplyCodeResult = ApplyCodeOk | ApplyCodeFailure;

export type ApplyCodeOptions = {
  /** Overrides the layer's current content centre (tests and the panel's “place here”). */
  center?: { x: number; y: number };
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const PORT_STATES = new Set(['open', 'closed', 'filtered', 'unfiltered', 'open|filtered']);

/** `22`, `22/ssh`, `22/open`, `443/https/open` – the states nmap writes. */
export function parsePorts(value: string | undefined): NmapPort[] {
  if (!value) return [];
  const out: NmapPort[] = [];
  const seen = new Set<number>();
  for (const token of value.split(/[,;\s]+/)) {
    const piece = token.trim();
    if (!piece) continue;
    const [rawPort, ...rest] = piece.split(/[/:]/);
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535 || seen.has(port)) continue;
    let service: string | undefined;
    let state = 'open';
    for (const part of rest) {
      const lower = part.toLowerCase();
      if (PORT_STATES.has(lower)) state = lower;
      else if (part) service = part;
    }
    seen.add(port);
    out.push({ port, protocol: 'tcp', state, ...(service ? { service } : {}), scripts: [] });
  }
  return out;
}

function hostFromAttrs(id: string, attrs: CodeAttrs): NmapHost {
  const ip = attrs.host ?? attrs.ip ?? '';
  const host: NmapHost = {
    ...emptyHost(id),
    ip,
    hostnames: splitList(attrs.hostname ?? attrs.hostnames),
  };
  if (attrs.mac) host.mac = attrs.mac.trim();
  if (attrs.vendor) host.vendor = attrs.vendor.trim();
  if (attrs.os) host.os = splitList(attrs.os).map((name) => ({ name, accuracy: 100 }));
  if (attrs.ports !== undefined) {
    host.ports = parsePorts(attrs.ports);
    host.portsScanned = true;
  }
  return host;
}

function accentOf(attrs: CodeAttrs): string | undefined {
  return attrs.accent && HEX.test(attrs.accent) ? attrs.accent : undefined;
}

function sizeOf(placed: PlacedItem, item: CodeItem): { w: number; h: number } | undefined {
  if (item.kind === 'section' || item.kind === 'note') return { w: Math.round(placed.w), h: Math.round(placed.h) };
  return undefined;
}

function buildNode(
  item: CodeItem,
  placed: PlacedItem,
  id: string,
  layerId: string,
  position: { x: number; y: number },
  parentId: string | null,
): DiagramNode {
  const { attrs } = item;
  const common: DiagramNode = {
    id,
    kind: item.kind,
    layerId,
    position: { x: Math.round(position.x), y: Math.round(position.y) },
  };
  if (parentId) common.parentId = parentId;
  if (item.label !== undefined) common.label = item.label;
  if (attrs.subtitle) common.subtitle = attrs.subtitle;
  if (attrs.icon) common.icon = attrs.icon;
  const accent = accentOf(attrs);
  if (accent) common.accent = accent;
  if (attrs.notes) common.notes = attrs.notes;
  if (attrs.z) {
    const z = Number(attrs.z);
    if (Number.isFinite(z)) common.z = z;
  }

  if (item.kind === 'section') {
    const size = sizeOf(placed, item);
    return {
      ...common,
      icon: common.icon ?? 'server',
      cidr: attrs.cidr ?? item.label ?? item.ref,
      ...(size ? { size } : {}),
      ...(attrs.collapsed ? { collapsed: attrs.collapsed.toLowerCase() === 'true' } : {}),
      ...(attrs['manual-size'] ? { manualSize: attrs['manual-size'].toLowerCase() === 'true' } : {}),
    };
  }
  if (item.kind === 'note') {
    const size = sizeOf(placed, item);
    return {
      ...common,
      icon: common.icon ?? 'iot',
      accent: common.accent ?? '#facc15',
      notes: common.notes ?? '',
      ...(size ? { size } : {}),
    };
  }
  if (item.kind === 'hop') {
    const depth = Number(attrs.depth);
    return {
      ...common,
      icon: common.icon ?? 'router',
      address: attrs.address ?? '',
      depth: Number.isFinite(depth) && depth > 0 ? depth : 1,
    };
  }
  if (item.kind === 'origin') {
    return {
      ...common,
      icon: common.icon ?? 'cloud',
      address: attrs.address ?? '',
    };
  }
  const host = hostFromAttrs(`${id}:scan`, attrs);
  return {
    ...common,
    icon: common.icon ?? detectIcon(host),
    host,
    ...(attrs.stale ? { stale: attrs.stale.toLowerCase() === 'true' } : {}),
  };
}

function layerCenter(doc: DiagramDoc, layerId: string): { x: number; y: number } | null {
  const nodes = doc.nodes.filter((node) => node.layerId === layerId);
  if (nodes.length === 0) return null;
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const children = new Map<string, DiagramNode[]>();
  for (const node of doc.nodes) {
    if (!node.parentId) continue;
    const bucket = children.get(node.parentId);
    if (bucket) bucket.push(node);
    else children.set(node.parentId, [node]);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const absolute = absolutePosition(node, byId);
    // A section's drawn box is its measured frame, not its stored `size`.
    const size =
      node.kind === 'section' ? measureSection(node, children.get(node.id) ?? []) : nodeSize(node);
    minX = Math.min(minX, absolute.x);
    minY = Math.min(minY, absolute.y);
    maxX = Math.max(maxX, absolute.x + size.w);
    maxY = Math.max(maxY, absolute.y + size.h);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** Where a brand-new layer's content lands when there is nothing to centre on. */
const NEW_LAYER_CENTER = { x: 400, y: 300 };

function slugOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/**
 * `risk:` is document-wide, so a code block that names levels replaces the
 * diagram's own levels while keeping the colours of the ones it recognises.
 */
export function riskPolicyFromLevels(levels: CodeRiskLevel[], existing: RiskPolicy | null | undefined): RiskPolicy {
  const known = new Map((existing?.levels ?? []).map((level) => [level.label.toLowerCase(), level]));
  const used = new Set<string>();
  const built: RiskLevel[] = levels.map((level, index) => {
    const match = known.get(level.label.toLowerCase());
    const base = slugOf(level.label) || `level-${index + 1}`;
    let id = match?.id ?? base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return {
      id,
      label: level.label,
      color: level.color ?? match?.color ?? RISK_COLORS[index % RISK_COLORS.length],
      ports: level.ports,
      enabled: level.enabled ?? true,
    };
  });
  return { version: 1, levels: built };
}

function uniqueFactory(used: Set<string>): (base: string) => string {
  let counter = 0;
  return (base: string) => {
    let candidate = base;
    while (used.has(candidate)) {
      counter += 1;
      candidate = `${base}~${counter}`;
    }
    used.add(candidate);
    return candidate;
  };
}

function refId(ref: string): string {
  const clean = ref.replace(/[^0-9a-zA-Z_.:-]+/g, '_');
  return `code:${clean}`;
}

/**
 * Replace one layer with what the code describes. Returns a failure (and leaves the
 * document alone) when the code does not parse or an edge names an unknown node.
 */
export function applyLayerCode(
  doc: DiagramDoc,
  layerId: string,
  code: string,
  options: ApplyCodeOptions = {},
): ApplyCodeResult {
  const parsed = parseCode(code);
  if (!parsed.ok) return parsed;
  if (!doc.layers.some((layer) => layer.id === layerId)) {
    return { ok: false, error: 'That layer no longer exists – pick another layer and try again.', line: 1 };
  }

  const model: CodeModel = parsed.model;
  const layout = layoutCode(model);
  if (layout.items.length === 0) {
    return { ok: false, error: 'The code describes no nodes, so there is nothing to draw.', line: 1 };
  }

  const previous = options.center ?? layerCenter(doc, layerId) ?? NEW_LAYER_CENTER;
  const bounds = layoutBounds(layout);
  const offset = {
    x: previous.x - (bounds.x + bounds.w / 2),
    y: previous.y - (bounds.y + bounds.h / 2),
  };

  const doomed = new Set(doc.nodes.filter((node) => node.layerId === layerId).map((node) => node.id));
  const keptNodes = doc.nodes.filter((node) => !doomed.has(node.id));
  const keptEdges = doc.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target));

  const usedNodeIds = new Set(keptNodes.map((node) => node.id));
  const nextNodeId = uniqueFactory(usedNodeIds);
  const idByRef = new Map<string, string>();
  for (const item of model.items) idByRef.set(item.ref, nextNodeId(refId(item.ref)));

  const placedByRef = new Map(layout.items.map((item) => [item.ref, item]));
  const created: DiagramNode[] = [];
  for (const item of model.items) {
    const placed = placedByRef.get(item.ref);
    if (!placed) continue;
    const id = idByRef.get(item.ref)!;
    const parentId = item.parent ? (idByRef.get(item.parent) ?? null) : null;
    const position = parentId
      ? { x: placed.x, y: placed.y }
      : { x: placed.x + offset.x, y: placed.y + offset.y };
    created.push(buildNode(item, placed, id, layerId, position, parentId));
  }

  const usedEdgeIds = new Set(keptEdges.map((edge) => edge.id));
  const nextEdgeId = uniqueFactory(usedEdgeIds);
  const createdEdges: DiagramEdge[] = [];
  for (const edge of model.edges) {
    const source = idByRef.get(edge.from);
    const target = idByRef.get(edge.to);
    if (!source || !target) continue;
    createdEdges.push({
      id: nextEdgeId(`code-edge:${edge.kind}`),
      source,
      target,
      kind: edge.kind,
      ...(edge.label ? { label: edge.label } : {}),
      line: edge.line,
      ...(edge.path ? { path: edge.path } : {}),
      ...(edge.fromSide ? { from: edge.fromSide } : {}),
      ...(edge.toSide ? { to: edge.toSide } : {}),
      arrow: edge.arrow,
    });
  }

  let layers: Layer[] = doc.layers;
  if (model.layerName || model.layerColor) {
    layers = layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            ...(model.layerName ? { name: model.layerName } : {}),
            ...(model.layerColor && HEX.test(model.layerColor) ? { color: model.layerColor } : {}),
          }
        : layer,
    );
  }

  const next: DiagramDoc = {
    ...doc,
    layers,
    nodes: [...keptNodes, ...created],
    edges: [...keptEdges, ...createdEdges],
    ...(model.risk !== undefined ? { risk: model.risk === null ? null : riskPolicyFromLevels(model.risk, doc.risk) } : {}),
  };

  return { ok: true, doc: next, added: created.length, removed: doomed.size };
}
