import type { NmapHost, NmapScan } from '../model/types';
import { detectIcon } from '../icons/registry';
import { layoutScan, HOST_H, HOST_W } from '../graph/layout';
import {
  LAYER_COLORS,
  MAIN_LAYER,
  NOTES_LAYER,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type Layer,
} from './types';

function baseLayers(): Layer[] {
  return [
    { id: MAIN_LAYER, name: 'Scanned network', parentId: null, visible: true, color: '#4b9fff' },
    { id: NOTES_LAYER, name: 'Notes & links', parentId: null, visible: true, color: '#facc15' },
  ];
}

const nodeId = (kind: string, value: string) => `${kind}:${value.replace(/[^0-9a-zA-Z./:]+/g, '_')}`;

export function hostNodeId(host: NmapHost): string {
  return nodeId('host', host.ip);
}

function buildFromScan(scan: NmapScan): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const layout = layoutScan(scan);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const discoveryScan = scan.hosts.length > 0 && scan.hosts.every((host) => host.portsScanned === false);

  nodes.push({
    id: 'origin',
    kind: 'origin',
    layerId: MAIN_LAYER,
    position: layout.origin,
    icon: 'cloud',
    label: 'Scan origin',
    address: scan.args ? scan.args.replace(/\s+/g, ' ').slice(0, 120) : undefined,
    subtitle: `${scan.hosts.length} hosts${discoveryScan ? ' · no port scan' : ''}`,
  });

  for (const hop of layout.hops) {
    nodes.push({
      id: nodeId('hop', hop.ip),
      kind: 'hop',
      layerId: MAIN_LAYER,
      position: { x: hop.x, y: hop.y },
      address: hop.ip,
      depth: hop.depth,
      subtitle: hop.hostname,
      icon: 'router',
    });
  }

  for (const subnet of layout.subnets) {
    const sectionId = nodeId('section', subnet.cidr);
    nodes.push({
      id: sectionId,
      kind: 'section',
      layerId: MAIN_LAYER,
      position: { x: subnet.x, y: subnet.y },
      cidr: subnet.cidr,
      icon: 'server',
      size: { w: subnet.w, h: subnet.h },
    });

    for (const placed of subnet.hosts) {
      nodes.push({
        id: hostNodeId(placed.host),
        kind: 'host',
        layerId: MAIN_LAYER,
        parentId: sectionId,
        position: { x: placed.x, y: placed.y },
        host: placed.host,
        icon: detectIcon(placed.host),
      });
    }
  }

  edges.push(...routeEdges(nodes));
  return { nodes, edges };
}

export function routeEdges(nodes: DiagramNode[]): DiagramEdge[] {
  const byLayer = new Map<string, DiagramNode[]>();
  for (const node of nodes) {
    const bucket = byLayer.get(node.layerId);
    if (bucket) bucket.push(node);
    else byLayer.set(node.layerId, [node]);
  }
  return [...byLayer.values()].flatMap((group) => routeEdgesInLayer(group));
}

function routeEdgesInLayer(nodes: DiagramNode[]): DiagramEdge[] {
  const origin = nodes.find((node) => node.kind === 'origin');
  const hops = nodes.filter((node) => node.kind === 'hop' && node.address);
  const hopByAddress = new Map(hops.map((hop) => [hop.address as string, hop]));
  const depths = [...new Set(hops.map((hop) => hop.depth ?? 1))].sort((a, b) => a - b);
  const edges: DiagramEdge[] = [];

  if (origin) {
    for (const hop of hops.filter((hop) => (hop.depth ?? 1) === depths[0])) {
      edges.push({ id: `route:${origin.id}-${hop.id}`, source: origin.id, target: hop.id, kind: 'route' });
    }
  }
  for (let i = 0; i < depths.length - 1; i += 1) {
    for (const from of hops.filter((hop) => (hop.depth ?? 1) === depths[i])) {
      for (const to of hops.filter((hop) => (hop.depth ?? 1) === depths[i + 1])) {
        edges.push({ id: `route:${from.id}-${to.id}`, source: from.id, target: to.id, kind: 'route' });
      }
    }
  }
  for (const host of nodes.filter((node) => node.kind === 'host' && node.host)) {
    const chain = host.host?.hops ?? [];
    const last = chain[chain.length - 1];
    const hop = last ? hopByAddress.get(last) : undefined;
    if (!hop) continue;
    edges.push({ id: `route:${hop.id}-${host.id}`, source: hop.id, target: host.id, kind: 'route' });
  }
  return edges;
}

