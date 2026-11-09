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
import { MAIN_LAYER, NOTES_LAYER, nodeTitle } from '../src/doc/types';
import { HOST_H, HOST_W, NOTE_H, NOTE_W } from '../src/graph/layout';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

const sampleScan = () => parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME);

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
