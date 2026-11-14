import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCode } from '../src/code/dsl';
import { layoutCode, layoutBounds } from '../src/code/layout';
import { applyLayerCode, parsePorts, riskPolicyFromLevels } from '../src/code/codeToDoc';
import { docToCode } from '../src/code/docToCode';
import { highlightCode, highlightLine } from '../src/code/highlight';
import { colorAtOffset, colorsInLine, replaceColor, toHex } from '../src/code/color';
import { findMatches, nextMatchIndex, replaceAllMatches, replaceMatch } from '../src/code/find';
import { compactCode, expandCode, reflowCode } from '../src/code/reflow';
import { emptyDoc, createDocFromScan } from '../src/doc/docFromScan';
import { nodeSize } from '../src/doc/measure';
import { emptyHost } from '../src/doc/operations';
import { MAIN_LAYER, NOTES_LAYER, nodeTitle } from '../src/doc/types';
import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

/**
 * The code panel is the second way to author a diagram, so these tests pin the one
 * thing that matters: what the canvas shows after a block of text is applied, and
 * that going canvas → code → canvas keeps the layer's content.
 */

const parseOk = (code) => {
  const result = parseCode(code);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.model;
};

const boxOf = (nodes) => {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const right = Math.max(...nodes.map((node) => node.position.x + nodeSize(node).w));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const bottom = Math.max(...nodes.map((node) => node.position.y + nodeSize(node).h));
  return { cx: (left + right) / 2, cy: (top + bottom) / 2 };
};

test('the parser reads nodes, sections, notes and attributes', () => {
  const model = parseOk(`
    # a comment
    flowchart TB
    layer: "DMZ" color: #4b9fff

    subgraph dmz["DMZ"] cidr: "10.0.0.0/24" collapsed: true
      web["Web server"] icon: server accent: #2fd6a5
      db("Database") subtitle: "primary"
    end

    memo>Remember] notes: "rotate keys" accent: #facc15
    hop1 kind: hop address: "10.0.0.1"
  `);

  assert.equal(model.direction, 'TB');
  assert.equal(model.layerName, 'DMZ');
  assert.equal(model.layerColor, '#4b9fff');

  const section = model.items.find((item) => item.ref === 'dmz');
  assert.equal(section.kind, 'section');
  assert.equal(section.attrs.cidr, '10.0.0.0/24');
  assert.equal(section.attrs.collapsed, 'true');

  const web = model.items.find((item) => item.ref === 'web');
  assert.equal(web.label, 'Web server');
  assert.equal(web.parent, 'dmz');
  assert.equal(web.attrs.icon, 'server');

  assert.equal(model.items.find((item) => item.ref === 'db').label, 'Database');
  assert.equal(model.items.find((item) => item.ref === 'memo').kind, 'note');
  assert.equal(model.items.find((item) => item.ref === 'hop1').kind, 'hop');
});

test('edge operators carry arrowheads, line style and attributes', () => {
  const model = parseOk(`
    a["A"]
    b["B"]
    c["C"]

    a -->|HTTPS| b
    b -.-> c style: dotted
    c <--> a arrow: both path: straight from: t to: b
    a --- b kind: route
  `);

  assert.equal(model.edges.length, 4);
  const [first, second, third, fourth] = model.edges;

  assert.equal(first.label, 'HTTPS');
  assert.equal(first.arrow, 'target');
  assert.equal(first.kind, 'link');

  assert.equal(second.line, 'dotted');
  assert.equal(second.label, undefined);
  assert.equal(second.kind, 'link');

  assert.equal(third.arrow, 'both');
  assert.equal(third.path, 'straight');
  assert.equal(third.fromSide, 't');
  assert.equal(third.toSide, 'b');

  assert.equal(fourth.arrow, 'none');
  assert.equal(fourth.kind, 'route');
});

test('a chained statement becomes one edge per hop', () => {
  const model = parseOk('a --> b --> c');
  assert.deepEqual(
    model.edges.map((edge) => `${edge.from}>${edge.to}`),
    ['a>b', 'b>c'],
  );
});

test('parse errors name the line instead of guessing', () => {
  const unclosed = parseCode('subgraph s["S"]\n  a["A"]');
  assert.equal(unclosed.ok, false);
  assert.match(unclosed.error, /never closed/);

  const brokenLabel = parseCode('a["A"]\nb["unclosed');
  assert.equal(brokenLabel.ok, false);
  assert.equal(brokenLabel.line, 2);

  const duplicate = parseCode('a["A"]\na["B"]');
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /already used/);
});

