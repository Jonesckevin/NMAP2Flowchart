import type { NmapHost } from '../model/types';
import type { RiskPolicy } from './risk';

export type Layer = {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  color: string;
};

export type NodeKind = 'host' | 'section' | 'note' | 'hop' | 'origin';

export type DiagramNode = {
  id: string;
  kind: NodeKind;
  layerId: string;
  position: { x: number; y: number };
  parentId?: string | null;
  label?: string;
  subtitle?: string;
  icon?: string;
  accent?: string;
  notes?: string;
  collapsed?: boolean;
  size?: { w: number; h: number };
  manualSize?: boolean;
  z?: number;
  host?: NmapHost;
  cidr?: string;
  address?: string;
  depth?: number;
  stale?: boolean;
};

export type EdgeKind = 'route' | 'link';

export type EdgeLine = 'solid' | 'dashed' | 'dotted';

export const EDGE_LINES: EdgeLine[] = ['solid', 'dashed', 'dotted'];

export type EdgePath = 'curve' | 'straight' | 'step' | 'smoothstep';

export const EDGE_PATHS: EdgePath[] = ['curve', 'straight', 'step', 'smoothstep'];

export const EDGE_PATH_LABELS: Record<EdgePath, string> = {
  curve: 'Curve',
  straight: 'Straight',
  step: 'Step',
  smoothstep: 'Square',
};

export type DiagramEdge = {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  line?: EdgeLine;
  path?: EdgePath;
};

export function edgeLine(edge: DiagramEdge): EdgeLine {
  return edge.line ?? (edge.kind === 'route' ? 'dashed' : 'solid');
}

export function edgePath(edge: DiagramEdge): EdgePath {
  return edge.path ?? (edge.kind === 'route' ? 'smoothstep' : 'curve');
}

export type DiagramDoc = {
  version: 2;
  fileName: string;
  args?: string;
  layers: Layer[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  focusedLayerId: string | null;
  /**
   * Risk levels for this diagram. Absent or `null` inherits the account policy,
   * then the server policy, then the built-in default – so saved workspaces from
   * before risk levels existed keep working unchanged.
   */
  risk?: RiskPolicy | null;
};

export const MAIN_LAYER = 'layer:main';
export const NOTES_LAYER = 'layer:notes';

export const LAYER_COLORS = ['#4b9fff', '#2fd6a5', '#f0a25c', '#c084fc', '#f472b6', '#facc15', '#94a3b8'];

export function nodeTitle(node: DiagramNode): string {
  if (node.label) return node.label;
  if (node.kind === 'section') return node.cidr || 'section';
  if (node.kind === 'hop') return node.address || 'new hop';
  if (node.kind === 'origin') return node.address || 'scan origin';
  if (node.host) return node.host.ip || 'new host';
  return node.kind === 'note' ? 'Note' : 'node';
}

export function nodeSubtitle(node: DiagramNode): string {
  if (node.subtitle) return node.subtitle;
  if (node.host) return node.host.hostnames.find((name) => name.trim()) ?? node.host.mac ?? '';
  return '';
}

export function layerMap(layers: Layer[]): Map<string, Layer> {
  return new Map(layers.map((layer) => [layer.id, layer]));
}

export function layerChain(layers: Map<string, Layer>, layerId: string): Layer[] {
  const chain: Layer[] = [];
  let current = layers.get(layerId);
  let guard = 0;
  while (current && guard < 32) {
    chain.push(current);
    current = current.parentId ? layers.get(current.parentId) : undefined;
    guard += 1;
  }
  return chain;
}

export function isLayerVisible(
  layers: Map<string, Layer>,
  layerId: string,
  focusedLayerId: string | null,
): boolean {
  if (focusedLayerId) {
    const chain = layerChain(layers, layerId);
    if (!chain.some((layer) => layer.id === focusedLayerId)) return false;
  }
  return layerChain(layers, layerId).every((layer) => layer.visible);
}

export function layerDepth(layers: Map<string, Layer>, layerId: string): number {
  return Math.max(0, layerChain(layers, layerId).length - 1);
}

export function flattenLayers(layers: Layer[]): { layer: Layer; depth: number }[] {
  const byParent = new Map<string | null, Layer[]>();
  for (const layer of layers) {
    const key = layer.parentId;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(layer);
    else byParent.set(key, [layer]);
  }
  const out: { layer: Layer; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const layer of byParent.get(parentId) ?? []) {
      out.push({ layer, depth });
      walk(layer.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function descendantLayerIds(layers: Layer[], layerId: string): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const layer of layers) {
      if (layer.parentId === id) {
        out.push(layer.id);
        walk(layer.id);
      }
    }
  };
  walk(layerId);
  return out;
}
