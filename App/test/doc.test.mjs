import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { createDocFromScan, emptyDoc, importScanAsLayer, mergeScanIntoDoc } from '../src/doc/docFromScan';
import {
  COLLAPSED_H,
  SECTION_MIN_H,
  SECTION_MIN_W,
  absolutePosition,
  measureSection,
  nodeSize,
  sectionAt,
} from '../src/doc/measure';
import {
  addLink,
  alignNodes,
  bringNodeZ,
  deleteLayer,
  duplicateNode,
  patchNode,
  removeNodes,
  setNodeSection,
} from '../src/doc/operations';
import { MAIN_LAYER, NOTES_LAYER, edgeArrow, edgeSides, nodeTitle } from '../src/doc/types';
import { buildDesignFile, readDesignFile } from '../src/doc/designFile';
import { HOST_H, HOST_W, NOTE_H, NOTE_W } from '../src/graph/layout';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

const sampleScan = () => parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME);

/** Two host cards the imports did not already connect, so a new link is really new. */
const unconnectedPair = (doc) => {
  const hosts = doc.nodes.filter((node) => node.kind === 'host');
  const taken = new Set(doc.edges.flatMap((edge) => [`${edge.source}|${edge.target}`, `${edge.target}|${edge.source}`]));
  for (const first of hosts) {
    for (const second of hosts) {
      if (first !== second && !taken.has(`${first.id}|${second.id}`)) return [first, second];
    }
  }
  throw new Error('every pair is already connected');
};

const discoveryXml = (args = 'nmap -sn -oX ping.xml 10.0.0.0/24') =>
  `<?xml version="1.0"?>
   <nmaprun scanner="nmap" args="${args}" version="7.95">
     <host><status state="up"/><address addr="10.0.0.7" addrtype="ipv4"/></host>
     <host><status state="up"/><address addr="10.0.0.8" addrtype="ipv4"/></host>
   </nmaprun>`;

test('a scan becomes a document with sections, cards and routes', () => {
  const doc = createDocFromScan(sampleScan());

  assert.equal(doc.version, 2);
  assert.equal(doc.fileName, SAMPLE_FILE_NAME);
  assert.deepEqual(doc.layers.map((layer) => layer.id), [MAIN_LAYER, NOTES_LAYER]);
  assert.equal(doc.focusedLayerId, null);

  const sections = doc.nodes.filter((node) => node.kind === 'section');
  assert.deepEqual(sections.map((node) => node.cidr).sort(), ['10.0.0.0/24', '10.10.20.0/24']);

  const hosts = doc.nodes.filter((node) => node.kind === 'host');
  assert.equal(hosts.length, 12);
  const sectionIds = new Set(sections.map((node) => node.id));
  for (const host of hosts) {
    assert.ok(sectionIds.has(host.parentId), `${host.host.ip} belongs to a subnet section`);
    assert.ok(host.icon, 'every card gets an icon');
    assert.ok(host.position.x >= 0 && host.position.y >= 0, 'child coordinates are section-relative');
  }

  assert.equal(doc.nodes.filter((node) => node.kind === 'origin').length, 1);
  assert.ok(doc.edges.length > 0);
  assert.ok(doc.edges.every((edge) => edge.kind === 'route'));
  const ids = new Set(doc.nodes.map((node) => node.id));
  for (const edge of doc.edges) {
    assert.ok(ids.has(edge.source) && ids.has(edge.target), `edge ${edge.id} has both ends`);
  }
});

