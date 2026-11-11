import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { drawioLabel, looksLikeDrawio, readDrawioFile } from '../src/doc/drawioFile';
import { addLink } from '../src/doc/operations';
import { createDocFromScan } from '../src/doc/docFromScan';
import { defaultRiskPolicy } from '../src/doc/risk';
import { edgeArrow, edgeLine, edgePath, edgeSides } from '../src/doc/types';
import { toDrawio } from '../src/export/drawio';
import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

/**
 * draw.io is the one format that travels both ways: an exported diagram has to come
 * back as the diagram it was, and a hand-drawn one has to become cards rather than
 * a pile of notes. Both are read from the same cells, so both are pinned here.
 */

const PAGE = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="2026-11-10T00:00:00.000Z" agent="test" version="24.7.8" type="device">
  <diagram id="page-1" name="Page-1">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${body}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

const sampleScan = () => parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME);

test('only draw.io XML is taken for a draw.io file', async () => {
  assert.equal(looksLikeDrawio(PAGE('')), true);
  assert.equal(looksLikeDrawio('<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'), true);
  assert.equal(looksLikeDrawio(SAMPLE_SCAN_XML), false, 'an nmap scan is not a draw.io file');

  const rejected = await readDrawioFile(SAMPLE_SCAN_XML, 'lab-scan.xml');
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /draw\.io/);
});

test('a draw.io label loses its markup but keeps its lines', () => {
  assert.equal(
    drawioLabel('<b>🖥️ 10.0.0.5</b><br><font color="#5a6a7d">ws.lab.internal</font>'),
    '🖥️ 10.0.0.5\nws.lab.internal',
  );
  assert.equal(drawioLabel('a &amp; b'), 'a & b');
  assert.equal(drawioLabel(''), '');
});

test('a diagram exported to draw.io comes back as the same diagram', async () => {
  const doc = createDocFromScan(sampleScan());
  const hosts = doc.nodes.filter((node) => node.kind === 'host');
  // Two cards the import did not already connect, so the link below is really new.
  const taken = new Set(doc.edges.flatMap((edge) => [edge.source, edge.target]));
  const pair = hosts
    .flatMap((first) => hosts.map((second) => [first, second]))
    .find(([first, second]) => first !== second && !doc.edges.some((edge) =>
      (edge.source === first.id && edge.target === second.id) || (edge.source === second.id && edge.target === first.id)));
  assert.ok(pair && taken.size > 0);
  const linked = addLink(doc, pair[0].id, pair[1].id, { from: 't', to: 'b' });
  assert.equal(linked.edges.length, doc.edges.length + 1, 'the hand-drawn link is part of the diagram');

  const file = toDrawio(linked, defaultRiskPolicy());
  const read = await readDrawioFile(file, 'lab-scan.drawio');
  assert.equal(read.ok, true, read.ok ? '' : read.reason);
  const back = read.doc;

  assert.deepEqual(
    back.nodes.filter((node) => node.kind === 'host').map((node) => node.host.ip).sort(),
    hosts.map((node) => node.host.ip).sort(),
    'every host card is back',
  );
  assert.deepEqual(
    back.nodes.filter((node) => node.kind === 'section').map((node) => node.cidr).sort(),
    doc.nodes.filter((node) => node.kind === 'section').map((node) => node.cidr).sort(),
    'every section is back, with its subnet',
  );
  assert.equal(
    back.nodes.filter((node) => node.kind === 'hop').length,
    doc.nodes.filter((node) => node.kind === 'hop').length,
    'the trace hops are back',
  );
  assert.equal(back.nodes.filter((node) => node.kind === 'origin').length, 1, 'the scan origin is back');
  const origin = back.nodes.find((node) => node.kind === 'origin');
  assert.match(origin.address ?? '', /nmap/, 'the command line under the origin title is kept');

  // A frame drawn around the cards is their section, even though the export writes
  // them as plain shapes: without this a collapse or a drag would leave them behind.
  for (const section of back.nodes.filter((node) => node.kind === 'section')) {
    const inside = back.nodes.filter((node) => node.parentId === section.id).length;
    const expected = doc.nodes.filter((node) => node.parentId === section.id).length;
    assert.equal(inside, expected, `${section.cidr} holds the cards it was drawn around`);
  }

  const gw = back.nodes.find((node) => node.host?.ip === '10.0.0.1');
  assert.ok(gw, 'the gateway is one of them');
  assert.deepEqual(
    gw.host.ports.map((port) => port.port).sort((a, b) => a - b),
    [22, 53, 80, 443].filter((port) => doc.nodes.some((node) => node.host?.ports.some((item) => item.port === port))),
    'the open ports survive the round trip',
  );
  assert.deepEqual(gw.host.hostnames, ['gw.lab.internal'], 'the subtitle line comes back as the hostname');

  assert.equal(back.edges.length, linked.edges.length, 'every connection is back');
  const routes = back.edges.filter((edge) => edge.kind === 'route');
  const links = back.edges.filter((edge) => edge.kind === 'link');
  assert.equal(routes.length, linked.edges.filter((edge) => edge.kind === 'route').length, 'routes stay routes');
  assert.equal(links.length, 1, 'the hand-drawn link is still a link');
  assert.equal(edgeArrow(links[0]), 'target', 'a link points at its target again');
  assert.deepEqual(edgeSides(links[0]), { from: 't', to: 'b' }, 'the sides a link was drawn between survive');
  assert.ok(routes.every((edge) => edgeArrow(edge) === 'none'), 'a route carries no arrowhead');
  assert.equal(edgeLine(routes[0]), 'dashed');
  assert.equal(edgePath(routes[0]), 'smoothstep');
  assert.equal(edgeArrow(links[0]), 'target', 'a link points at its target again');
  assert.deepEqual(edgeSides(links[0]), { from: 't', to: 'b' }, 'the sides a link was drawn between survive');
});