export function createDocFromScan(scan: NmapScan): DiagramDoc {
  const { nodes, edges } = buildFromScan(scan);
  return {
    version: 2,
    fileName: scan.fileName,
    args: scan.args,
    layers: baseLayers(),
    nodes,
    edges,
    focusedLayerId: null,
  };
}

let layerCounter = 0;

const nextLayerId = () => {
  layerCounter += 1;
  return `layer:scan-${Date.now().toString(36)}${layerCounter.toString(36)}`;
};

function rootBottom(nodes: DiagramNode[]): number {
  const bottomOf = (node: DiagramNode) =>
    node.position.y + (node.size?.h ?? (node.kind === 'section' ? 220 : 120));
  return Math.max(0, ...nodes.filter((node) => !node.parentId).map(bottomOf));
}

export function importScanAsLayer(
  doc: DiagramDoc,
  scan: NmapScan,
): { doc: DiagramDoc; layerId: string; added: number } {
  const fresh = buildFromScan(scan);
  const layerId = nextLayerId();
  const base = (scan.fileName.replace(/\.[^.]+$/, '') || 'scan').slice(0, 42);
  const usedNames = new Set(doc.layers.map((item) => item.name));
  let name = base;
  for (let n = 2; usedNames.has(name); n += 1) name = `${base} ${n}`;
  const layer: Layer = {
    id: layerId,
    name,
    parentId: null,
    visible: true,
    color: LAYER_COLORS[doc.layers.length % LAYER_COLORS.length],
  };

  const taken = new Set(doc.nodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  let counter = 0;
  for (const node of fresh.nodes) {
    let id = node.id;
    while (taken.has(id)) {
      counter += 1;
      id = `${node.id}~${counter}`;
    }
    taken.add(id);
    idMap.set(node.id, id);
  }

  const offset = rootBottom(doc.nodes) + 140;
  const nodes: DiagramNode[] = fresh.nodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) ?? node.id,
    layerId,
    position: node.parentId ? node.position : { x: node.position.x, y: node.position.y + offset },
    parentId: node.parentId ? (idMap.get(node.parentId) ?? node.parentId) : (node.parentId ?? null),
  }));

  return {
    doc: {
      ...doc,
      focusedLayerId: null,
      layers: [...doc.layers, layer],
      nodes: [...doc.nodes, ...nodes],
      edges: [...doc.edges, ...routeEdges(nodes)],
    },
    layerId,
    added: nodes.length,
  };
}

export function emptyDoc(): DiagramDoc {
  return {
    version: 2,
    fileName: 'untitled diagram',
    layers: baseLayers(),
    nodes: [],
    edges: [],
    focusedLayerId: null,
  };
}