test('a scanned host that other traces pass through keeps one card', () => {
  // 10.0.0.1 is both a probed host and the first hop of every other trace, and a
  // target's own trace entry names the card itself. Both must not add a second
  // card: the address is drawn once, and that card carries the route lane depth.
  const scan = parseNmapXml(
    `<?xml version="1.0"?>
     <nmaprun scanner="nmap" args="nmap -sV --traceroute -oX traced.xml 10.0.0.0/24" version="7.95">
       <host><status state="up"/><address addr="10.0.0.1" addrtype="ipv4"/>
         <trace><hop ttl="1" ipaddr="10.0.0.1"/></trace></host>
       <host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/>
         <trace><hop ttl="1" ipaddr="10.0.0.1"/><hop ttl="2" ipaddr="10.0.0.5"/></trace></host>
       <host><status state="up"/><address addr="10.0.0.9" addrtype="ipv4"/>
         <trace><hop ttl="1" ipaddr="10.0.0.1"/><hop ttl="2" ipaddr="10.0.0.254"/><hop ttl="3" ipaddr="10.0.0.9"/></trace></host>
     </nmaprun>`,
    'traced.xml',
  );
  const doc = createDocFromScan(scan);

  const drawn = doc.nodes.filter((node) => node.kind === 'host' || node.kind === 'hop');
  const addresses = drawn.map((node) => (node.kind === 'host' ? node.host.ip : node.address));
  assert.deepEqual(addresses.filter((ip, index) => addresses.indexOf(ip) !== index), [], 'no address is drawn twice');

  const gateway = drawn.find((node) => node.id === 'host:10.0.0.1');
  assert.equal(gateway.kind, 'host');
  assert.equal(gateway.depth, 1, 'the card is in the route lane');
  assert.equal(gateway.icon, 'router', 'a card the traces pass through wears a network icon');
  assert.ok(gateway.parentId, 'and still lives in its subnet frame');

  // 10.0.0.254 is only ever a hop, so it stays a router card of the route lane.
  assert.equal(drawn.find((node) => node.address === '10.0.0.254').kind, 'hop');

  const originEdge = doc.edges.find((edge) => edge.source === 'origin');
  assert.equal(originEdge.target, 'host:10.0.0.1', 'the route starts at the gateway card');
});

test('the same scan lays out identically every time', () => {
  assert.equal(JSON.stringify(createDocFromScan(sampleScan())), JSON.stringify(createDocFromScan(sampleScan())));
});

test('discovery-only scans never grow ports in the diagram', () => {
  const doc = createDocFromScan(parseNmapXml(discoveryXml()));

  const hosts = doc.nodes.filter((node) => node.kind === 'host');
  assert.equal(hosts.length, 2);
  for (const host of hosts) {
    assert.equal(host.host.portsScanned, false);
    assert.deepEqual(host.host.ports, []);
  }
  const origin = doc.nodes.find((node) => node.kind === 'origin');
  assert.match(origin.subtitle, /no port scan/);
});

test('a connection remembers the sides it was drawn between', () => {
  const doc = mergeScanIntoDoc(createDocFromScan(sampleScan()), sampleScan()).doc;
  const [a, b] = unconnectedPair(doc);

  const before = doc.edges.length;
  const linked = addLink(doc, a.id, b.id, { from: 't', to: 'b' });
  assert.equal(linked.edges.length, before + 1, 'the link is added');
  const edge = linked.edges.at(-1);
  assert.deepEqual({ from: edge.from, to: edge.to }, { from: 't', to: 'b' });
  assert.deepEqual(edgeSides(edge), { from: 't', to: 'b' });
  assert.equal(edgeArrow(edge), 'target', 'a link points at its target until told otherwise');

  // A line with no arrowhead at all is a choice too.
  assert.equal(edgeArrow({ ...edge, arrow: 'both' }), 'both');
  assert.equal(edgeArrow({ ...edge, arrow: 'none' }), 'none');

  // The shorthand survives without either side being set.
  const [c, d] = unconnectedPair(linked);
  const shorthand = addLink(linked, c.id, d.id);
  const plainEdge = shorthand.edges.at(-1);
  assert.notEqual(plainEdge.id, edge.id);
  assert.deepEqual(edgeSides(plainEdge), { from: 'r', to: 'l' });
});

test('the design reader keeps the sides and the arrowhead, and drops nonsense', () => {
  const doc = mergeScanIntoDoc(createDocFromScan(sampleScan()), sampleScan()).doc;
  const [a, b] = unconnectedPair(doc);
  const linked = addLink(doc, a.id, b.id, { from: 'l', to: 't' });
  const linkId = linked.edges.at(-1).id;
  assert.equal(linked.edges.at(-1).from, 'l', 'the link carries its sides before saving');
  const withArrow = {
    ...linked,
    edges: linked.edges.map((edge) => (edge.id === linkId ? { ...edge, arrow: 'none' } : edge)),
  };

  const result = readDesignFile(JSON.stringify(buildDesignFile(withArrow)));
  assert.equal(result.ok, true);
  const edge = result.doc.edges.find((item) => item.id === linkId);
  assert.deepEqual({ from: edge.from, to: edge.to, arrow: edge.arrow }, { from: 'l', to: 't', arrow: 'none' });

  // A saved file from another tool (or a typo) cannot invent a side.
  const broken = JSON.parse(JSON.stringify(buildDesignFile(withArrow)));
  const brokenEdge = broken.doc.edges.find((item) => item.id === linkId);
  brokenEdge.from = 'sideways';
  brokenEdge.arrow = 'wobble';
  const repaired = readDesignFile(JSON.stringify(broken));
  assert.equal(repaired.ok, true);
  const repairedEdge = repaired.doc.edges.find((item) => item.id === linkId);
  assert.equal(repairedEdge.from, undefined);
  assert.equal(repairedEdge.arrow, undefined);
  assert.equal(repairedEdge.to, 't', 'a valid side is kept');
});

