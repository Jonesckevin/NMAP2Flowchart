import { openPorts, type NmapHost, type NmapPort } from '../model/types';
import { normalizeRiskPolicy, type RiskPolicy, type RiskScope } from './risk';
import {
  EDGE_ARROWS,
  EDGE_LINES,
  EDGE_PATHS,
  EDGE_SIDES,
  LAYER_COLORS,
  MAIN_LAYER,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type EdgeKind,
  type Layer,
  type NodeKind,
} from './types';

/**
 * Portable design file: the whole document plus the risk levels that were in
 * force when it was written. It is the transfer format – reopen it in this
 * browser, in another browser, or in a standalone build, and the diagram comes
 * back exactly as it was drawn.
 */
export const DESIGN_FORMAT = 'nmap2flowchart-design';
export const DESIGN_FORMAT_VERSION = 1;
export const DESIGN_GENERATOR = 'NMAP2Flowchart';
export const DESIGN_EXTENSION = '.nmap2flowchart.json';

/**
 * Risk levels copied into the file so a diagram keeps its colours elsewhere.
 * Only inherited levels are recorded – levels saved on the diagram already
 * travel inside `doc.risk`, and the built-in default is the same everywhere.
 */
export type DesignRisk = { policy: RiskPolicy; scope: RiskScope };

export type DesignFile = {
  format: typeof DESIGN_FORMAT;
  formatVersion: number;
  generator: string;
  exportedAt: string;
  doc: DiagramDoc;
  risk?: DesignRisk;
};

/** Everything dropped or re-pointed while reading a file, for the open dialog. */
export type DesignRepair = { layers: number; nodes: number; edges: number };

export type DesignRead =
  | { ok: true; design: DesignFile; doc: DiagramDoc; repair: DesignRepair }
  | { ok: false; reason: string };

export type DesignCounts = {
  hosts: number;
  sections: number;
  notes: number;
  hops: number;
  layers: number;
  links: number;
  openPorts: number;
};

const NODE_KINDS: NodeKind[] = ['host', 'section', 'note', 'hop', 'origin'];
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function position(value: unknown): { x: number; y: number } {
  const raw = record(value);
  const x = typeof raw?.x === 'number' && Number.isFinite(raw.x) ? raw.x : 0;
  const y = typeof raw?.y === 'number' && Number.isFinite(raw.y) ? raw.y : 0;
  return { x, y };
}

function repairLayers(value: unknown): { layers: Layer[]; dropped: number } {
  const layers: Layer[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of Array.isArray(value) ? value : []) {
    const raw = record(entry);
    const id = text(raw?.id);
    if (!id || seen.has(id)) {
      dropped += 1;
      continue;
    }
    seen.add(id);
    const color = text(raw?.color);
    layers.push({
      id,
      name: text(raw?.name) || 'Layer',
      parentId: text(raw?.parentId) || null,
      visible: raw?.visible !== false,
      color: HEX_COLOR.test(color) ? color : LAYER_COLORS[layers.length % LAYER_COLORS.length],
    });
  }
  if (layers.length === 0) {
    return {
      layers: [{ id: MAIN_LAYER, name: 'Scanned network', parentId: null, visible: true, color: LAYER_COLORS[0] }],
      dropped,
    };
  }
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  for (const layer of layers) {
    const chain = new Set([layer.id]);
    let parent = layer.parentId;
    while (parent) {
      const next = byId.get(parent);
      if (!next || chain.has(parent)) {
        layer.parentId = null;
        break;
      }
      chain.add(parent);
      parent = next.parentId;
    }
  }
  return { layers, dropped };
}