export function mergeScanIntoDoc(doc: DiagramDoc, scan: NmapScan): { doc: DiagramDoc; added: number; gone: number } {
  const fresh = buildFromScan(scan);
  const layerNodes = doc.nodes.filter((node) => node.layerId === MAIN_LAYER);
  const otherNodes = doc.nodes.filter((node) => node.layerId !== MAIN_LAYER);
  const existing = new Map(layerNodes.map((node) => [identify(node), node]));
  const existingById = new Map(layerNodes.map((node) => [node.id, node]));

  const bottomOf = (node: DiagramNode) =>
    node.position.y + (node.size?.h ?? (node.kind === 'section' ? 220 : 120));
  const existingBottom = Math.max(0, ...doc.nodes.filter((node) => !node.parentId).map(bottomOf));
  const offset = existingBottom + 140;

  const newSectionIds = new Set(
    fresh.nodes.filter((node) => node.kind === 'section' && !existingById.has(node.id)).map((node) => node.id),
  );
  const childCount = new Map<string, number>();
  for (const node of doc.nodes) {
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }

  const nodes: DiagramNode[] = [];
  let added = 0;

  for (const incoming of fresh.nodes) {
    const match = existing.get(identify(incoming));
    if (match) {
      nodes.push({
        ...match,
        host: incoming.host ?? match.host,
        address: incoming.address ?? match.address,
        depth: incoming.depth ?? match.depth,
        subtitle: match.subtitle ?? incoming.subtitle,
        stale: false,
      });
      continue;
    }

    added += 1;
    if (incoming.kind === 'section') {
      nodes.push({ ...incoming, position: { x: incoming.position.x, y: incoming.position.y + offset } });
      continue;
    }
    if (incoming.parentId && newSectionIds.has(incoming.parentId)) {
      nodes.push(incoming);
      continue;
    }
    if (incoming.parentId) {
      const index = childCount.get(incoming.parentId) ?? 0;
      childCount.set(incoming.parentId, index + 1);
      const cols = 3;
      nodes.push({
        ...incoming,
        position: {
          x: 24 + (index % cols) * (HOST_W + 16),
          y: 44 + 24 + Math.floor(index / cols) * (HOST_H + 14),
        },
      });
      continue;
    }
    nodes.push({ ...incoming, position: { x: incoming.position.x, y: incoming.position.y + offset } });
  }

  const seen = new Set(nodes.map(identify));
  let gone = 0;
  for (const node of layerNodes) {
    if (node.kind === 'note' || node.kind === 'origin' || seen.has(identify(node))) continue;
    nodes.push({ ...node, stale: true });
    if (node.kind === 'host') gone += 1;
  }
  nodes.push(...otherNodes);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = doc.edges.filter(
    (edge) => edge.kind === 'link' && nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const routes = routeEdges(nodes).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  return {
    doc: { ...doc, fileName: scan.fileName, args: scan.args ?? doc.args, nodes, edges: [...routes, ...links] },
    added,
    gone,
  };
}

export function identify(node: DiagramNode): string {
  if (node.kind === 'host') return `host:${node.host?.ip || node.id}`;
  if (node.kind === 'section') return `section:${node.cidr || node.id}`;
  if (node.kind === 'hop') return `hop:${node.address || node.id}`;
  if (node.kind === 'origin') return 'origin';
  return node.id;
}

export type ImportMode = 'merge' | 'replace' | 'layer';

export type ImportEffect = {
  nodes: number;
  matched: number;
  added: number;
  stale: number;
};

/**
 * Effect counts for all three import modes from a single layout pass: switching
 * mode in the preview dialog is instant, and a big scan is only laid out once.
 */
export function scanEffects(
  doc: DiagramDoc | null,
  scan: NmapScan,
): Record<ImportMode, ImportEffect> {
  const fresh = buildFromScan(scan).nodes;
  const freshOnly = { nodes: fresh.length, matched: 0, added: fresh.length, stale: 0 };
  if (!doc) return { replace: freshOnly, layer: freshOnly, merge: freshOnly };

  const layerNodes = doc.nodes.filter((node) => node.layerId === MAIN_LAYER);
  const existing = new Set(layerNodes.map(identify));
  const seen = new Set(fresh.map(identify));
  let matched = 0;
  for (const node of fresh) if (existing.has(identify(node))) matched += 1;
  const stale = layerNodes.filter(
    (node) => node.kind === 'host' && !seen.has(identify(node)),
  ).length;

  return {
    replace: freshOnly,
    layer: freshOnly,
    merge: { nodes: fresh.length, matched, added: fresh.length - matched, stale },
  };
}

export function previewImport(
  doc: DiagramDoc | null,
  scan: NmapScan,
  mode: ImportMode,
): ImportEffect {
  return scanEffects(doc, scan)[mode];
}
