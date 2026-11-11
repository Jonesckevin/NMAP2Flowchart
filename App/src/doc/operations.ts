import {
  descendantLayerIds,
  LAYER_COLORS,
  MAIN_LAYER,
  NOTES_LAYER,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type EdgeSide,
  type Layer,
} from './types';
import type { NmapHost } from '../model/types';
import { absolutePosition, nodeSize, SECTION_HEADER, SECTION_PAD, slotInSection } from './measure';

let counter = 0;
const uniqueId = (prefix: string) => {
  counter += 1;
  return `${prefix}:${Date.now().toString(36)}${counter.toString(36)}`;
};

export function patchNode(doc: DiagramDoc, id: string, patch: Partial<DiagramNode>): DiagramDoc {
  return { ...doc, nodes: doc.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) };
}

export function patchNodes(doc: DiagramDoc, ids: string[], patch: Partial<DiagramNode>): DiagramDoc {
  const target = new Set(ids);
  return { ...doc, nodes: doc.nodes.map((node) => (target.has(node.id) ? { ...node, ...patch } : node)) };
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type DistributeMode = 'horizontal' | 'vertical';

function relativePosition(doc: DiagramDoc, node: DiagramNode, absolute: { x: number; y: number }): DiagramNode {
  if (!node.parentId) return { ...node, position: absolute };
  const byId = new Map(doc.nodes.map((item) => [item.id, item]));
  const parent = byId.get(node.parentId);
  if (!parent) return { ...node, position: absolute };
  const parentAbsolute = absolutePosition(parent, byId);
  return { ...node, position: { x: absolute.x - parentAbsolute.x, y: absolute.y - parentAbsolute.y } };
}

export function alignNodes(doc: DiagramDoc, ids: string[], mode: AlignMode): DiagramDoc {
  if (ids.length < 2) return doc;
  const target = new Set(ids);
  const selected = doc.nodes.filter((node) => target.has(node.id));
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const positions = selected.map((node) => ({ node, absolute: absolutePosition(node, byId) }));
  let value: number;

  if (mode === 'left') value = Math.min(...positions.map(({ absolute }) => absolute.x));
  else if (mode === 'center') value = Math.min(...positions.map(({ absolute }) => absolute.x)) + (
    Math.max(...positions.map(({ node, absolute }) => absolute.x + nodeSize(node).w)) -
    Math.min(...positions.map(({ absolute }) => absolute.x))
  ) / 2;
  else if (mode === 'right') value = Math.max(...positions.map(({ node, absolute }) => absolute.x + nodeSize(node).w));
  else if (mode === 'top') value = Math.min(...positions.map(({ absolute }) => absolute.y));
  else if (mode === 'middle') value = Math.min(...positions.map(({ absolute }) => absolute.y)) + (
    Math.max(...positions.map(({ node, absolute }) => absolute.y + nodeSize(node).h)) -
    Math.min(...positions.map(({ absolute }) => absolute.y))
  ) / 2;
  else value = Math.max(...positions.map(({ node, absolute }) => absolute.y + nodeSize(node).h));

  const replacements = new Map<string, DiagramNode>();
  for (const { node, absolute } of positions) {
    const size = nodeSize(node);
    let next = absolute;
    if (mode === 'left' || mode === 'top') next = { x: mode === 'left' ? value : absolute.x, y: mode === 'top' ? value : absolute.y };
    else if (mode === 'center') next = { x: value - size.w / 2, y: absolute.y };
    else if (mode === 'right') next = { x: value - size.w, y: absolute.y };
    else if (mode === 'middle') next = { x: absolute.x, y: value - size.h / 2 };
    else if (mode === 'bottom') next = { x: absolute.x, y: value - size.h };
    replacements.set(node.id, relativePosition(doc, node, next));
  }
  return { ...doc, nodes: doc.nodes.map((node) => replacements.get(node.id) ?? node) };
}

export function distributeNodes(doc: DiagramDoc, ids: string[], mode: DistributeMode): DiagramDoc {
  if (ids.length < 3) return doc;
  const target = new Set(ids);
  const selected = doc.nodes.filter((node) => target.has(node.id));
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const horizontal = mode === 'horizontal';
  const positioned = selected
    .map((node) => ({ node, absolute: absolutePosition(node, byId) }))
    .sort((a, b) => (horizontal ? a.absolute.x - b.absolute.x : a.absolute.y - b.absolute.y));
  const first = positioned[0];
  const last = positioned[positioned.length - 1];
  const firstEnd = horizontal
    ? first.absolute.x + nodeSize(first.node).w
    : first.absolute.y + nodeSize(first.node).h;
  const lastStart = horizontal ? last.absolute.x : last.absolute.y;
  const used = positioned.slice(1, -1).reduce(
    (sum, item) => sum + (horizontal ? nodeSize(item.node).w : nodeSize(item.node).h),
    0,
  );
  const gap = (lastStart - firstEnd - used) / (positioned.length - 1);
  if (!Number.isFinite(gap)) return doc;

  const replacements = new Map<string, DiagramNode>();
  let cursor = firstEnd + gap;
  for (const item of positioned.slice(1, -1)) {
    const absolute = horizontal ? { x: cursor, y: item.absolute.y } : { x: item.absolute.x, y: cursor };
    replacements.set(item.node.id, relativePosition(doc, item.node, absolute));
    cursor += horizontal ? nodeSize(item.node).w + gap : nodeSize(item.node).h + gap;
  }
  return { ...doc, nodes: doc.nodes.map((node) => replacements.get(node.id) ?? node) };
}

export function removeNodes(doc: DiagramDoc, ids: string[]): DiagramDoc {
  const doomed = new Set(ids);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const nodes: DiagramNode[] = [];

  for (const node of doc.nodes) {
    if (doomed.has(node.id)) continue;
    if (node.parentId && doomed.has(node.parentId)) {
      const parent = byId.get(node.parentId);
      nodes.push({
        ...node,
        parentId: null,
        position: {
          x: node.position.x + (parent?.position.x ?? 0),
          y: node.position.y + (parent?.position.y ?? 0),
        },
      });
      continue;
    }
    nodes.push(node);
  }

  const edges = doc.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target));
  return { ...doc, nodes, edges };
}