test('a node named only in an edge is created, like Mermaid', () => {
  const model = parseOk('a --> b');
  assert.deepEqual(
    model.items.map((item) => [item.ref, item.kind, item.label]),
    [
      ['a', 'host', 'a'],
      ['b', 'host', 'b'],
    ],
  );
});

test('the layout keeps section children inside their frame', () => {
  const model = parseOk(`
    subgraph dmz["DMZ"]
      a["A"]
      b["B"]
      c["C"]
      a --> b
      b --> c
    end
    d["D"]
    dmz --> d
  `);
  const layout = layoutCode(model);
  const byRef = new Map(layout.items.map((item) => [item.ref, item]));

  const section = byRef.get('dmz');
  assert.ok(section.w > 300 && section.h > 150, 'the frame is at least the minimum size');

  for (const ref of ['a', 'b', 'c']) {
    const child = byRef.get(ref);
    assert.equal(child.parent, 'dmz');
    assert.ok(child.x >= 24 && child.y >= 44, `${ref} starts below the section header`);
    assert.ok(child.x + child.w <= section.w, `${ref} fits inside the frame horizontally`);
    assert.ok(child.y + child.h <= section.h, `${ref} fits inside the frame vertically`);
  }

  // `dmz --> d` puts d in the next column, past the frame.
  assert.ok(byRef.get('d').x >= section.w, 'the edge pushes the card to the next column');
  const bounds = layoutBounds(layout);
  assert.ok(bounds.w > 0 && bounds.h > 0);

  // A written size is honoured as a floor, so a widened frame round-trips.
  const sized = layoutCode(parseOk('subgraph s["S"] size: "640x480"\n  a["A"]\nend'));
  const frame = sized.items.find((item) => item.ref === 's');
  assert.equal(frame.w, 640);
  assert.equal(frame.h, 480);
});

test('applying code replaces one layer and centres it where it was', () => {
  const base = emptyDoc();
  // A card sits at 1000,600 on the main layer; the rebuilt layer must centre on it.
  base.nodes = [
    { id: 'host:10.0.0.5', kind: 'host', layerId: MAIN_LAYER, position: { x: 1000, y: 600 }, host: emptyHost('a') },
    { id: 'note:keep', kind: 'note', layerId: NOTES_LAYER, position: { x: 10, y: 20 }, label: 'Keep me' },
  ];
  base.edges = [{ id: 'link:1', source: 'host:10.0.0.5', target: 'note:keep', kind: 'link' }];

  const result = applyLayerCode(
    base,
    MAIN_LAYER,
    [
      'web["Web"] host: "10.0.0.9" ports: "80/http,443/https" hostname: "web.lab" mac: "aa:bb:cc" os: "Linux"',
      'db["Db"] host: "10.0.0.10" ports: "5432/postgresql"',
      'web -->|SQL| db from: r to: l',
    ].join('\n'),
  );
  assert.equal(result.ok, true, result.ok ? '' : result.error);

  const { doc } = result;
  const main = doc.nodes.filter((node) => node.layerId === MAIN_LAYER);
  assert.equal(main.length, 2);
  assert.equal(result.removed, 1);

  // The other layer and its cards survive; its edge cannot, because one endpoint
  // was on the layer the code replaced.
  assert.ok(doc.nodes.some((node) => node.id === 'note:keep'));
  assert.equal(doc.edges.filter((edge) => edge.id === 'link:1').length, 0);

  const host = main.find((node) => node.label === 'Web');
  assert.equal(host.host.ip, '10.0.0.9');
  assert.deepEqual(host.host.hostnames, ['web.lab']);
  assert.equal(host.host.mac, 'aa:bb:cc');
  assert.equal(host.host.os[0].name, 'Linux');
  assert.equal(host.host.ports.length, 2);
  assert.equal(host.host.ports[1].service, 'https');
  assert.equal(host.host.portsScanned, true);

  const created = doc.edges.filter((edge) => edge.kind === 'link' && edge.id !== 'link:1');
  assert.equal(created.length, 1);
  assert.equal(created[0].label, 'SQL');
  assert.equal(created[0].from, 'r');
  assert.equal(created[0].to, 'l');

  // The old card was 216×96 at 1000,600, so its centre is 1108,648.
  const centre = boxOf(main);
  assert.ok(Math.abs(centre.cx - 1108) <= 2, `centred horizontally, got ${centre.cx}`);
  assert.ok(Math.abs(centre.cy - 648) <= 2, `centred vertically, got ${centre.cy}`);
});

