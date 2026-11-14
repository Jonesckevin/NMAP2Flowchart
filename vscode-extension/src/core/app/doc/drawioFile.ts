import { XMLParser } from 'fast-xml-parser';

import { ICONS } from '../icons/registry';
import type { NmapHost, NmapPort } from '../model/types';
import { HOP_H, HOP_W, HOST_H, HOST_W, ORIGIN_H, ORIGIN_W, NOTE_H, NOTE_W } from '../graph/layout';
import {
  SECTION_HEADER,
  SECTION_MIN_H,
  SECTION_MIN_W,
  SECTION_PAD,
  absolutePosition,
  measureSection,
  nodeSize,
  sectionMinSize,
} from './measure';
import {
  LAYER_COLORS,
  MAIN_LAYER,
  NOTES_LAYER,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type EdgeArrow,
  type EdgeKind,
  type EdgeLine,
  type EdgePath,
  type EdgeSide,
  type Layer,
} from './types';

/**
 * draw.io (diagrams.net) reader: `.drawio`, `.xml` or a raw `<mxGraphModel>` –
 * never by extension, because draw.io writes XML with any of them.
 *
 * Two things have to come back: a file NMAP2Flowchart exported (so a diagram can
 * travel through draw.io and return), and a hand-drawn draw.io network diagram
 * somebody wants to keep editing here. Both are read from the same cells: a shape
 * with an address in its label is a host, a frame holding other shapes is a
 * section, a shape with neither is a note, and lines become the connections.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

type Raw = Record<string, unknown>;

const EMBLEM_TO_ICON = new Map<string, string>();
for (const icon of ICONS) {
  // Several icons share an emblem; the first is the plain one (🖥️ is a desktop
  // before it is a flow node), and that is what a label most likely meant.
  if (!EMBLEM_TO_ICON.has(icon.emoji)) EMBLEM_TO_ICON.set(icon.emoji, icon.id);
}

const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const CIDR = /((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2})/;
const MAC = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const HOP_TITLE = /^hop\s+(\d+)$/i;
const ORIGIN_TITLE = /^scan origin$/i;
const PORT_ENTRY = /^(\d{1,5})(?:\/([a-z0-9|_./-]+))?$/i;
/** A DNS-ish name – and not an address, which the dot-separated shape also fits. */
const HOSTNAME = /^(?=.*[a-z])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\.?$/i;

export type DrawioRead = { ok: true; doc: DiagramDoc; ignored: number } | { ok: false; reason: string };

/** What a cell looked like once its attributes, style and geometry were read. */
type Cell = {
  id: string;
  value: string;
  style: Map<string, string>;
  vertex: boolean;
  edge: boolean;
  parent?: string;
  source?: string;
  target?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hasGeometry: boolean;
};

const asArray = (value: unknown): unknown[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const asRecord = (value: unknown): Raw | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;

const attr = (node: Raw | null, name: string): string => {
  const value = node?.[`@_${name}`];
  return typeof value === 'string' ? value : '';
};

const number = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function styleMap(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of style.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) map.set(trimmed, '');
    else map.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  return map;
}

