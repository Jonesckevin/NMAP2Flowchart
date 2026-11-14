import type { DiagramDoc, DiagramNode } from '../doc/types';
import { absolutePosition, nodeSize } from '../doc/measure';

export type Guide = {
  axis: 'x' | 'y';
  /** Flow coordinate of the line. */
  at: number;
  /** Where the line starts and ends, so it spans the cards it relates. */
  from: number;
  to: number;
};

type Hit = { at: number; diff: number };

const edges = (start: number, size: number) => [start, start + size / 2, start + size];

/**
 * The lines a dragged card shares with its neighbours: left/centre/right and
 * top/middle/bottom. Only the closest match per axis is returned – two lines are a
 * hint, ten of them are noise.
 *
 * `position` is the card's position while dragging (relative to its section, as
 * React Flow reports it), `threshold` is in flow units.
 */
export function alignmentGuides(
  doc: DiagramDoc,
  node: DiagramNode,
  position: { x: number; y: number },
  threshold = 5,
): Guide[] {
  const byId = new Map(doc.nodes.map((item) => [item.id, item]));
  const self = absolutePosition({ ...node, position }, byId);
  const selfSize = nodeSize(node);

  const others = doc.nodes
    .filter((item) => item.id !== node.id)
    .map((item) => ({ node: item, at: absolutePosition(item, byId), size: nodeSize(item) }));

  const nearest = (selfLines: number[], pick: (other: (typeof others)[number]) => number[]): Hit | null => {
    let best: Hit | null = null;
    for (const other of others) {
      for (const line of pick(other)) {
        for (const own of selfLines) {
          const diff = Math.abs(own - line);
          if (diff > threshold) continue;
          if (!best || diff < best.diff) best = { at: line, diff };
        }
      }
    }
    return best;
  };

  const span = (hit: Hit, axis: 'x' | 'y') => {
    let from = axis === 'x' ? self.y : self.x;
    let to = axis === 'x' ? self.y + selfSize.h : self.x + selfSize.w;
    for (const other of others) {
      const lines = axis === 'x' ? edges(other.at.x, other.size.w) : edges(other.at.y, other.size.h);
      if (!lines.some((line) => Math.abs(line - hit.at) < 0.5)) continue;
      if (axis === 'x') {
        from = Math.min(from, other.at.y);
        to = Math.max(to, other.at.y + other.size.h);
      } else {
        from = Math.min(from, other.at.x);
        to = Math.max(to, other.at.x + other.size.w);
      }
    }
    return { from, to };
  };

  const guides: Guide[] = [];
  const vertical = nearest(edges(self.x, selfSize.w), (other) => edges(other.at.x, other.size.w));
  if (vertical) guides.push({ axis: 'x', at: vertical.at, ...span(vertical, 'x') });
  const horizontal = nearest(edges(self.y, selfSize.h), (other) => edges(other.at.y, other.size.h));
  if (horizontal) guides.push({ axis: 'y', at: horizontal.at, ...span(horizontal, 'y') });
  return guides;
}