test('applying code with a syntax error leaves the document alone', () => {
  const result = applyLayerCode(emptyDoc(), MAIN_LAYER, 'subgraph s["S"]\n a["A"]');
  assert.equal(result.ok, false);
  assert.match(result.error, /never closed/);
  assert.equal(result.line, 1);
});

test('the risk directive replaces the diagram levels and keeps known colours', () => {
  const policy = riskPolicyFromLevels(
    [
      { label: 'Critical', ports: '23, 3389' },
      { label: 'Custom', ports: '1234', color: '#123456' },
    ],
    { version: 1, levels: [{ id: 'critical', label: 'Critical', color: '#e5484d', ports: '21', enabled: true }] },
  );
  assert.equal(policy.levels.length, 2);
  assert.equal(policy.levels[0].color, '#e5484d', 'a known label keeps its colour');
  assert.equal(policy.levels[0].ports, '23, 3389');
  assert.equal(policy.levels[1].color, '#123456');
  assert.equal(policy.levels[1].id, 'custom');
});

test('the risk directive survives a round trip, including disabled and empty levels', () => {
  const disabled = applyLayerCode(
    emptyDoc(),
    MAIN_LAYER,
    ['a["A"]', 'risk: Critical = 21, 23 #e5484d ; Legacy = 23 off'].join('\n'),
  );
  assert.equal(disabled.ok, true, disabled.ok ? '' : disabled.error);
  assert.equal(disabled.doc.risk.levels[0].enabled, true);
  assert.equal(disabled.doc.risk.levels[1].enabled, false);
  assert.equal(disabled.doc.risk.levels[1].label, 'Legacy');

  const regenerated = docToCode(disabled.doc, MAIN_LAYER);
  assert.match(regenerated, /risk: Critical = 21, 23 #e5484d ; Legacy = 23 #.{6} off/);

  const again = applyLayerCode(disabled.doc, MAIN_LAYER, regenerated);
  assert.equal(again.ok, true, again.ok ? '' : again.error);
  assert.equal(again.doc.risk.levels[1].enabled, false);

  // "flag nothing" is not the same as "inherit", so it has its own word.
  const cleared = applyLayerCode(emptyDoc(), MAIN_LAYER, 'a["A"]\nrisk: none');
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.doc.risk.levels, []);
  assert.match(docToCode(cleared.doc, MAIN_LAYER), /^risk: none$/m);
});

test('ports are read in the shapes nmap writes', () => {
  const ports = parsePorts('22/ssh, 80:http, 443/https/open, 53//closed, nonsense');
  assert.deepEqual(
    ports.map((port) => [port.port, port.service, port.state]),
    [
      [22, 'ssh', 'open'],
      [80, 'http', 'open'],
      [443, 'https', 'open'],
      [53, undefined, 'closed'],
    ],
  );
});

test('canvas → code → canvas keeps the layer', () => {
  const first = applyLayerCode(
    emptyDoc(),
    MAIN_LAYER,
    [
      'flowchart LR',
      'layer: "Edge" color: #f0a25c',
      '',
      'subgraph dmz["DMZ"] cidr: "10.0.0.0/24"',
      '  web["Web \\"server\\""] host: "10.0.0.5" ports: "80/http" hostname: "web.lab"',
      'end',
      'memo>Note] notes: "line one\\nline two"',
      'dmz -->|feeds| memo style: dashed path: smoothstep arrow: none kind: route',
    ].join('\n'),
  );
  assert.equal(first.ok, true, first.ok ? '' : first.error);

  const regenerated = docToCode(first.doc, MAIN_LAYER);
  const second = applyLayerCode(first.doc, MAIN_LAYER, regenerated);
  assert.equal(second.ok, true, second.ok ? '' : second.error);

  const before = first.doc.nodes.filter((node) => node.layerId === MAIN_LAYER);
  const after = second.doc.nodes.filter((node) => node.layerId === MAIN_LAYER);
  assert.equal(after.length, before.length);
  assert.equal(second.doc.layers.find((layer) => layer.id === MAIN_LAYER).name, 'Edge');

  assert.deepEqual(
    after.map((node) => node.label).sort(),
    ['DMZ', 'Note', 'Web "server"'].sort(),
  );

  const note = after.find((node) => node.kind === 'note');
  assert.equal(note.notes, 'line one\nline two', 'a newline survives the round trip');

  const host = after.find((node) => node.kind === 'host');
  assert.equal(host.host.ip, '10.0.0.5');
  assert.equal(host.host.ports[0].service, 'http');

  const route = second.doc.edges.find((edge) => edge.kind === 'route');
  assert.equal(route.line, 'dashed');
  assert.equal(route.path, 'smoothstep');
  assert.equal(route.arrow, 'none');
});

