import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import { toDrawio } from '../src/export/drawio';
import { toMermaid } from '../src/export/mermaid';
import { toSvg } from '../src/export/svg';
import { toRiskCsv } from '../src/export/riskReport';
import { createDocFromScan } from '../src/doc/docFromScan';
import { addLink } from '../src/doc/operations';
import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { defaultRiskPolicy, riskSummary } from '../src/doc/risk';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';
import { fixture, updateGoldens } from './helpers.mjs';

/**
 * The exporters are the part of the app with no browser to fall back on: the
 * canvas can be checked by eye, an exported file cannot. These snapshots pin the
 * geometry, ordering and styling so a refactor cannot silently reshape a
 * customer's diagram. `N2F_GOLDEN=1 npm run test:doc` rewrites them on purpose.
 */
const doc = createDocFromScan(parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME));
const policy = defaultRiskPolicy();

async function golden(name, actual) {
  const file = fixture(name);
  if (updateGoldens) {
    await writeFile(file, actual, 'utf8');
    return;
  }
  const expected = await readFile(file, 'utf8');
  assert.equal(
    actual,
    expected,
    `${name} changed. If that was intended, regenerate with N2F_GOLDEN=1 npm run test:doc`,
  );
}

const svg = toSvg(doc, policy);
const drawio = toDrawio(doc, policy);
const mermaid = toMermaid(doc, policy);

test('svg export is stable', async () => {
  assert.ok(svg.width > 0 && svg.height > 0);
  assert.match(svg.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/);
  assert.ok(svg.svg.includes('10.0.0.40'), 'cards carry their address');
  assert.ok(svg.svg.includes('10.0.0.0/24'), 'sections carry their subnet');
  await golden('sample.svg', svg.svg);
});

test('draw.io export is stable', async () => {
  assert.match(drawio, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(drawio.includes('<mxGraphModel'));
  assert.ok(drawio.includes('10.0.0.40'));
  await golden('sample.drawio', drawio);
});

test('mermaid export is stable', async () => {
  assert.match(mermaid, /^(flowchart|graph) /);
  await golden('sample.mmd', mermaid);
});

test('exporters are deterministic', () => {
  const again = toSvg(createDocFromScan(parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME)), policy);
  assert.equal(again.svg, svg.svg);
  assert.equal(again.width, svg.width);
});

test('exports follow the resolved risk policy', () => {
  const nothing = toSvg(doc, { version: 1, levels: [] });
  assert.notEqual(nothing.svg, svg.svg, 'a policy with no levels must not be flagged in the picture');
  assert.equal(toMermaid(doc, { version: 1, levels: [] }).includes('risk_critical'), false);
});

test('a hidden layer and a focused layer change what the picture holds', () => {
  const hidden = { ...doc, layers: doc.layers.map((layer) => ({ ...layer, visible: false })) };
  const empty = toSvg(hidden, policy);
  assert.equal(empty.svg.includes('10.0.0.40'), false);
  assert.equal(toDrawio(hidden, policy).includes('10.0.0.40'), false);

  const focused = { ...doc, focusedLayerId: doc.layers[0].id };
  assert.equal(toSvg(focused, policy).svg.includes('10.0.0.40'), true);

  const otherFocus = { ...doc, focusedLayerId: doc.layers[1].id };
  assert.equal(toSvg(otherFocus, policy).svg.includes('10.0.0.40'), false);
});

test('a collapsed section hides its cards in every picture format', () => {
  const section = doc.nodes.find((node) => node.kind === 'section');
  const collapsed = {
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === section.id ? { ...node, collapsed: true } : node)),
  };

  for (const [name, output] of [
    ['svg', toSvg(collapsed, policy).svg],
    ['drawio', toDrawio(collapsed, policy)],
  ]) {
    assert.equal(output.includes('10.0.0.40'), false, `${name} hides cards inside a collapsed section`);
  }
});

test('a label cannot smuggle markup, control characters or syntax into an export', () => {
  const card = doc.nodes.find((node) => node.host);
  assert.ok(card, 'the sample scan has at least one host card');
  const hostile = {
    ...doc,
    // Short enough not to be truncated by the SVG's width fitting.
    nodes: doc.nodes.map((node) => (node.id === card.id ? { ...node, label: '<b>x</b>\u0007' } : node)),
    edges: doc.edges.map((edge, index) => (index === 0 ? { ...edge, label: 'a|b #c "d" \u0000' } : edge)),
  };

  const svgOut = toSvg(hostile, policy).svg;
  const drawioOut = toDrawio(hostile, policy);
  const mermaidOut = toMermaid(hostile, policy);

  for (const [name, output] of [
    ['svg', svgOut],
    ['drawio', drawioOut],
    ['mermaid', mermaidOut],
  ]) {
    assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(output), false, `${name} drops control characters`);
  }
  assert.ok(svgOut.includes('&lt;b&gt;x&lt;/b&gt;'), 'svg escapes markup');
  // draw.io decodes XML and then HTML, so user text is escaped twice on purpose.
  assert.ok(drawioOut.includes('&amp;lt;b&amp;gt;x&amp;lt;/b&amp;gt;'), 'draw.io keeps markup visible as text');
  assert.equal(drawioOut.includes('<b>x</b>'), false, 'draw.io does not treat a label as markup');
  assert.ok(mermaidOut.includes('#124;'), 'mermaid escapes the pipe that would end an edge label');
  assert.ok(mermaidOut.includes('#35;'), 'mermaid escapes the hash that starts an entity');
  assert.equal(mermaidOut.includes('|a|b'), false, 'no raw pipe survives in an edge label');
});

