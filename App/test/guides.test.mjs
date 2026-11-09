import assert from 'node:assert/strict';
import test from 'node:test';

import { alignmentGuides } from '../src/graph/guides';
import { HOST_H, HOST_W } from '../src/graph/layout';

const host = (id, x, y, extra = {}) => ({
  id,
  kind: 'host',
  layerId: 'layer:main',
  position: { x, y },
  host: {
    id: `h-${id}`,
    ip: '10.0.0.1',
    hostnames: [],
    status: 'up',
    os: [],
    ports: [],
    portsScanned: true,
    scripts: [],
    hops: [],
  },
  ...extra,
});

const doc = (...nodes) => ({
  version: 2,
  fileName: 'guides.xml',
  layers: [{ id: 'layer:main', name: 'Main', color: '#888', visible: true }],
  nodes,
  edges: [],
});

test('a guide appears when a dragged card lines up with a neighbour', () => {
  const dragged = host('a', 0, 0);
  const below = host('b', 0, HOST_H + 40);

  const guides = alignmentGuides(doc(dragged, below), dragged, { x: 0, y: 0 }, 5);
  const vertical = guides.find((guide) => guide.axis === 'x');
  assert.ok(vertical, 'a shared left edge produces a vertical guide');
  assert.equal(vertical.at, 0);
  assert.equal(vertical.from, 0);
  assert.equal(vertical.to, HOST_H * 2 + 40, 'the line spans both cards');
  assert.equal(guides.some((guide) => guide.axis === 'y'), false, 'nothing lines up horizontally');
});

test('a guide is a hint, not a snap: nothing shows past the threshold', () => {
  const dragged = host('a', 0, 0);
  const near = host('b', 3, 400);
  const far = host('c', 40, 400);

  assert.ok(alignmentGuides(doc(dragged, near), dragged, { x: 0, y: 0 }, 5).length > 0);
  assert.equal(alignmentGuides(doc(dragged, far), dragged, { x: 0, y: 0 }, 5).length, 0);
});

test('the exact match wins over a near one', () => {
  const dragged = host('a', 100, 0);
  const offLeft = host('b', 103, 300);
  const onCentre = host('c', 100 + HOST_W / 2, 600);

  const vertical = alignmentGuides(doc(dragged, offLeft, onCentre), dragged, { x: 100, y: 0 }, 5).find(
    (guide) => guide.axis === 'x',
  );
  assert.ok(vertical);
  assert.equal(vertical.at, 100 + HOST_W / 2, 'the centre match beats the 3 px left-edge match');
});

test('cards inside a section align in absolute coordinates', () => {
  const section = {
    id: 'section-1',
    kind: 'section',
    layerId: 'layer:main',
    position: { x: 500, y: 500 },
    size: { w: 400, h: 300 },
  };
  // A child's position is relative to its section; the outside card is not.
  const child = host('child', 24, 60, { parentId: 'section-1' });
  const outside = host('outside', 524, 40);

  const vertical = alignmentGuides(doc(section, child, outside), child, { x: 24, y: 60 }, 5).find(
    (guide) => guide.axis === 'x',
  );
  assert.ok(vertical);
  assert.ok(Math.abs(vertical.at - 524) < 0.5, 'the shared edge is compared in absolute space');
});