test('a hand-drawn draw.io diagram becomes cards, a section, a note and a connection', async () => {
  const read = await readDrawioFile(
    PAGE(`
        <mxCell id="lan" value="&lt;b&gt;10.10.0.0/24&lt;/b&gt;" style="rounded=0;verticalAlign=top;align=left;fillColor=#f6f8fb;strokeColor=#b6c1d1;" vertex="1" parent="1">
          <mxGeometry x="40" y="120" width="520" height="320" as="geometry"/>
        </mxCell>
        <mxCell id="fw" value="&lt;b&gt;🧱 fw.lab.internal&lt;/b&gt;&lt;br&gt;192.168.0.1" style="rounded=1;fillColor=#ffffff;strokeColor=#c3ccd9;" vertex="1" parent="1">
          <mxGeometry x="40" y="20" width="200" height="70" as="geometry"/>
        </mxCell>
        <mxCell id="pc" value="&lt;b&gt;🖥️ workstation&lt;/b&gt;&lt;br&gt;10.10.0.5&lt;br&gt;445/microsoft-ds, 3389/ms-wbt-server&lt;br&gt;3C:52:82:1B:77:91 · Dell" style="rounded=1;fillColor=#ffffff;strokeColor=#c3ccd9;" vertex="1" parent="lan">
          <mxGeometry x="24" y="60" width="200" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="note" value="Check the uplink before the audit" style="rounded=1;fillColor=#fffbe6;strokeColor=#e6d9a2;" vertex="1" parent="1">
          <mxGeometry x="600" y="140" width="220" height="120" as="geometry"/>
        </mxCell>
        <mxCell id="wire" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#8ba1b8;dashed=1;dashPattern=9 5;exitX=0.5;exitY=1;entryX=0.5;entryY=0;startArrow=none;endArrow=block;" edge="1" parent="1" source="fw" target="pc">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`),
    'drawn.drawio',
  );

  assert.equal(read.ok, true, read.ok ? '' : read.reason);
  const { doc } = read;
  assert.equal(doc.fileName, 'drawn.drawio');
  assert.equal(doc.layers[0].name, 'drawn', 'the layer is named after the file');

  const section = doc.nodes.find((node) => node.kind === 'section');
  assert.equal(section.cidr, '10.10.0.0/24');
  assert.deepEqual(section.position, { x: 40, y: 120 });

  const pc = doc.nodes.find((node) => node.host?.ip === '10.10.0.5');
  assert.ok(pc, 'the workstation came through');
  assert.equal(pc.parentId, section.id, 'a shape drawn inside a frame joins that section');
  assert.deepEqual(pc.position, { x: 24, y: 60 }, 'its position is relative to the frame');
  assert.deepEqual(pc.host.ports.map((port) => `${port.port}/${port.service}`), ['445/microsoft-ds', '3389/ms-wbt-server']);
  assert.equal(pc.host.mac, '3C:52:82:1B:77:91');
  assert.equal(pc.host.vendor, 'Dell');
  assert.equal(pc.label, 'workstation', 'the name above the address is the card title');
  assert.equal(pc.icon, 'desktop', 'the emblem in the label picks the icon');

  const firewall = doc.nodes.find((node) => node.host?.ip === '192.168.0.1');
  assert.equal(firewall.host.hostnames[0], 'fw.lab.internal');
  assert.equal(firewall.icon, 'firewall', 'the brick emblem picks the firewall icon');
  assert.equal(firewall.parentId, undefined, 'a card outside the frame stays free');

  const note = doc.nodes.find((node) => node.kind === 'note');
  assert.equal(note.notes, 'Check the uplink before the audit');
  assert.equal(note.layerId, 'layer:notes', 'notes land on the notes layer');

  assert.equal(doc.edges.length, 1);
  const [edge] = doc.edges;
  assert.equal(edge.kind, 'route', 'a dashed grey line is a route');
  assert.deepEqual({ from: edge.from, to: edge.to }, { from: 'b', to: 't' });
  assert.equal(edge.path, 'smoothstep');
  assert.equal(edge.arrow, 'target');
  assert.equal(edge.source, firewall.id);
  assert.equal(edge.target, pc.id);
});