test('the exporters follow the sides and the arrowhead a connection was given', () => {
  // The sample scan links its cards by traces only, so draw one by hand.
  const drawn = (patch) => {
    const hosts = doc.nodes.filter((node) => node.kind === 'host');
    const taken = new Set(doc.edges.flatMap((edge) => [`${edge.source}|${edge.target}`, `${edge.target}|${edge.source}`]));
    let pair;
    for (const first of hosts) {
      const second = hosts.find((node) => node !== first && !taken.has(`${first.id}|${node.id}`));
      if (second) {
        pair = [first, second];
        break;
      }
    }
    const linked = addLink(doc, pair[0].id, pair[1].id, { from: 't', to: 'b' });
    const link = linked.edges.at(-1);
    return { ...linked, edges: [{ ...link, ...patch }] };
  };
  const heads = (output) => output.match(/d="M 0 0 L/g)?.length ?? 0;

  assert.equal(heads(toSvg(drawn({ arrow: 'none' }), policy).svg), 0, 'no arrowhead when none was asked for');
  assert.equal(heads(toSvg(drawn({ arrow: 'target' }), policy).svg), 1, 'one arrowhead at the target');
  assert.equal(heads(toSvg(drawn({ arrow: 'source' }), policy).svg), 1, 'one arrowhead at the source');
  assert.equal(heads(toSvg(drawn({ arrow: 'both' }), policy).svg), 2, 'two arrowheads for both ends');

  assert.notEqual(
    toSvg(drawn({ from: 'l', to: 'r' }), policy).svg,
    toSvg(drawn({ from: 't', to: 'b' }), policy).svg,
    'the sides decide where the line meets the cards',
  );

  const drawioOut = toDrawio(drawn({ arrow: 'both' }), policy);
  assert.ok(drawioOut.includes('exitX=0.5;exitY=0'), 'draw.io leaves the top edge');
  assert.ok(drawioOut.includes('entryX=0.5;entryY=1'), 'and arrives at the bottom edge');
  assert.ok(drawioOut.includes('startArrow=block'), 'draw.io draws the source arrowhead');
  assert.ok(drawioOut.includes('endArrow=block'), 'draw.io draws the target arrowhead');
  assert.ok(
    toDrawio(drawn({ from: 'l', to: 'r' }), policy).includes('exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5'),
    'a left-to-right link keeps the default sides',
  );
  assert.equal(toDrawio(drawn({ arrow: 'none' }), policy).includes('endArrow=block'), false);

  const solid = toMermaid(drawn({ arrow: 'target', line: 'solid' }), policy);
  assert.ok(solid.includes('-->'), 'a solid link points with -->');
  assert.ok(toMermaid(drawn({ arrow: 'both', line: 'solid' }), policy).includes('<-->'), 'both ends point with <-->');
  assert.ok(toMermaid(drawn({ arrow: 'none', line: 'dashed' }), policy).includes('-.-'), 'a plain dotted link is -.-');
});

test('the CSV report marks spreadsheet formulas as text', () => {
  const summary = riskSummary(
    [
      {
        id: 'node-1',
        kind: 'host',
        layerId: 'layer:main',
        position: { x: 0, y: 0 },
        host: {
          id: 'h',
          ip: '10.0.0.1',
          hostnames: ['=cmd|calc'],
          status: 'up',
          os: [],
          ports: [{ port: 445, protocol: 'tcp', state: 'open', scripts: [] }],
          portsScanned: true,
          scripts: [],
          hops: [],
        },
      },
    ],
    policy,
    new Map([['layer:main', { id: 'layer:main', name: '=Bad layer', color: '#888', visible: true }]]),
  );
  const csv = toRiskCsv(summary, {
    diagram: '=scan.xml',
    scope: 'diagram',
    scopeLabel: 'whole diagram',
    policyScope: 'the built-in default',
    generated: '2026-01-01T00:00:00.000Z',
  });
  const row = csv.split('\r\n').find((line) => line.includes("'=cmd"));
  assert.ok(row, 'the row with a formula-like hostname is prefixed');
  assert.ok(row.includes("'=cmd|calc"), 'hostname is marked as text');
  assert.equal(/,[=+]/.test(csv), false, 'no cell starts with a bare = or +');
});
