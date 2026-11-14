import {
  HOP_H,
  HOP_W,
  HOST_H,
  HOST_W,
  NOTE_H,
  NOTE_W,
  ORIGIN_H,
  ORIGIN_W,
} from '../graph/layout';
import { SECTION_HEADER, SECTION_MIN_H, SECTION_MIN_W, SECTION_PAD } from '../doc/measure';
import type { CodeItem, CodeModel, FlowDirection } from './dsl';

/**
 * Laying out a code-authored diagram. The nmap layout in graph/layout.ts follows a
 * traceroute; code follows the edges the author wrote, so it gets its own small
 * rank layout: each edge points at the next column, siblings stack in declaration
 * order, and a `subgraph` becomes a frame around its children.
 */

const MAIN_GAP = 72;
const CROSS_GAP = 28;

type Size = { w: number; h: number };
type Point = { x: number; y: number };
type RankResult = { pos: Map<string, Point>; w: number; h: number };

export type PlacedItem = {
  ref: string;
  parent: string | null;
  /** Absolute for a top-level item, relative to the parent section otherwise. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CodeLayout = {
  items: PlacedItem[];
  width: number;
  height: number;
};

function parseSize(value: string | undefined): Size | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)\s*[x,×]\s*(\d+(?:\.\d+)?)$/i.exec(value.trim());
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

function baseSize(item: CodeItem): Size {
  const explicit = parseSize(item.attrs.size);
  if (explicit) return explicit;
  switch (item.kind) {
    case 'note':
      return { w: NOTE_W, h: NOTE_H };
    case 'hop':
      return { w: HOP_W, h: HOP_H };
    case 'origin':
      return { w: ORIGIN_W, h: ORIGIN_H };
    case 'section':
      return { w: SECTION_MIN_W, h: SECTION_MIN_H };
    default:
      return { w: HOST_W, h: HOST_H };
  }
}

function directionOf(value: string | undefined, fallback: FlowDirection): FlowDirection {
  const upper = (value ?? '').toUpperCase();
  return upper === 'LR' || upper === 'RL' || upper === 'TB' || upper === 'BT'
    ? (upper as FlowDirection)
    : fallback;
}

/**
 * Longest-path ranks, then a grid. The relaxation is capped at the node count so a
 * cycle stops instead of spinning – the cap is what makes `a --> b --> a` legal.
 */
function arrange(
  keys: string[],
  sizes: Map<string, Size>,
  edges: { from: string; to: string }[],
  direction: FlowDirection,
): RankResult {
  const pos = new Map<string, Point>();
  if (keys.length === 0) return { pos, w: 0, h: 0 };

  const size = (key: string) => sizes.get(key) ?? { w: HOST_W, h: HOST_H };
  const rank = new Map<string, number>(keys.map((key) => [key, 0]));
  const known = edges.filter((edge) => rank.has(edge.from) && rank.has(edge.to) && edge.from !== edge.to);
  const limit = Math.min(keys.length, 64);
  for (let pass = 0; pass <= limit; pass += 1) {
    let changed = false;
    for (const edge of known) {
      const want = (rank.get(edge.from) ?? 0) + 1;
      if (want > (rank.get(edge.to) ?? 0) && want <= keys.length) {
        rank.set(edge.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const buckets = new Map<number, string[]>();
  for (const key of keys) {
    const value = rank.get(key) ?? 0;
    const bucket = buckets.get(value);
    if (bucket) bucket.push(key);
    else buckets.set(value, [key]);
  }
  const ordered = [...buckets.keys()].sort((a, b) => a - b);
  const horizontal = direction === 'LR' || direction === 'RL';

  let main = 0;
  for (const value of ordered) {
    const members = buckets.get(value) ?? [];
    const extent = (key: string) => (horizontal ? size(key).w : size(key).h);
    const crossExtent = (key: string) => (horizontal ? size(key).h : size(key).w);
    const mainSize = Math.max(...members.map(extent));
    const crossTotal = members.reduce((sum, key) => sum + crossExtent(key), 0) + CROSS_GAP * (members.length - 1);
    let cross = -crossTotal / 2;
    for (const key of members) {
      if (horizontal) {
        pos.set(key, { x: main + (mainSize - size(key).w) / 2, y: cross });
        cross += size(key).h + CROSS_GAP;
      } else {
        pos.set(key, { x: cross, y: main + (mainSize - size(key).h) / 2 });
        cross += size(key).w + CROSS_GAP;
      }
    }
    main += mainSize + MAIN_GAP;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of keys) {
    const point = pos.get(key)!;
    const itemSize = size(key);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x + itemSize.w);
    maxY = Math.max(maxY, point.y + itemSize.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  for (const key of keys) {
    const point = pos.get(key)!;
    pos.set(key, { x: point.x - minX, y: point.y - minY });
  }

  if (direction === 'RL') {
    for (const key of keys) {
      const point = pos.get(key)!;
      pos.set(key, { x: w - point.x - size(key).w, y: point.y });
    }
  } else if (direction === 'BT') {
    for (const key of keys) {
      const point = pos.get(key)!;
      pos.set(key, { x: point.x, y: h - point.y - size(key).h });
    }
  }

  return { pos, w, h };
}

export function layoutCode(model: CodeModel): CodeLayout {
  const byRef = new Map(model.items.map((item) => [item.ref, item]));
  const children = new Map<string | null, string[]>();
  for (const item of model.items) {
    const bucket = children.get(item.parent);
    if (bucket) bucket.push(item.ref);
    else children.set(item.parent, [item.ref]);
  }

  const sizes = new Map<string, Size>();
  for (const item of model.items) {
    if (item.kind !== 'section') sizes.set(item.ref, baseSize(item));
  }

  // Deepest section first: a parent frame has to be measured from finished children.
  const sectionOrder: string[] = [];
  const visit = (ref: string) => {
    for (const child of children.get(ref) ?? []) {
      if (byRef.get(child)?.kind === 'section') visit(child);
    }
    sectionOrder.push(ref);
  };
  for (const ref of children.get(null) ?? []) {
    if (byRef.get(ref)?.kind === 'section') visit(ref);
  }

  const placed = new Map<string, PlacedItem>();

  for (const sectionRef of sectionOrder) {
    const section = byRef.get(sectionRef);
    if (!section) continue;
    const keys = children.get(sectionRef) ?? [];
    const keySet = new Set(keys);
    const direction = directionOf(section.attrs.direction, model.direction);
    const edges = model.edges.filter((edge) => keySet.has(edge.from) && keySet.has(edge.to));
    const arranged = arrange(keys, sizes, edges, direction);

    let right = SECTION_PAD;
    let bottom = SECTION_HEADER + 12;
    for (const key of keys) {
      const itemSize = sizes.get(key) ?? baseSize(byRef.get(key)!);
      sizes.set(key, itemSize);
      const point = arranged.pos.get(key)!;
      const x = point.x + SECTION_PAD;
      const y = point.y + SECTION_HEADER + SECTION_PAD;
      placed.set(key, { ref: key, parent: sectionRef, x, y, w: itemSize.w, h: itemSize.h });
      right = Math.max(right, x + itemSize.w + SECTION_PAD);
      bottom = Math.max(bottom, y + itemSize.h + SECTION_PAD);
    }
    // A written `size:` is a floor, so a frame the author widened by hand keeps it.
    const declared = parseSize(section.attrs.size);
    sizes.set(sectionRef, {
      w: Math.max(right, declared?.w ?? 0, SECTION_MIN_W),
      h: Math.max(bottom, declared?.h ?? 0, SECTION_MIN_H),
    });
  }

  const topKeys = children.get(null) ?? [];
  const topSet = new Set(topKeys);
  const rootOf = (ref: string): string => {
    let current = byRef.get(ref);
    let guard = 0;
    while (current?.parent && guard < 32) {
      const parent = byRef.get(current.parent);
      if (!parent) break;
      current = parent;
      guard += 1;
    }
    return current?.ref ?? ref;
  };
  const topEdges = model.edges
    .map((edge) => ({ from: rootOf(edge.from), to: rootOf(edge.to) }))
    .filter((edge) => topSet.has(edge.from) && topSet.has(edge.to));
  const arranged = arrange(topKeys, sizes, topEdges, model.direction);

  for (const key of topKeys) {
    const itemSize = sizes.get(key) ?? baseSize(byRef.get(key)!);
    const point = arranged.pos.get(key)!;
    placed.set(key, { ref: key, parent: null, x: point.x, y: point.y, w: itemSize.w, h: itemSize.h });
  }

  const items = model.items.map((item) => placed.get(item.ref)).filter((item): item is PlacedItem => Boolean(item));
  return { items, width: arranged.w, height: arranged.h };
}

/** The box that contains every top-level item – used to centre a rebuilt layer. */
export function layoutBounds(layout: CodeLayout): { x: number; y: number; w: number; h: number } {
  const tops = layout.items.filter((item) => !item.parent);
  if (tops.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...tops.map((item) => item.x));
  const y = Math.min(...tops.map((item) => item.y));
  const right = Math.max(...tops.map((item) => item.x + item.w));
  const bottom = Math.max(...tops.map((item) => item.y + item.h));
  return { x, y, w: right - x, h: bottom - y };
}