test('sizes: fixed per kind, sections grow with their children', () => {
  assert.deepEqual(nodeSize({ kind: 'host', position: { x: 0, y: 0 } }), { w: HOST_W, h: HOST_H });
  assert.deepEqual(nodeSize({ kind: 'note', position: { x: 0, y: 0 } }), { w: NOTE_W, h: NOTE_H });
  assert.deepEqual(nodeSize({ kind: 'note', position: { x: 0, y: 0 }, size: { w: 300, h: 200 } }), {
    w: 300,
    h: 200,
  });

  const section = { id: 's', kind: 'section', position: { x: 0, y: 0 }, size: { w: 100, h: 100 } };
  assert.deepEqual(measureSection(section, []), { w: SECTION_MIN_W, h: SECTION_MIN_H });

  const far = { kind: 'host', position: { x: 900, y: 700 } };
  const grown = measureSection(section, [far]);
  assert.ok(grown.w > 900 && grown.h > 700, 'the section grows to enclose its children');

  assert.deepEqual(measureSection({ ...section, collapsed: true }, [far]), {
    w: SECTION_MIN_W,
    h: COLLAPSED_H,
  });
  assert.deepEqual(measureSection({ ...section, manualSize: true, size: { w: 500, h: 400 } }, [far]), {
    w: 500,
    h: 400,
  });
});

test('absolutePosition walks the parent chain; sectionAt finds the tightest box', () => {
  const doc = createDocFromScan(sampleScan());
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const host = doc.nodes.find((node) => node.kind === 'host');
  const section = byId.get(host.parentId);

  assert.deepEqual(absolutePosition(host, byId), {
    x: section.position.x + host.position.x,
    y: section.position.y + host.position.y,
  });

  const size = measureSection(section, doc.nodes.filter((node) => node.parentId === section.id));
  assert.equal(
    sectionAt(doc.nodes, { x: section.position.x + size.w / 2, y: section.position.y + size.h / 2 }),
    section.id,
  );
  assert.equal(sectionAt(doc.nodes, { x: -5000, y: -5000 }), null);
});

test('operations stay pure and repair the surrounding document', () => {
  const doc = createDocFromScan(sampleScan());
  const host = doc.nodes.find((node) => node.kind === 'host');
  const section = doc.nodes.find((node) => node.kind === 'section');

  const patched = patchNode(doc, host.id, { label: 'renamed' });
  assert.notEqual(patched, doc);
  assert.equal(doc.nodes.find((node) => node.id === host.id).label, undefined, 'source is untouched');
  assert.equal(patched.nodes.find((node) => node.id === host.id).label, 'renamed');

  // Removing a section adopts its children and drops the orphaned routes.
  const removed = removeNodes(doc, [section.id]);
  assert.equal(removed.nodes.some((node) => node.id === section.id), false);
  const adopted = removed.nodes.find((node) => node.id === host.id);
  assert.equal(adopted.parentId, null);
  assert.ok(adopted.position.x >= section.position.x, 'the child keeps its canvas position');
  const alive = new Set(removed.nodes.map((node) => node.id));
  assert.ok(removed.edges.every((edge) => alive.has(edge.source) && alive.has(edge.target)));

  const copy = duplicateNode(doc, host.id);
  assert.ok(copy && copy.newId !== host.id);
  assert.equal(copy.doc.nodes.filter((node) => node.kind === 'host').length, 13);
  assert.equal(copy.doc.nodes.find((node) => node.id === copy.newId).host, undefined, 'a copy is not a scan host');

  const linked = addLink(doc, host.id, section.id);
  assert.equal(linked.edges.length, doc.edges.length + 1);
  assert.equal(addLink(linked, section.id, host.id), linked, 'duplicate links are refused');
  assert.equal(addLink(doc, host.id, host.id), doc);
});