function repairPorts(value: unknown): NmapPort[] {
  const ports: NmapPort[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const raw = record(entry);
    const port = typeof raw?.port === 'number' ? raw.port : Number(raw?.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    ports.push({
      port,
      protocol: text(raw?.protocol) || 'tcp',
      state: text(raw?.state) || 'open',
      service: text(raw?.service) || undefined,
      product: text(raw?.product) || undefined,
      version: text(raw?.version) || undefined,
      extrainfo: text(raw?.extrainfo) || undefined,
      devicetype: text(raw?.devicetype) || undefined,
      ostype: text(raw?.ostype) || undefined,
      cpe: Array.isArray(raw?.cpe) ? raw.cpe.filter((item): item is string => typeof item === 'string') : undefined,
      scripts: (Array.isArray(raw?.scripts) ? raw.scripts : []).flatMap((script) => {
        const item = record(script);
        const id = text(item?.id);
        return id ? [{ id, output: text(item?.output) }] : [];
      }),
    });
  }
  return ports;
}

function repairHost(value: unknown): NmapHost | null {
  const raw = record(value);
  if (!raw) return null;
  return {
    id: text(raw.id),
    ip: text(raw.ip),
    ipv6: text(raw.ipv6) || undefined,
    addresses: Array.isArray(raw.addresses) ? raw.addresses.filter((item): item is string => typeof item === 'string') : undefined,
    mac: text(raw.mac) || undefined,
    vendor: text(raw.vendor) || undefined,
    macs: (Array.isArray(raw.macs) ? raw.macs : []).flatMap((entry) => {
      const item = record(entry);
      const addr = text(item?.addr);
      return addr ? [{ addr, vendor: text(item?.vendor) || undefined }] : [];
    }),
    hostnames: (Array.isArray(raw.hostnames) ? raw.hostnames : []).filter((item): item is string => typeof item === 'string'),
    status: text(raw.status) || 'up',
    os: (Array.isArray(raw.os) ? raw.os : []).flatMap((entry) => {
      const item = record(entry);
      const name = text(item?.name);
      if (!name) return [];
      const classes = (Array.isArray(item?.classes) ? item.classes : []).flatMap((value) => {
        const cls = record(value);
        const type = text(cls?.type);
        if (!type) return [];
        return [
          {
            type,
            vendor: text(cls?.vendor) || undefined,
            osfamily: text(cls?.osfamily) || undefined,
            osgen: text(cls?.osgen) || undefined,
            accuracy: typeof cls?.accuracy === 'number' ? cls.accuracy : 0,
          },
        ];
      });
      return [
        {
          name,
          accuracy: typeof item?.accuracy === 'number' ? item.accuracy : 0,
          ...(classes.length > 0 ? { classes } : {}),
        },
      ];
    }),
    ports: repairPorts(raw.ports),
    portsScanned: raw.portsScanned === false ? false : undefined,
    scripts: (Array.isArray(raw.scripts) ? raw.scripts : []).flatMap((script) => {
      const item = record(script);
      const id = text(item?.id);
      return id ? [{ id, output: text(item?.output) }] : [];
    }),
    hops: (Array.isArray(raw.hops) ? raw.hops : []).filter((item): item is string => typeof item === 'string'),
  };
}

function repairNodes(value: unknown, layers: Layer[]): { nodes: DiagramNode[]; dropped: number } {
  const layerIds = new Set(layers.map((layer) => layer.id));
  const nodes: DiagramNode[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const entry of Array.isArray(value) ? value : []) {
    const raw = record(entry);
    const id = text(raw?.id);
    const kind = text(raw?.kind) as NodeKind;
    if (!raw || !id || seen.has(id) || !NODE_KINDS.includes(kind)) {
      dropped += 1;
      continue;
    }
    const host = kind === 'host' ? repairHost(raw.host) : null;
    if (kind === 'host' && !host) {
      dropped += 1;
      continue;
    }
    const size = record(raw.size);
    const w = typeof size?.w === 'number' && size.w > 0 ? size.w : undefined;
    const h = typeof size?.h === 'number' && size.h > 0 ? size.h : undefined;
    seen.add(id);
    nodes.push({
      id,
      kind,
      layerId: layerIds.has(text(raw.layerId)) ? text(raw.layerId) : layers[0].id,
      position: position(raw.position),
      parentId: text(raw.parentId) || null,
      label: text(raw.label) || undefined,
      subtitle: text(raw.subtitle) || undefined,
      icon: text(raw.icon) || undefined,
      accent: HEX_COLOR.test(text(raw.accent)) ? text(raw.accent) : undefined,
      notes: typeof raw.notes === 'string' ? raw.notes : undefined,
      collapsed: raw.collapsed === true ? true : undefined,
      size: w && h ? { w, h } : undefined,
      manualSize: raw.manualSize === true ? true : undefined,
      z: typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : undefined,
      host: host ?? undefined,
      cidr: text(raw.cidr) || undefined,
      address: text(raw.address) || undefined,
      depth: typeof raw.depth === 'number' && Number.isFinite(raw.depth) ? raw.depth : undefined,
      stale: raw.stale === true ? true : undefined,
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (node.parentId && (!parent || parent.kind !== 'section')) node.parentId = null;
  }
  return { nodes, dropped };
}

function repairEdges(value: unknown, nodes: DiagramNode[]): { edges: DiagramEdge[]; dropped: number } {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: DiagramEdge[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const entry of Array.isArray(value) ? value : []) {
    const raw = record(entry);
    const id = text(raw?.id);
    const source = text(raw?.source);
    const target = text(raw?.target);
    if (!raw || !id || seen.has(id) || !nodeIds.has(source) || !nodeIds.has(target)) {
      dropped += 1;
      continue;
    }
    const kind: EdgeKind = raw.kind === 'route' ? 'route' : 'link';
    const line = EDGE_LINES.find((item) => item === raw.line);
    const path = EDGE_PATHS.find((item) => item === raw.path);
    const from = EDGE_SIDES.find((side) => side === raw.from);
    const to = EDGE_SIDES.find((side) => side === raw.to);
    const arrow = EDGE_ARROWS.find((style) => style === raw.arrow);
    seen.add(id);
    edges.push({
      id,
      source,
      target,
      kind,
      label: text(raw.label) || undefined,
      line,
      path,
      from,
      to,
      arrow,
    });
  }
  return { edges, dropped };
}

function repairDoc(value: unknown): { doc: DiagramDoc; repair: DesignRepair } | null {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.nodes)) return null;

  const { layers, dropped: droppedLayers } = repairLayers(raw.layers);
  const { nodes, dropped: droppedNodes } = repairNodes(raw.nodes, layers);
  const { edges, dropped: droppedEdges } = repairEdges(raw.edges, nodes);
  const focused = text(raw.focusedLayerId);

  return {
    doc: {
      version: 2,
      fileName: text(raw.fileName) || 'untitled diagram',
      args: text(raw.args) || undefined,
      layers,
      nodes,
      edges,
      focusedLayerId: layers.some((layer) => layer.id === focused) ? focused : null,
      risk: normalizeRiskPolicy(raw.risk),
    },
    repair: { layers: droppedLayers, nodes: droppedNodes, edges: droppedEdges },
  };
}

/** Wraps a document for download. Includes inherited risk levels, not the diagram's own. */
export function buildDesignFile(doc: DiagramDoc, risk?: DesignRisk | null): DesignFile {
  const file: DesignFile = {
    format: DESIGN_FORMAT,
    formatVersion: DESIGN_FORMAT_VERSION,
    generator: DESIGN_GENERATOR,
    exportedAt: new Date().toISOString(),
    doc,
  };
  if (risk && (risk.scope === 'account' || risk.scope === 'server') && risk.policy.levels.length > 0) {
    file.risk = { policy: risk.policy, scope: risk.scope };
  }
  return file;
}

/**
 * Reads a design file, a workspace saved by an earlier build (`{version, doc}`)
 * or a bare document, and repairs what it can rather than rejecting the file.
 */
export function readDesignFile(raw: string): DesignRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'That file is not JSON.' };
  }
  const outer = record(parsed);
  if (!outer) return { ok: false, reason: 'That JSON has no diagram in it.' };

  if (outer.format === DESIGN_FORMAT) {
    const version = typeof outer.formatVersion === 'number' ? outer.formatVersion : DESIGN_FORMAT_VERSION;
    if (version > DESIGN_FORMAT_VERSION) {
      return { ok: false, reason: `That design file was written by a newer NMAP2Flowchart (format ${version}).` };
    }
  }

  const candidate = record(outer.doc) ?? outer;
  const repaired = repairDoc(candidate);
  if (!repaired) {
    return {
      ok: false,
      reason:
        outer.format === DESIGN_FORMAT || outer.doc
          ? 'That design file has no readable diagram.'
          : 'That JSON is not an NMAP2Flowchart design – it has no diagram in it.',
    };
  }

  const design: DesignFile = {
    format: DESIGN_FORMAT,
    formatVersion: DESIGN_FORMAT_VERSION,
    generator: text(outer.generator) || DESIGN_GENERATOR,
    exportedAt: text(outer.exportedAt),
    doc: repaired.doc,
    risk: undefined,
  };
  const snapshot = record(outer.risk);
  const policy = normalizeRiskPolicy(snapshot?.policy);
  if (policy) {
    const scope = snapshot?.scope;
    design.risk = {
      policy,
      scope: scope === 'account' || scope === 'server' || scope === 'default' ? scope : 'account',
    };
  }
  return { ok: true, design, doc: repaired.doc, repair: repaired.repair };
}

/** True when the text looks like a saved diagram rather than nmap XML. */
export function looksLikeJson(raw: string): boolean {
  return /^[\uFEFF\s]*[{[]/.test(raw);
}

export function designCounts(doc: DiagramDoc): DesignCounts {
  let hosts = 0;
  let sections = 0;
  let notes = 0;
  let hops = 0;
  let openPortCount = 0;
  for (const node of doc.nodes) {
    if (node.kind === 'host') hosts += 1;
    else if (node.kind === 'section') sections += 1;
    else if (node.kind === 'note') notes += 1;
    else hops += 1;
    openPortCount += node.host ? openPorts(node.host).length : 0;
  }
  return { hosts, sections, notes, hops, layers: doc.layers.length, links: doc.edges.length, openPorts: openPortCount };
}