/** draw.io stores HTML in `value`; the label is what a person reads. */
export function drawioLabel(value: string): string {
  if (!value) return '';
  const decoded = value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  if (!/<[a-z/]/i.test(decoded)) return decoded.trim();
  return decoded
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function readCell(raw: Raw): Cell | null {
  const id = attr(raw, 'id');
  if (!id) return null;
  const geometry = asRecord(raw.mxGeometry);
  return {
    id,
    value: attr(raw, 'value'),
    style: styleMap(attr(raw, 'style')),
    vertex: attr(raw, 'vertex') === '1',
    edge: attr(raw, 'edge') === '1',
    parent: attr(raw, 'parent') || undefined,
    source: attr(raw, 'source') || undefined,
    target: attr(raw, 'target') || undefined,
    x: number(attr(geometry, 'x')),
    y: number(attr(geometry, 'y')),
    w: number(attr(geometry, 'width')),
    h: number(attr(geometry, 'height')),
    hasGeometry: Boolean(geometry),
  };
}

/** A draw.io geometry is relative to its parent cell, which may itself be a group. */
function absoluteOf(cell: Cell, byId: Map<string, Cell>): { x: number; y: number } {
  let x = cell.x;
  let y = cell.y;
  let parent = cell.parent ? byId.get(cell.parent) : undefined;
  let guard = 0;
  while (parent && guard < 32) {
    if (parent.hasGeometry) {
      x += parent.x;
      y += parent.y;
    }
    parent = parent.parent ? byId.get(parent.parent) : undefined;
    guard += 1;
  }
  return { x, y };
}

const cellNodeId = (cell: Cell) => `cell:${cell.id.replace(/[^0-9a-zA-Z-]+/g, '_')}`;
const nodeId = (kind: string, value: string) => `${kind}:${value.replace(/[^0-9a-zA-Z./:]+/g, '_')}`;

function accentOf(cell: Cell, defaults: string[]): string | undefined {
  const stroke = (cell.style.get('strokeColor') ?? '').toLowerCase();
  const fill = (cell.style.get('fillColor') ?? '').toLowerCase();
  for (const colour of [stroke, fill]) {
    if (/^#[0-9a-f]{6}$/.test(colour) && !defaults.includes(colour)) return colour;
  }
  return undefined;
}

/** `22/ssh, 53/domain, +3` – the port line an export writes, back into ports. */
function portsFrom(line: string): NmapPort[] {
  return line
    .split(',')
    .map((entry) => entry.trim())
    .flatMap((entry) => {
      const match = PORT_ENTRY.exec(entry);
      if (!match) return [];
      return [
        {
          port: Number.parseInt(match[1], 10),
          protocol: 'tcp',
          state: 'open',
          ...(match[2] ? { service: match[2].toLowerCase() } : {}),
          scripts: [],
        } satisfies NmapPort,
      ];
    });
}

const looksLikePorts = (line: string) =>
  /^\d{1,5}(\/[a-z0-9|_./-]+)?(,\s*\d{1,5}(\/[a-z0-9|_./-]+)?)*(,\s*\+\d+)?$/i.test(line);

function iconAndTitle(line: string): { icon?: string; title: string } {
  const match = /^\p{Extended_Pictographic}\uFE0F?\s*/u.exec(line);
  if (!match) return { title: line };
  const icon = EMBLEM_TO_ICON.get(match[0].trim());
  const rest = line.slice(match[0].length).trim();
  return icon ? { icon, title: rest } : { title: line };
}

type Built = { node: DiagramNode; cell: Cell };

/**
 * Turns whatever draw.io page a file holds into cells.
 *
 * draw.io writes a page either as nested `<mxGraphModel>` XML or as a deflated,
 * URL-encoded blob in the `<diagram>` element's text – the second is the default
 * for files it saves itself, so it has to be readable.
 */
async function pageCells(page: Raw): Promise<Raw[] | null> {
  const model = asRecord(page.mxGraphModel);
  if (model) return asArray(asRecord(model.root)?.mxCell).map((cell) => asRecord(cell)).filter((cell): cell is Raw => Boolean(cell));

  const encoded = typeof page['#text'] === 'string' ? page['#text'] : '';
  if (!encoded.trim()) return null;
  const inflated = await inflate(encoded);
  if (!inflated) return null;
  const tree = asRecord(parser.parse(inflated));
  const inflatedModel = asRecord(tree?.mxGraphModel);
  if (!inflatedModel) return null;
  return asArray(asRecord(inflatedModel.root)?.mxCell)
    .map((cell) => asRecord(cell))
    .filter((cell): cell is Raw => Boolean(cell));
}

async function inflate(encoded: string): Promise<string | null> {
  try {
    const binary = atob(encoded.replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    // deflate-raw is what draw.io writes: pako.deflateRaw, then URL-encode.
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const buffer = await new Response(stream.readable).arrayBuffer();
    return decodeURIComponent(new TextDecoder().decode(buffer));
  } catch {
    return null;
  }
}

export function looksLikeDrawio(text: string): boolean {
  const head = text.slice(0, 8192);
  return /<mxfile[\s>]/.test(head) || /<mxGraphModel[\s>]/.test(head);
}

export async function readDrawioFile(text: string, fileName: string): Promise<DrawioRead> {
  if (!looksLikeDrawio(text)) {
    return { ok: false, reason: 'That is not a draw.io file – it has no <mxfile> or <mxGraphModel> element.' };
  }

  let tree: Raw | null;
  try {
    tree = asRecord(parser.parse(text));
  } catch (error) {
    return { ok: false, reason: `That draw.io file could not be read: ${(error as Error).message}` };
  }

  const pages = asArray(tree?.mxfile ? asRecord(tree.mxfile)?.diagram : undefined);
  const models: Raw[] = tree?.mxGraphModel ? [tree.mxGraphModel as Raw] : pages.map((page) => asRecord(page) ?? {});
  if (models.length === 0) return { ok: false, reason: 'That draw.io file holds no diagram page.' };

  for (const page of models) {
    const raw = await pageCells(page);
    if (!raw) continue;
    const converted = convert(raw, fileName);
    if (converted.doc.nodes.length > 0) return converted;
  }

  const compressed = pages.some((page) => {
    const record = asRecord(page);
    return record ? !record.mxGraphModel && typeof record['#text'] === 'string' && record['#text'].trim().length > 0 : false;
  });
  return {
    ok: false,
    reason: compressed
      ? 'This draw.io file stores its page compressed and the browser could not unpack it. Open it in draw.io and save again with “File → Properties → Include a copy of my diagram”, or export it as an uncompressed .drawio file.'
      : 'That draw.io file has no shapes to import – it may be an empty page.',
  };
}

function convert(rawCells: Raw[], fileName: string): Exclude<DrawioRead, { ok: false }> {
  const cells = new Map<string, Cell>();
  for (const raw of rawCells) {
    const cell = readCell(raw);
    if (cell) cells.set(cell.id, cell);
  }

  const childCount = new Map<string, number>();
  for (const cell of cells.values()) {
    if (!cell.parent) continue;
    childCount.set(cell.parent, (childCount.get(cell.parent) ?? 0) + 1);
  }

  const layerName = fileName.replace(/\.(drawio|dio|xml)$/i, '').trim() || 'draw.io diagram';
  const layers: Layer[] = [
    { id: MAIN_LAYER, name: layerName, parentId: null, visible: true, color: LAYER_COLORS[0] },
    { id: NOTES_LAYER, name: 'Notes & links', parentId: null, visible: true, color: LAYER_COLORS[5] },
  ];

  const nodes: DiagramNode[] = [];
  const byCell = new Map<string, Built>();
  const usedIds = new Set<string>();
  /** Sections first, so a card can be placed inside one that was drawn later. */
  const sections = new Map<string, { node: DiagramNode; cell: Cell }>();
  let ignored = 0;

  const uniqueId = (id: string) => {
    let candidate = id;
    let suffix = 2;
    while (usedIds.has(candidate)) {
      candidate = `${id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
  };

  const isSection = (cell: Cell): boolean => {
    if (cell.style.has('group')) return false;
    if (childCount.has(cell.id) && [...cells.values()].some((child) => child.parent === cell.id && child.vertex)) return true;
    const label = drawioLabel(cell.value);
    return CIDR.test(label) || cell.style.get('swimlane') !== undefined;
  };

  const classify = (cell: Cell, label: string): 'host' | 'hop' | 'origin' | 'note' | 'section' => {
    const lines = label.split('\n');
    if (lines.length > 0 && HOP_TITLE.test(lines[0]) && IPV4.test(label)) return 'hop';
    if (lines.length > 0 && ORIGIN_TITLE.test(lines[0].replace(/[^\p{L} ]/gu, '').trim())) return 'origin';
    if (isSection(cell)) return 'section';
    if (IPV4.test(label)) return 'host';
    return 'note';
  };

  for (const cell of cells.values()) {
    if (!cell.vertex) continue;
    // The root and the layer cells are not shapes; a shape inside a card is decoration
    // (the accent stripe an export draws), not a node of its own.
    if (cell.id === '0' || cell.id === '1') continue;
    if (!cell.hasGeometry) {
      if (childCount.has(cell.id) === false && cell.value.trim().length > 0) ignored += 1;
      continue;
    }
    const parent = cell.parent ? cells.get(cell.parent) : undefined;
    if (parent?.vertex && !isSection(parent)) continue;

    const label = drawioLabel(cell.value);
    const kind = classify(cell, label);
    const absolute = absoluteOf(cell, cells);

    if (kind === 'section') {
      const cidr = CIDR.exec(label)?.[1];
      const firstLine = label.split('\n')[0] ?? '';
      const title = iconAndTitle(firstLine);
      const node: DiagramNode = {
        id: uniqueId(cidr ? nodeId('section', cidr) : cellNodeId(cell)),
        kind: 'section',
        layerId: MAIN_LAYER,
        position: absolute,
        ...(cidr ? { cidr } : {}),
        ...(title.title && title.title !== cidr ? { label: title.title } : {}),
        ...(title.icon ? { icon: title.icon } : {}),
        ...(accentOf(cell, ['#b6c1d1', '#f6f8fb']) ? { accent: accentOf(cell, ['#b6c1d1', '#f6f8fb']) } : {}),
        size: { w: Math.max(cell.w, SECTION_MIN_W), h: Math.max(cell.h, SECTION_MIN_H) },
      };
      sections.set(cell.id, { node, cell });
      byCell.set(cell.id, { node, cell });
      continue;
    }

    if (kind === 'note') {
      const note: DiagramNode = {
        id: uniqueId(cellNodeId(cell)),
        kind: 'note',
        layerId: NOTES_LAYER,
        position: absolute,
        notes: label,
        size: { w: cell.w > 0 ? cell.w : NOTE_W, h: cell.h > 0 ? cell.h : NOTE_H },
        ...(accentOf(cell, ['#e6d9a2', '#fffbe6']) ? { accent: accentOf(cell, ['#e6d9a2', '#fffbe6']) } : {}),
      };
      byCell.set(cell.id, { node: note, cell });
      continue;
    }

    const lines = label.split('\n').filter((line) => line.length > 0);
    const addressLine = lines.find((line) => IPV4.test(line)) ?? '';
    const ip = IPV4.exec(addressLine)?.[0] ?? '';
    const head = iconAndTitle(lines[0] ?? '');
    // The title may itself be the hostname ("🧱 fw.lab.internal"), so it counts too.
    const hostname = [head.title, ...lines.slice(1)].find((line) => HOSTNAME.test(line));
    const portLine = lines.find((line) => looksLikePorts(line) && !MAC.test(line.replace(/\s.*$/, '')));
    const macLine = lines.find((line) => MAC.test(line.split(/\s+/)[0]));
    const subtitleLine = lines.find(
      (line) => line !== lines[0] && line !== hostname && line !== portLine && line !== macLine && line !== addressLine,
    );

    if (kind === 'hop') {
      const depth = Number.parseInt(HOP_TITLE.exec(lines[0])?.[1] ?? '1', 10);
      const node: DiagramNode = {
        id: uniqueId(nodeId('hop', ip || cell.id)),
        kind: 'hop',
        layerId: MAIN_LAYER,
        position: absolute,
        address: ip || subtitleLine || lines[1] || '',
        depth,
        ...(subtitleLine && subtitleLine !== ip ? { subtitle: subtitleLine } : {}),
        ...(head.icon ? { icon: head.icon } : { icon: 'router' }),
        ...(accentOf(cell, ['#b6c1d1', '#eef2f7']) ? { accent: accentOf(cell, ['#b6c1d1', '#eef2f7']) } : {}),
      };
      byCell.set(cell.id, { node, cell });
      continue;
    }

    if (kind === 'origin') {
      // The line under the title is the command line, which carries addresses of
      // the scanned ranges – it is not an address field, so it is taken whole.
      const detail = lines.slice(1).join(' ').trim();
      const node: DiagramNode = {
        id: uniqueId('origin'),
        kind: 'origin',
        layerId: MAIN_LAYER,
        position: absolute,
        label: head.title || 'Scan origin',
        ...(detail ? { address: detail } : {}),
        ...(head.icon ? { icon: head.icon } : { icon: 'cloud' }),
        ...(accentOf(cell, ['#0f172a', '#1f2937']) ? { accent: accentOf(cell, ['#0f172a', '#1f2937']) } : {}),
      };
      byCell.set(cell.id, { node, cell });
      continue;
    }

    const vm = /\s*\(VM\)$/.test(head.title);
    const title = vm ? head.title.replace(/\s*\(VM\)$/, '') : head.title;
    const host: NmapHost = {
      id: uniqueId(nodeId('host', ip || cell.id)),
      ip,
      hostnames: hostname ? [hostname] : [],
      status: 'up',
      os: [],
      ports: portLine ? portsFrom(portLine) : [],
      portsScanned: true,
      scripts: [],
      hops: [],
      ...(macLine ? { mac: macLine.split(/\s+/)[0].toUpperCase() } : {}),
      ...(macLine && macLine.includes('·') ? { vendor: macLine.split('·')[1]?.trim() } : {}),
    };
    if (portLine && /no port scan/i.test(portLine)) host.portsScanned = false;

    const node: DiagramNode = {
      id: host.id,
      kind: 'host',
      layerId: MAIN_LAYER,
      position: absolute,
      host,
      ...(title && title !== ip ? { label: title } : {}),
      ...(subtitleLine && !hostname ? { subtitle: subtitleLine } : {}),
      ...(vm ? { icon: 'vm' } : head.icon ? { icon: head.icon } : {}),
      ...(accentOf(cell, ['#c3ccd9', '#ffffff']) ? { accent: accentOf(cell, ['#c3ccd9', '#ffffff']) } : {}),
    };
    byCell.set(cell.id, { node, cell });
  }

  // Cards keep their coordinates relative to the section they sit in.
  for (const cell of cells.values()) {
    const built = byCell.get(cell.id);
    if (!built || built.node.kind === 'section') continue;
    let parent = cell.parent ? cells.get(cell.parent) : undefined;
    let guard = 0;
    while (parent && guard < 32 && !sections.has(parent.id)) {
      parent = parent.parent ? cells.get(parent.parent) : undefined;
      guard += 1;
    }
    const section = parent ? sections.get(parent.id) : undefined;
    if (!section) {
      nodes.push(built.node);
      continue;
    }
    const absolute = absoluteOf(cell, cells);
    const origin = absoluteOf(section.cell, cells);
    nodes.push({
      ...built.node,
      parentId: section.node.id,
      position: { x: absolute.x - origin.x, y: absolute.y - origin.y },
    });
  }

  // Unparented cards and the sections themselves, sections first so they paint behind.
  const placed = new Set(nodes.map((node) => node.id));
  for (const { node } of sections.values()) if (!placed.has(node.id)) nodes.push(node);
  const ordered = [...nodes.filter((node) => node.kind === 'section'), ...nodes.filter((node) => node.kind !== 'section')];

  // A rectangle drawn *around* shapes is their frame even when they are not its
  // children – that is how a hand-drawn draw.io diagram places a card on a subnet,
  // and how an export of ours writes one.
  const adopted = adoptIntoFrames(ordered);

  // A frame is never smaller than the cards inside it, whatever size draw.io drew.
  const sized = adopted.map((node) => {
    if (node.kind !== 'section') return node;
    const children = adopted.filter((child) => child.parentId === node.id);
    const min = sectionMinSize(children);
    const size = { w: Math.max(node.size?.w ?? 0, min.w), h: Math.max(node.size?.h ?? 0, min.h) };
    return { ...node, size };
  });

  const edges = readEdges(cells, byCell);

  return {
    ok: true,
    ignored,
    doc: {
      version: 2,
      fileName,
      layers,
      nodes: sized,
      edges,
      focusedLayerId: null,
    },
  };
}

/**
 * Cards drawn on top of a frame become its children, smallest frame first, so a
 * section collapses, moves and resizes with the cards it visually holds.
 */
function adoptIntoFrames(nodes: DiagramNode[]): DiagramNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const frames = nodes
    .filter((node) => node.kind === 'section' && !node.collapsed)
    .map((section) => {
      const size = measureSection(
        section,
        nodes.filter((child) => child.parentId === section.id),
      );
      const origin = absolutePosition(section, byId);
      return { id: section.id, origin, size, area: size.w * size.h };
    });
  if (frames.length === 0) return nodes;

  return nodes.map((node) => {
    if (node.kind === 'section' || node.parentId) return node;
    const size = nodeSize(node);
    const centre = { x: node.position.x + size.w / 2, y: node.position.y + size.h / 2 };
    const frame = frames
      .filter(
        (item) =>
          centre.x >= item.origin.x &&
          centre.x <= item.origin.x + item.size.w &&
          centre.y >= item.origin.y &&
          centre.y <= item.origin.y + item.size.h,
      )
      .sort((a, b) => a.area - b.area)[0];
    if (!frame) return node;
    return {
      ...node,
      parentId: frame.id,
      position: { x: node.position.x - frame.origin.x, y: node.position.y - frame.origin.y },
    };
  });
}

const SIDES: { side: EdgeSide; exit: [number, number]; entry: [number, number] }[] = [
  { side: 'l', exit: [0, 0.5], entry: [0, 0.5] },
  { side: 'r', exit: [1, 0.5], entry: [1, 0.5] },
  { side: 't', exit: [0.5, 0], entry: [0.5, 0] },
  { side: 'b', exit: [0.5, 1], entry: [0.5, 1] },
];

function sideOf(cell: Cell, kind: 'exit' | 'entry'): EdgeSide | undefined {
  const x = Number.parseFloat(cell.style.get(`${kind}X`) ?? '');
  const y = Number.parseFloat(cell.style.get(`${kind}Y`) ?? '');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const match = SIDES.find(({ exit, entry }) => {
    const [mx, my] = kind === 'exit' ? exit : entry;
    return Math.abs(x - mx) < 0.01 && Math.abs(y - my) < 0.01;
  });
  return match?.side;
}

function lineOf(cell: Cell): EdgeLine {
  const dashed = cell.style.get('dashed') === '1';
  if (!dashed) return 'solid';
  const pattern = cell.style.get('dashPattern') ?? '';
  const [on] = pattern.split(/\s+/).map((part) => Number.parseFloat(part));
  return Number.isFinite(on) && on <= 2 ? 'dotted' : 'dashed';
}

function pathOf(cell: Cell): EdgePath | undefined {
  const style = cell.style;
  if (style.get('curved') === '1') return 'curve';
  const edgeStyle = style.get('edgeStyle');
  if (edgeStyle === 'orthogonalEdgeStyle') return style.get('rounded') === '1' ? 'smoothstep' : 'step';
  if (edgeStyle === 'none' || style.has('edgeStyle')) return 'straight';
  return undefined;
}

function arrowOf(cell: Cell): EdgeArrow | undefined {
  const start = cell.style.get('startArrow') ?? 'none';
  const end = cell.style.get('endArrow') ?? 'classic';
  const source = start !== 'none' && start.length > 0;
  const target = end !== 'none' && end.length > 0;
  if (source && target) return 'both';
  if (source) return 'source';
  if (target) return 'target';
  return 'none';
}

function readEdges(cells: Map<string, Cell>, byCell: Map<string, Built>): DiagramEdge[] {
  const edges: DiagramEdge[] = [];
  const used = new Set<string>();
  for (const cell of cells.values()) {
    if (!cell.edge) continue;
    const source = cell.source ? byCell.get(cell.source) : undefined;
    const target = cell.target ? byCell.get(cell.target) : undefined;
    if (!source || !target || source.node.id === target.node.id) continue;

    const stroke = (cell.style.get('strokeColor') ?? '').toLowerCase();
    const dashed = cell.style.get('dashed') === '1';
    const kind: EdgeKind = stroke === '#8ba1b8' || (dashed && stroke !== '#22b98c') ? 'route' : 'link';
    const from = sideOf(cell, 'exit');
    const to = sideOf(cell, 'entry');
    const line = lineOf(cell);
    const path = pathOf(cell);
    const arrow = arrowOf(cell);

    const base = `${kind}:${source.node.id}-${target.node.id}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}#${suffix}`;
      suffix += 1;
    }
    used.add(id);

    edges.push({
      id,
      source: source.node.id,
      target: target.node.id,
      kind,
      ...(cell.value.trim() ? { label: drawioLabel(cell.value) } : {}),
      // Only what differs from the kind's default is written, so a route stays a
      // route and a link keeps pointing at its target.
      ...(line !== (kind === 'route' ? 'dashed' : 'solid') ? { line } : {}),
      ...(path ? { path } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(arrow ? { arrow } : {}),
    });
  }
  return edges;
}

/** Card sizes an importer can rely on, re-exported so callers need not know layout.ts. */
export const DRAWIO_CARD_SIZES = {
  host: { w: HOST_W, h: HOST_H },
  hop: { w: HOP_W, h: HOP_H },
  origin: { w: ORIGIN_W, h: ORIGIN_H },
  note: { w: NOTE_W, h: NOTE_H },
  sectionHeader: SECTION_HEADER,
  sectionPadding: SECTION_PAD,
};