test('moving a card between sections converts its coordinates', () => {
  const doc = createDocFromScan(sampleScan());
  const sections = doc.nodes.filter((node) => node.kind === 'section');
  const source = doc.nodes.find((node) => node.kind === 'host' && node.parentId === sections[0].id);

  const moved = setNodeSection(doc, source.id, sections[1].id, 'append');
  const node = moved.nodes.find((item) => item.id === source.id);
  assert.equal(node.parentId, sections[1].id);
  assert.ok(node.position.x >= 24 && node.position.y >= 44, 'relative to the new section');

  const released = setNodeSection(moved, source.id, null);
  assert.equal(released.nodes.find((item) => item.id === source.id).parentId, null);

  assert.equal(setNodeSection(doc, source.id, sections[0].id), doc, 'same parent is a no-op');
});

test('layer deletion re-homes or removes the cards on it', () => {
  const doc = createDocFromScan(sampleScan());

  // 'keep' moves the cards to a surviving layer; nothing is lost.
  const kept = deleteLayer(doc, MAIN_LAYER, 'keep');
  assert.equal(kept.layers.length, doc.layers.length - 1);
  assert.equal(kept.nodes.length, doc.nodes.length);
  const alive = new Set(kept.layers.map((layer) => layer.id));
  assert.ok(kept.nodes.every((node) => alive.has(node.layerId)), 'no card points at a deleted layer');
  assert.ok(kept.nodes.every((node) => node.layerId !== MAIN_LAYER));

  // 'all' removes the cards and every edge that touched them.
  const removed = deleteLayer(doc, MAIN_LAYER, 'all');
  assert.equal(removed.layers.length, doc.layers.length - 1);
  assert.equal(removed.nodes.length, 0);
  assert.equal(removed.edges.length, 0);

  // The last layer never disappears.
  const single = { ...doc, layers: [doc.layers[0]], nodes: [], edges: [] };
  assert.equal(deleteLayer(single, MAIN_LAYER, 'all'), single);
});

test('stacking and alignment only touch the nodes they are given', () => {
  const doc = createDocFromScan(sampleScan());
  const [a, b] = doc.nodes.filter((node) => node.kind === 'host');

  const front = bringNodeZ(doc, a.id, 'front');
  const zA = front.nodes.find((node) => node.id === a.id).z;
  assert.ok(zA > (front.nodes.find((node) => node.id === b.id).z ?? 0));

  const aligned = alignNodes(doc, [a.id, b.id], 'left');
  const lefts = [a, b].map((node) => absolutePosition(
    aligned.nodes.find((item) => item.id === node.id),
    new Map(aligned.nodes.map((item) => [item.id, item])),
  ).x);
  assert.equal(lefts[0], lefts[1]);
});

test('an empty document is still a valid document', () => {
  const doc = emptyDoc();
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.nodes, []);
  assert.deepEqual(doc.edges, []);
  assert.equal(doc.focusedLayerId, null);
  assert.equal(nodeTitle({ kind: 'note', layerId: NOTES_LAYER, position: { x: 0, y: 0 } }), 'Note');
});

test('a second scan can land in a new layer or merge into the current one', () => {
  const base = createDocFromScan(sampleScan());
  const scan = parseNmapXml(discoveryXml());

  const layered = importScanAsLayer(base, scan);
  assert.equal(layered.added, 4, 'origin + section + two hosts');
  assert.equal(layered.doc.layers.length, 3);
  const added = layered.doc.nodes.filter((node) => node.layerId === layered.layerId);
  assert.equal(added.length, layered.added);
  assert.ok(added.every((node) => node.layerId !== MAIN_LAYER));
  assert.ok(added.some((node) => node.kind === 'origin'));

  // A re-scan of the same subnets adds cards but keeps every existing node id.
  const merged = mergeScanIntoDoc(base, sampleScan());
  assert.equal(merged.added, 0);
  assert.equal(merged.gone, 0);
  assert.equal(merged.doc.nodes.length, base.nodes.length);
});