export function duplicateNode(doc: DiagramDoc, id: string): { doc: DiagramDoc; newId: string } | null {
  const source = doc.nodes.find((node) => node.id === id);
  if (!source) return null;
  const newId = uniqueId(source.kind);
  const baseLabel = source.label ?? source.host?.ip ?? source.cidr ?? source.kind;
  const copy: DiagramNode = {
    ...source,
    id: newId,
    position: { x: source.position.x + 28, y: source.position.y + 28 },
    label: `${baseLabel} copy`,
    host: undefined,
    cidr: undefined,
    stale: false,
  };
  const index = doc.nodes.findIndex((node) => node.id === id);
  const nodes = [...doc.nodes];
  nodes.splice(index + 1, 0, copy);
  return { doc: { ...doc, nodes }, newId };
}

export function addLink(
  doc: DiagramDoc,
  source: string,
  target: string,
  sides?: { from?: EdgeSide; to?: EdgeSide },
): DiagramDoc {
  if (source === target) return doc;
  const exists = doc.edges.some(
    (edge) =>
      (edge.source === source && edge.target === target) || (edge.source === target && edge.target === source),
  );
  if (exists) return doc;
  const edge: DiagramEdge = {
    id: uniqueId('link'),
    source,
    target,
    kind: 'link',
    ...(sides?.from ? { from: sides.from } : {}),
    ...(sides?.to ? { to: sides.to } : {}),
  };
  return { ...doc, edges: [...doc.edges, edge] };
}

export function setNodeSection(
  doc: DiagramDoc,
  nodeId: string,
  sectionId: string | null,
  placement: 'keep' | 'append' = 'keep',
): DiagramDoc {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const node = byId.get(nodeId);
  if (!node || node.kind === 'section') return doc;
  if ((node.parentId ?? null) === sectionId) return doc;

  const target = sectionId ? byId.get(sectionId) : null;
  if (sectionId && target?.kind !== 'section') return doc;

  const absolute = absolutePosition(node, byId);
  const siblings = target ? doc.nodes.filter((item) => item.parentId === target.id && item.id !== nodeId) : [];

  let position = absolute;
  if (target) {
    position =
      placement === 'append'
        ? slotInSection(target, siblings, nodeSize(node))
        : {
            x: Math.max(SECTION_PAD, absolute.x - target.position.x),
            y: Math.max(SECTION_HEADER + 8, absolute.y - target.position.y),
          };
  }

  return {
    ...doc,
    nodes: doc.nodes.map((item) => {
      if (item.id === nodeId) {
        return { ...item, parentId: target?.id ?? null, position, layerId: target?.layerId ?? item.layerId };
      }
      if (target && item.id === target.id) {
        return item.collapsed || item.manualSize ? { ...item, collapsed: false, manualSize: false } : item;
      }
      return item;
    }),
  };
}

