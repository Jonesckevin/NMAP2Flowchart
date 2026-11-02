import type { DiagramNode } from './types';
import { HOP_H, HOP_W, HOST_H, HOST_W, NOTE_H, NOTE_W, ORIGIN_H, ORIGIN_W } from '../graph/layout';

export const SECTION_PAD = 24;
export const SECTION_HEADER = 44;
export const SECTION_MIN_W = 300;
export const SECTION_MIN_H = 150;
export const COLLAPSED_H = 52;

export type Size = { w: number; h: number };

export function nodeSize(node: DiagramNode): Size {
  switch (node.kind) {
    case 'section':
      return { w: node.size?.w ?? 360, h: node.size?.h ?? 240 };
    case 'note':
      return { w: node.size?.w ?? NOTE_W, h: node.size?.h ?? NOTE_H };
    case 'hop':
      return { w: HOP_W, h: HOP_H };
    case 'origin':
      return { w: ORIGIN_W, h: ORIGIN_H };
    default:
      return { w: HOST_W, h: HOST_H };
  }
}

export function sectionMinSize(children: DiagramNode[]): Size {
  let right = SECTION_PAD;
  let bottom = SECTION_HEADER + 12;
  for (const child of children) {
    const size = nodeSize(child);
    right = Math.max(right, child.position.x + size.w + SECTION_PAD);
    bottom = Math.max(bottom, child.position.y + size.h + SECTION_PAD);
  }
  return {
    w: Math.max(right, SECTION_MIN_W),
    h: Math.max(bottom, SECTION_MIN_H),
  };
}

export function measureSection(section: DiagramNode, children: DiagramNode[]): Size {
  if (section.collapsed) {
    return { w: Math.max(section.size?.w ?? 0, SECTION_MIN_W), h: COLLAPSED_H };
  }
  if (section.manualSize && section.size) {
    return { w: Math.max(section.size.w, 160), h: Math.max(section.size.h, 96) };
  }
  const min = sectionMinSize(children);
  return {
    w: Math.max(section.size?.w ?? 0, min.w),
    h: Math.max(section.size?.h ?? 0, min.h),
  };
}

export function slotInSection(
  section: DiagramNode,
  siblings: DiagramNode[],
  size: Size = { w: HOST_W, h: HOST_H },
): { x: number; y: number } {
  const gap = 14;
  const startY = SECTION_HEADER + SECTION_PAD;
  const frame = measureSection(section, siblings);
  const rightEdge = frame.w - SECTION_PAD;

  const xs = [...new Set([SECTION_PAD, ...siblings.map((child) => child.position.x)])].sort((a, b) => a - b);
  const ys = [...new Set([startY, ...siblings.map((child) => child.position.y)])].sort((a, b) => a - b);
  while (xs[xs.length - 1] + size.w < rightEdge) xs.push(xs[xs.length - 1] + size.w + gap);
  ys.push(ys[ys.length - 1] + size.h + gap);

  const boxes = siblings.map((child) => {
    const childSize = nodeSize(child);
    return {
      left: child.position.x,
      top: child.position.y,
      right: child.position.x + childSize.w,
      bottom: child.position.y + childSize.h,
    };
  });

  for (const y of ys) {
    for (const x of xs) {
      if (x + size.w > rightEdge) break;
      const free = boxes.every(
        (box) =>
          x + size.w + gap <= box.left ||
          box.right + gap <= x ||
          y + size.h + gap <= box.top ||
          box.bottom + gap <= y,
      );
      if (free) return { x, y };
    }
  }
  return { x: SECTION_PAD, y: startY };
}

export function absolutePosition(node: DiagramNode, byId: Map<string, DiagramNode>): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  let guard = 0;
  while (parent && guard < 16) {
    x += parent.position.x;
    y += parent.position.y;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    guard += 1;
  }
  return { x, y };
}

export function sectionAt(
  nodes: DiagramNode[],
  point: { x: number; y: number },
  options: { skip?: string } = {},
): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let best: { id: string; area: number } | null = null;
  for (const node of nodes) {
    if (node.kind !== 'section' || node.id === options.skip) continue;
    const children = nodes.filter((child) => child.parentId === node.id);
    const size = measureSection(node, children);
    const origin = absolutePosition(node, byId);
    const inside =
      point.x >= origin.x && point.x <= origin.x + size.w && point.y >= origin.y && point.y <= origin.y + size.h;
    if (!inside) continue;
    const area = size.w * size.h;
    if (!best || area < best.area) best = { id: node.id, area };
  }
  return best?.id ?? null;
}
