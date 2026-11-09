import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DESIGN_EXTENSION,
  DESIGN_FORMAT,
  buildDesignFile,
  designCounts,
  looksLikeJson,
  readDesignFile,
} from '../src/doc/designFile';
import { createDocFromScan } from '../src/doc/docFromScan';
import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { MAIN_LAYER } from '../src/doc/types';
import { defaultRiskPolicy } from '../src/doc/risk';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

const sampleDoc = () => createDocFromScan(parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME));

test('a design file carries the whole document and only inherited risk levels', () => {
  const doc = sampleDoc();
  const plain = buildDesignFile(doc);
  assert.equal(plain.format, DESIGN_FORMAT);
  assert.equal(plain.doc, doc);
  assert.equal(plain.risk, undefined, 'the built-in default needs no snapshot');
  assert.equal(DESIGN_EXTENSION, '.nmap2flowchart.json');

  const policy = defaultRiskPolicy();
  assert.equal(buildDesignFile(doc, { policy, scope: 'default' }).risk, undefined);
  assert.equal(buildDesignFile(doc, { policy, scope: 'diagram' }).risk, undefined);
  assert.deepEqual(buildDesignFile(doc, { policy, scope: 'account' }).risk, {
    policy,
    scope: 'account',
  });
});

test('reading accepts a design file, a legacy workspace and a bare document', () => {
  const doc = sampleDoc();

  const design = readDesignFile(JSON.stringify(buildDesignFile(doc)));
  assert.equal(design.ok, true);
  assert.equal(design.doc.nodes.length, doc.nodes.length);
  assert.deepEqual(design.repair, { layers: 0, nodes: 0, edges: 0 });

  const workspace = readDesignFile(JSON.stringify({ version: 2, doc }));
  assert.equal(workspace.ok, true);
  assert.equal(workspace.doc.fileName, SAMPLE_FILE_NAME);

  // The autosave envelope carries its own storeVersion; adding it must not confuse
  // the reader, and an older envelope without it must still open.
  const envelope = readDesignFile(JSON.stringify({ storeVersion: 3, version: 2, doc }));
  assert.equal(envelope.ok, true);
  assert.equal(envelope.doc.nodes.length, doc.nodes.length);
  assert.deepEqual(envelope.repair, { layers: 0, nodes: 0, edges: 0 });

  const bare = readDesignFile(JSON.stringify(doc));
  assert.equal(bare.ok, true);
  assert.equal(bare.doc.edges.length, doc.edges.length);

  assert.equal(readDesignFile('{"hello":true}').ok, false);
  assert.equal(readDesignFile('not json').ok, false);
  assert.equal(readDesignFile('{"format":"nmap2flowchart-design","formatVersion":99,"doc":{}}').ok, false);
});

test('broken documents are repaired instead of rejected', () => {
  const doc = sampleDoc();
  const host = doc.nodes.find((node) => node.kind === 'host');
  const section = doc.nodes.find((node) => node.kind === 'section');

  const broken = JSON.parse(JSON.stringify(doc));
  broken.nodes.push({ ...broken.nodes[0] });                                  // duplicate id
  broken.nodes.push({ ...host, id: 'host:orphan', layerId: 'layer:gone' });   // deleted layer
  broken.nodes.push({ ...host, id: 'host:orphan', layerId: MAIN_LAYER });     // duplicate again
  broken.nodes.push({ id: 'host:no-host', kind: 'host', layerId: MAIN_LAYER, position: { x: 0, y: 0 } });
  broken.nodes = broken.nodes.filter((node) => node.id !== 'broken:section');
  broken.nodes.push({ id: 'child:orphan', kind: 'note', parentId: 'missing:section', layerId: MAIN_LAYER, position: { x: 1, y: 1 } });
  broken.edges.push({ id: 'edge:dangling', source: section.id, target: 'missing:node', kind: 'link' });

  const read = readDesignFile(JSON.stringify({ version: 2, doc: broken }));
  assert.equal(read.ok, true);

  assert.ok(read.repair.nodes >= 3, 'duplicates and host-less cards are dropped');
  assert.ok(read.repair.edges >= 1, 'the dangling edge is dropped');

  const ids = read.doc.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'ids stay unique');
  assert.equal(read.doc.nodes.find((node) => node.id === 'host:orphan').layerId, read.doc.layers[0].id);
  assert.equal(read.doc.nodes.find((node) => node.id === 'child:orphan').parentId, null);
  assert.equal(read.doc.edges.some((edge) => edge.id === 'edge:dangling'), false);

  // Everything that survived still points at something real.
  const nodeIds = new Set(ids);
  assert.ok(read.doc.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
});

test('the risk snapshot survives a round trip', () => {
  const doc = sampleDoc();
  const policy = defaultRiskPolicy();
  policy.levels[0].label = 'Severe';
  const file = buildDesignFile(doc, { policy, scope: 'server' });
  const read = readDesignFile(JSON.stringify(file));

  assert.equal(read.ok, true);
  assert.deepEqual(read.design.risk, { policy, scope: 'server' });
  assert.equal(read.doc.risk, null, 'a snapshot is not merged into the document');
});

test('json detection prefers content over file names', () => {
  assert.equal(looksLikeJson('  \n {"version":2}'), true);
  assert.equal(looksLikeJson('\uFEFF[]'), true);
  assert.equal(looksLikeJson('<?xml version="1.0"?><nmaprun/>'), false);
});

test('design counts match the dialog preview', () => {
  const counts = designCounts(sampleDoc());
  assert.equal(counts.hosts, 12);
  assert.equal(counts.sections, 2);
  assert.equal(counts.layers, 2);
  assert.ok(counts.openPorts > 0);
});