test('the serializer writes one layer and explains an edge that leaves it', () => {
  const base = emptyDoc();
  base.nodes = [
    { id: 'host:10.0.0.5', kind: 'host', layerId: MAIN_LAYER, position: { x: 0, y: 0 }, host: emptyHost('a') },
    { id: 'note:n', kind: 'note', layerId: NOTES_LAYER, position: { x: 0, y: 0 }, label: 'N' },
  ];
  base.edges = [{ id: 'e1', source: 'host:10.0.0.5', target: 'note:n', kind: 'link' }];

  const code = docToCode(base, NOTES_LAYER);
  assert.match(code, /^flowchart /m);
  assert.match(code, /^ {2}n\["N"\] kind: note/m);
  assert.doesNotMatch(code, /10\.0\.0\.5/, 'the other layer is not in this text');
  assert.match(code, /1 connection to another layer is not shown here/);
});

test('a scanned layer round-trips through its code', () => {
  const scanned = createDocFromScan(parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME));
  const code = docToCode(scanned, MAIN_LAYER);
  const result = applyLayerCode(scanned, MAIN_LAYER, code);
  assert.equal(result.ok, true, result.ok ? '' : result.error);

  const outline = (value) =>
    value.nodes
      .filter((node) => node.layerId === MAIN_LAYER)
      .map((node) => `${node.kind}:${nodeTitle(node)}`)
      .sort();
  assert.deepEqual(outline(result.doc), outline(scanned));

  const routes = (value) => value.edges.filter((edge) => edge.kind === 'route').length;
  assert.equal(routes(result.doc), routes(scanned));

  // A card's scan facts travel too: the same host comes back with its ports.
  const host = result.doc.nodes.find((node) => node.kind === 'host' && node.host.ports.length > 0);
  assert.ok(host, 'the sample has at least one probed host');
  const original = scanned.nodes.find((node) => node.kind === 'host' && node.host.ip === host.host.ip);
  assert.ok(original);
  assert.equal(host.host.ports.length, original.host.ports.length);
});

test('the highlighter reproduces every character it colours', () => {
  const source = [
    '%% a comment',
    'flowchart LR',
    'layer: "DMZ" color: #4b9fff',
    'subgraph dmz["DMZ"] cidr: "10.0.0.0/24"',
    '  web["Web \\"server\\""] kind: host accent: rgb(47, 214, 165) ports: "80/http"',
    'end',
    'web -->|HTTPS| db style: dashed arrow: none',
  ].join('\n');

  const lines = highlightCode(source);
  assert.equal(lines.length, source.split('\n').length);
  assert.deepEqual(
    lines.map((tokens) => tokens.map((token) => token.text).join('')),
    source.split('\n'),
    'the overlay must line up with the textarea character for character',
  );
});

test('the highlighter names the parts of a line', () => {
  const kinds = (line) =>
    highlightLine(line)
      .filter((token) => token.kind !== 'plain' && token.kind !== 'punct')
      .map((token) => `${token.kind}:${token.text}`);

  assert.deepEqual(kinds('web["Web server"] host: "10.0.0.5"'), [
    'id:web',
    'string:"Web server"',
    'attr:host',
    'string:"10.0.0.5"',
  ]);
  assert.deepEqual(kinds('flowchart TB'), ['directive:flowchart', 'keyword:TB']);
  assert.deepEqual(kinds('web -->|SQL| db'), ['id:web', 'arrow:-->', 'edgeLabel:|SQL|', 'id:db']);
  assert.deepEqual(kinds('accent: #2fd6a5'), ['attr:accent', 'color:#2fd6a5']);
  assert.deepEqual(kinds('risk: Critical = 21, 23'), ['attr:risk', 'id:Critical', 'number:21', 'number:23']);
  assert.deepEqual(kinds('# just a comment'), ['comment:# just a comment']);
  assert.deepEqual(kinds('a --> b style: dotted arrow: none'), [
    'id:a',
    'arrow:-->',
    'id:b',
    'attr:style',
    'keyword:dotted',
    'attr:arrow',
    'keyword:none',
  ]);
});