export function patchEdge(doc: DiagramDoc, id: string, patch: Partial<DiagramEdge>): DiagramDoc {
  return { ...doc, edges: doc.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)) };
}

export function removeEdges(doc: DiagramDoc, ids: string[]): DiagramDoc {
  const doomed = new Set(ids);
  return { ...doc, edges: doc.edges.filter((edge) => !doomed.has(edge.id)) };
}

export type NewNodeKind = 'host' | 'section' | 'note' | 'hop';

export function emptyHost(id: string): NmapHost {
  return { id, ip: '', hostnames: [], status: 'up', os: [], ports: [], scripts: [], hops: [] };
}

export function createNode(
  doc: DiagramDoc,
  kind: NewNodeKind,
  position: { x: number; y: number },
  layerId: string,
  sectionId?: string | null,
): { doc: DiagramDoc; id: string } {
  const id = uniqueId(kind);
  const base: DiagramNode = { id, kind, layerId, position };

  let node: DiagramNode;
  if (kind === 'section') {
    node = {
      ...base,
      position,
      cidr: 'new-section',
      label: 'New section',
      icon: 'server',
      size: { w: 360, h: 240 },
    };
  } else if (kind === 'note') {
    node = {
      ...base,
      layerId: layerId === MAIN_LAYER ? NOTES_LAYER : layerId,
      label: 'Note',
      icon: 'iot',
      notes: '',
      accent: '#facc15',
      size: { w: 224, h: 150 },
    };
  } else if (kind === 'hop') {
    node = { ...base, icon: 'router', address: '', depth: 1 };
  } else {
    node = { ...base, icon: 'server', host: emptyHost(`${id}:scan`) };
  }

  if (sectionId && kind === 'host') {
    const section = doc.nodes.find((item) => item.id === sectionId);
    if (section) {
      const siblings = doc.nodes.filter((item) => item.parentId === sectionId);
      node = { ...node, parentId: sectionId, position: slotInSection(section, siblings, nodeSize(node)) };
    }
  }

  const nodes = [...doc.nodes, node];
  return { doc: { ...doc, nodes }, id };
}

export function addLayer(doc: DiagramDoc, parentId: string | null): { doc: DiagramDoc; id: string } {
  const id = uniqueId('layer');
  const siblings = doc.layers.filter((layer) => layer.parentId === parentId);
  const layer: Layer = {
    id,
    name: `Layer ${siblings.length + 1}`,
    parentId,
    visible: true,
    color: LAYER_COLORS[(doc.layers.length + 1) % LAYER_COLORS.length],
  };
  const anchor = siblings[0]
    ? doc.layers.findIndex((item) => item.id === siblings[0].id)
    : doc.layers.length;
  const layers = [...doc.layers.slice(0, anchor), layer, ...doc.layers.slice(anchor)];
  return { doc: { ...doc, layers }, id };
}

export function renameLayer(doc: DiagramDoc, id: string, name: string): DiagramDoc {
  return { ...doc, layers: doc.layers.map((layer) => (layer.id === id ? { ...layer, name } : layer)) };
}

export function recolorLayer(doc: DiagramDoc, id: string, color: string): DiagramDoc {
  return { ...doc, layers: doc.layers.map((layer) => (layer.id === id ? { ...layer, color } : layer)) };
}

export function toggleLayerVisible(doc: DiagramDoc, id: string): DiagramDoc {
  return {
    ...doc,
    layers: doc.layers.map((layer) => (layer.id === id ? { ...layer, visible: !layer.visible } : layer)),
  };
}

export function setFocusedLayer(doc: DiagramDoc, id: string | null): DiagramDoc {
  return { ...doc, focusedLayerId: id };
}

export function deleteLayer(doc: DiagramDoc, id: string, mode: 'keep' | 'all'): DiagramDoc {
  const layer = doc.layers.find((item) => item.id === id);
  if (!layer || doc.layers.length <= 1) return doc;

  const doomed = new Set([id, ...descendantLayerIds(doc.layers, id)]);
  // Cards must land on a layer that still exists – deleting the layer they all
  // sit on would otherwise point every node at a deleted id.
  const fallback =
    layer.parentId && !doomed.has(layer.parentId)
      ? layer.parentId
      : (doc.layers.find((item) => !doomed.has(item.id))?.id ?? MAIN_LAYER);

  const layers = doc.layers
    .filter((item) => !doomed.has(item.id))
    .map((item) =>
      item.parentId && doomed.has(item.parentId) && mode === 'keep' ? { ...item, parentId: fallback } : item,
    );

  if (mode === 'all') {
    const doomedNodes = new Set(doc.nodes.filter((node) => doomed.has(node.layerId)).map((node) => node.id));
    const stripped = removeNodes({ ...doc, layers }, [...doomedNodes]);
    return {
      ...stripped,
      focusedLayerId: stripped.focusedLayerId && doomed.has(stripped.focusedLayerId) ? null : stripped.focusedLayerId,
    };
  }

  const nodes = doc.nodes.map((node) => (doomed.has(node.layerId) ? { ...node, layerId: fallback } : node));
  return {
    ...doc,
    layers,
    nodes,
    focusedLayerId: doc.focusedLayerId && doomed.has(doc.focusedLayerId) ? null : doc.focusedLayerId,
  };
}