test('a compressed draw.io page is unpacked', async () => {
  const inner =
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="h" value="10.0.0.9" style="rounded=1;strokeColor=#c3ccd9;" vertex="1" parent="1">' +
    '<mxGeometry x="10" y="20" width="200" height="80" as="geometry"/></mxCell></root></mxGraphModel>';
  const encoded = deflateRawSync(Buffer.from(encodeURIComponent(inner), 'utf8')).toString('base64');
  const file = `<mxfile host="app.diagrams.net"><diagram id="p1" name="Page-1">${encoded}</diagram></mxfile>`;

  const read = await readDrawioFile(file, 'compressed.drawio');
  assert.equal(read.ok, true, read.ok ? '' : read.reason);
  const host = read.doc.nodes.find((node) => node.host?.ip === '10.0.0.9');
  assert.ok(host, 'the host inside the compressed page is read');
});

test('a first page with nothing on it does not stop a second page being read', async () => {
  const file = `<?xml version="1.0"?>
<mxfile host="app.diagrams.net">
  <diagram id="empty" name="Empty"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram>
  <diagram id="full" name="Full"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="h" value="10.0.0.7" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="80" as="geometry"/></mxCell>
  </root></mxGraphModel></diagram>
</mxfile>`;

  const read = await readDrawioFile(file, 'two-pages.drawio');
  assert.equal(read.ok, true, read.ok ? '' : read.reason);
  assert.deepEqual(read.doc.nodes.filter((node) => node.host).map((node) => node.host.ip), ['10.0.0.7']);
});