test('colours are found by shape, and normalised to hex', () => {
  assert.deepEqual(
    colorsInLine('accent: #2fd6a5 and rgb(47, 214, 165)').map((color) => color.value),
    ['#2fd6a5', 'rgb(47, 214, 165)'],
  );
  assert.equal(toHex('#abc'), '#aabbcc');
  assert.equal(toHex('#2FD6A5'), '#2fd6a5');
  assert.equal(toHex('rgb(47, 214, 165)'), '#2fd6a5');
  assert.equal(toHex('rgba(255, 0, 0, 0.4)'), '#ff0000');
  assert.equal(toHex('rgb(300, 0, 0)'), '#ff0000', 'channels are clamped');
  assert.equal(toHex('rebeccapurple'), null);
  assert.equal(toHex('#12345'), null);

  const text = 'a["A"]\naccent: #2fd6a5\nb["B"]';
  const inside = colorAtOffset(text, text.indexOf('#2fd6a5') + 3);
  assert.equal(inside.value, '#2fd6a5');
  assert.equal(inside.start, text.indexOf('#2fd6a5'));
  assert.equal(colorAtOffset(text, 0), null);

  assert.equal(
    replaceColor(text, inside, '#ff0000'),
    'a["A"]\naccent: #ff0000\nb["B"]',
  );
});

test('find matches literals, ignores case unless asked, and accepts a pattern', () => {
  const text = 'web --> db\nweb --> cache\nWEB --> db';
  assert.equal(findMatches(text, 'web', { caseSensitive: false, regex: false }).length, 3);
  assert.equal(findMatches(text, 'web', { caseSensitive: true, regex: false }).length, 2);
  assert.equal(findMatches(text, '-> (db|cache)', { caseSensitive: true, regex: true }).length, 3);
  assert.equal(findMatches(text, '', { caseSensitive: false, regex: false }).length, 0);
  assert.equal(findMatches(text, '(', { caseSensitive: false, regex: false }).length, 0);
  assert.equal(findMatches(text, '(', { caseSensitive: false, regex: true }).length, 0, 'a bad pattern is not a crash');

  // A pattern that matches nothing must not spin: `^` is zero-width.
  assert.equal(findMatches('one\ntwo', '^', { caseSensitive: true, regex: true }).length, 0);
});

test('replace honours literal and regex replacements', () => {
  const text = 'web --> db\nweb --> cache';

  const all = replaceAllMatches(text, 'web', { caseSensitive: false, regex: false }, 'app');
  assert.equal(all.count, 2);
  assert.equal(all.text, 'app --> db\napp --> cache');

  const literalDollar = replaceAllMatches('a b', 'b', { caseSensitive: true, regex: false }, '$&');
  assert.equal(literalDollar.text, 'a $&', 'a literal search treats the replacement as text');

  const grouped = replaceAllMatches(text, 'web --> (\\w+)', { caseSensitive: true, regex: true }, 'app -> $1');
  assert.equal(grouped.text, 'app -> db\napp -> cache');

  const first = { start: 0, end: 3 };
  assert.equal(
    replaceMatch(text, first, 'web', { caseSensitive: true, regex: false }, 'app'),
    'app --> db\nweb --> cache',
  );

  const matches = findMatches(text, 'web', { caseSensitive: true, regex: false });
  assert.equal(nextMatchIndex(matches, 0), 0);
  assert.equal(nextMatchIndex(matches, 4), 1);
  assert.equal(nextMatchIndex(matches, 100), 0, 'Find Next wraps to the top');
  assert.equal(nextMatchIndex([], 0), -1);
});

// --- multi-line statements and the compact/expanded layout ------------------

const WEB = 'web["Web servers"] kind: host icon: "server" host: "10.0.0.10" hostname: "web.lab" ports: "80/http, 443/https"';
const WEB_SPREAD = [
  'web["Web servers"] kind: host',
  '  icon: "server"',
  '  host: "10.0.0.10" hostname: "web.lab"',
  '  ports: "80/http, 443/https"',
].join('\n');