export function countNodesByLayer(doc: DiagramDoc): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of doc.nodes) counts.set(node.layerId, (counts.get(node.layerId) ?? 0) + 1);
  return counts;
}

export function moveLayer(doc: DiagramDoc, layerId: string, delta: -1 | 1): DiagramDoc {
  const layer = doc.layers.find((item) => item.id === layerId);
  if (!layer) return doc;
  const siblings = doc.layers.filter((item) => item.parentId === layer.parentId);
  const index = siblings.findIndex((item) => item.id === layerId);
  const swapWith = siblings[index + delta];
  if (!swapWith) return doc;
  const layers = [...doc.layers];
  const a = layers.findIndex((item) => item.id === layerId);
  const b = layers.findIndex((item) => item.id === swapWith.id);
  [layers[a], layers[b]] = [layers[b], layers[a]];
  return { ...doc, layers };
}

export type StackMode = 'front' | 'forward' | 'backward' | 'back';

const zOf = (node: DiagramNode) => node.z ?? 0;

export function bringNodeZ(doc: DiagramDoc, nodeId: string, mode: StackMode): DiagramDoc {
  const node = doc.nodes.find((item) => item.id === nodeId);
  if (!node) return doc;
  const peers = doc.nodes.filter(
    (item) => item.layerId === node.layerId && (item.kind === 'section') === (node.kind === 'section'),
  );
  const values = peers.map(zOf);
  const current = zOf(node);
  const next =
    mode === 'front'
      ? Math.max(current, ...values) + 1
      : mode === 'back'
        ? Math.min(current, ...values) - 1
        : mode === 'forward'
          ? current + 1
          : current - 1;
  return patchNode(doc, nodeId, { z: next });
}

export function setSectionSize(doc: DiagramDoc, sectionId: string, size: { w: number; h: number } | null): DiagramDoc {
  const node = doc.nodes.find((item) => item.id === sectionId);
  if (!node || node.kind !== 'section') return doc;
  if (!size) return patchNode(doc, sectionId, { manualSize: false, size: undefined });
  return patchNode(doc, sectionId, {
    size: { w: Math.round(size.w), h: Math.round(size.h) },
    manualSize: true,
  });
}

const GRID_GAP_X = 16;
const GRID_GAP_Y = 14;

export function arrangeSection(doc: DiagramDoc, sectionId: string, columns?: number): DiagramDoc {
  const section = doc.nodes.find((item) => item.id === sectionId && item.kind === 'section');
  if (!section) return doc;
  const children = doc.nodes.filter((item) => item.parentId === sectionId);
  if (children.length === 0) return doc;

  const cols = Math.max(1, Math.min(columns ?? Math.ceil(Math.sqrt(children.length)), Math.max(1, children.length)));
  const cellW = Math.max(...children.map((child) => nodeSize(child).w));
  const cellH = Math.max(...children.map((child) => nodeSize(child).h));
  const positions = new Map<string, { x: number; y: number }>();
  children.forEach((child, index) => {
    positions.set(child.id, {
      x: SECTION_PAD + (index % cols) * (cellW + GRID_GAP_X),
      y: SECTION_HEADER + 8 + Math.floor(index / cols) * (cellH + GRID_GAP_Y),
    });
  });

  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      const position = positions.get(node.id);
      if (position) return { ...node, position };
      if (node.id === sectionId) return { ...node, manualSize: false };
      return node;
    }),
  };
}

export function releaseSectionSize(doc: DiagramDoc, sectionIds: Iterable<string>): DiagramDoc {
  const ids = new Set<string>();
  for (const id of sectionIds) {
    const section = doc.nodes.find((item) => item.id === id);
    if (section?.manualSize) ids.add(id);
  }
  if (ids.size === 0) return doc;
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (ids.has(node.id) ? { ...node, manualSize: false, size: undefined } : node)),
  };
}