test('an indented attribute line continues the statement above it', () => {
  const oneLine = parseOk(WEB);
  const spread = parseOk(WEB_SPREAD);
  assert.deepEqual(spread.items, oneLine.items, 'both shapes describe the same node');
  assert.equal(spread.items.length, 1, 'the continuations did not become nodes of their own');
  assert.equal(spread.items[0].attrs.ports, '80/http, 443/https');
  assert.equal(spread.items[0].attrs.hostname, 'web.lab');
});

test('a connection, a layer and a section all take continuations', () => {
  const edge = parseOk(['a["A"]', 'b["B"]', 'a --> b', '  style: dashed arrow: none'].join('\n'));
  assert.equal(edge.edges[0].line, 'dashed');
  assert.equal(edge.edges[0].arrow, 'none');

  const layerModel = parseOk(['layer: "DMZ"', '  color: #4b9fff'].join('\n'));
  assert.equal(layerModel.layerName, 'DMZ');
  assert.equal(layerModel.layerColor, '#4b9fff');

  const section = parseOk(['subgraph s["S"]', '  cidr: "10.0.0.0/24"', '  a["A"]', 'end'].join('\n'));
  assert.equal(section.items[0].kind, 'section');
  assert.equal(section.items[0].attrs.cidr, '10.0.0.0/24');
});

test('blank lines and comments do not break a continuation, and an orphan is an error', () => {
  const model = parseOk(['a["A"] kind: host', '', '%% a note', '  host: "10.0.0.1"'].join('\n'));
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].attrs.host, '10.0.0.1');

  const orphan = parseCode('  icon: "server"');
  assert.equal(orphan.ok, false);
  assert.match(orphan.error, /no statement to continue/);
});

test('Expand wraps attributes into the documented shape and back', () => {
  assert.equal(expandCode(WEB), WEB_SPREAD);
  assert.equal(compactCode(WEB_SPREAD), WEB);
  assert.equal(reflowCode(WEB_SPREAD, 'expanded'), WEB_SPREAD, 'expanding is idempotent');
  assert.equal(reflowCode(WEB, 'compact'), WEB, 'compacting is idempotent');

  // Indentation is relative: a node inside a subgraph keeps its own level.
  const nested = ['subgraph s["S"]', '  a["A"] kind: host icon: "router"', 'end'].join('\n');
  assert.equal(
    expandCode(nested),
    ['subgraph s["S"]', '  a["A"] kind: host', '    icon: "router"', 'end'].join('\n'),
  );
});

test('expanded text parses to the same model as compact text', () => {
  const source = [
    'flowchart LR',
    'layer: "L" color: #112233',
    'subgraph s["S"] cidr: "10.0.0.0/24"',
    '  a["A"] kind: host icon: "router" host: "10.0.0.1" ports: "22/ssh, 80/http"',
    'end',
    'a -->|x| b style: dashed from: r to: l arrow: both',
  ].join('\n');
  const shape = (model) => ({
    items: model.items.map(({ ref, kind, label, attrs, parent }) => ({ ref, kind, label, attrs, parent })),
    edges: model.edges.map(({ from, to, label, arrow, line, path, fromSide, toSide, kind }) => ({
      from,
      to,
      label,
      arrow,
      line,
      path,
      fromSide,
      toSide,
      kind,
    })),
  });

  const compact = parseOk(source);
  const expanded = parseOk(expandCode(source));
  assert.deepEqual(shape(expanded), shape(compact));
});

test('the expanded layout round-trips the sample scan', () => {
  const scanned = createDocFromScan(parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME));
  const code = docToCode(scanned, MAIN_LAYER, 'expanded');
  assert.ok(
    code.split('\n').some((line) => /^ +\w+: /.test(line)),
    'the expanded code has indented continuation lines',
  );

  const result = applyLayerCode(scanned, MAIN_LAYER, code);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.deepEqual(
    result.doc.nodes
      .filter((node) => node.layerId === MAIN_LAYER)
      .map((node) => `${node.kind}:${nodeTitle(node)}`)
      .sort(),
    scanned.nodes
      .filter((node) => node.layerId === MAIN_LAYER)
      .map((node) => `${node.kind}:${nodeTitle(node)}`)
      .sort(),
  );

  // The highlighter must still reproduce every character of the wrapped form.
  const lines = highlightCode(code);
  assert.deepEqual(
    lines.map((tokens) => tokens.map((token) => token.text).join('')),
    code.split('\n'),
  );
});
