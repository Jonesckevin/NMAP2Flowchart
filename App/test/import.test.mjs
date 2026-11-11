import assert from 'node:assert/strict';
import test from 'node:test';

import { runImport } from '../src/nmap/runImport';
import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { createDocFromScan, previewImport, scanEffects } from '../src/doc/docFromScan';
import { MAIN_LAYER } from '../src/doc/types';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

const sampleDoc = () => createDocFromScan(parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME));

const discoveryXml = `<?xml version="1.0"?>
<nmaprun scanner="nmap" args="nmap -sn -oX ping.xml 10.9.0.0/24" version="7.95">
  <host><status state="up"/><address addr="10.9.0.7" addrtype="ipv4"/></host>
  <host><status state="up"/><address addr="10.9.0.8" addrtype="ipv4"/></host>
</nmaprun>`;

test('the worker pipeline returns everything the app needs to commit', () => {
  const doc = sampleDoc();
  const result = runImport({ text: SAMPLE_SCAN_XML, fileName: SAMPLE_FILE_NAME, mode: 'merge', doc });

  assert.equal(result.ok, true);
  assert.equal(result.fileName, SAMPLE_FILE_NAME);
  assert.equal(result.mode, 'merge');
  assert.equal(result.scan.hosts.length, 12);
  assert.equal(result.added, 0, 'a re-scan of the same subnets adds nothing');
  assert.equal(result.gone, 0);
  assert.equal(result.layerId, null);
  assert.equal(result.doc.nodes.length, doc.nodes.length);

  // The effect counts are the ones the dialog shows, from the same layout pass.
  for (const mode of ['merge', 'replace', 'layer']) {
    assert.deepEqual(result.effects[mode], previewImport(doc, result.scan, mode));
  }
});

test('a scan that found nothing is explained, not drawn', () => {
  const doc = sampleDoc();
  const empty = `<?xml version="1.0"?>
<nmaprun scanner="nmap" args="nmap -sV -sC -O --traceroute -oX scan7.xml 10.1.0.0/22" version="7.99">
<runstats><finished elapsed="827.34" exit="success"
  summary="Nmap done at Mon Nov  9 21:39:25 2026; 1024 IP addresses (0 hosts up) scanned in 827.34 seconds"/>
  <hosts up="0" down="1024" total="1024"/></runstats>
</nmaprun>`;

  for (const mode of ['replace', 'merge', 'layer']) {
    const result = runImport({ text: empty, fileName: 'scan7.xml', mode, doc });
    assert.equal(result.ok, false, `${mode}: nothing is committed`);
    assert.match(result.error, /scan7\.xml is a valid scan, but it found 0 hosts up/);
    assert.match(result.error, /0 hosts up\) scanned/, 'nmap\'s own summary is quoted');
    assert.match(result.error, /-Pn/, 'and it says what to try next');
  }

  // With no document open, the answer is the same one.
  const fresh = runImport({ text: empty, fileName: 'scan7.xml', mode: 'replace', doc: null });
  assert.equal(fresh.ok, false);
});

test('each mode produces the document its name promises', () => {
  const doc = sampleDoc();

  const replaced = runImport({ text: discoveryXml, fileName: 'ping.xml', mode: 'replace', doc });
  assert.equal(replaced.ok, true);
  assert.equal(replaced.doc.nodes.filter((node) => node.kind === 'host').length, 2);
  assert.equal(replaced.doc.layers.length, doc.layers.length);

  const layered = runImport({ text: discoveryXml, fileName: 'ping.xml', mode: 'layer', doc });
  assert.equal(layered.ok, true);
  assert.equal(layered.doc.layers.length, doc.layers.length + 1);
  assert.ok(layered.layerId);
  const onLayer = layered.doc.nodes.filter((node) => node.layerId === layered.layerId);
  assert.equal(onLayer.length, layered.added);

  const merged = runImport({ text: discoveryXml, fileName: 'ping.xml', mode: 'merge', doc });
  assert.equal(merged.ok, true);
  // The origin node is matched by identity, so only its section and cards are new.
  assert.equal(merged.added, 3);
  assert.equal(merged.effects.merge.matched, 1);
  assert.ok(merged.doc.nodes.length > doc.nodes.length);
  assert.ok(merged.doc.nodes.every((node) => node.layerId === MAIN_LAYER || node.layerId === doc.layers[1].id));
});

test('a new browse session starts a document instead of merging into nothing', () => {
  const result = runImport({ text: SAMPLE_SCAN_XML, fileName: SAMPLE_FILE_NAME, mode: 'merge', doc: null });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'replace', 'with no open document there is nothing to merge into');
  assert.equal(result.doc.nodes.filter((node) => node.kind === 'host').length, 12);
  assert.equal(result.effects.merge.nodes, result.effects.replace.nodes);
});

test('unreadable files come back as a message, not an exception', () => {
  const junk = runImport({ text: '<html/>', fileName: 'page.html', mode: 'merge', doc: null });
  assert.equal(junk.ok, false);
  assert.match(junk.error, /No <nmaprun> root element/);

  const broken = runImport({ text: '{"not":"xml"', fileName: 'x.xml', mode: 'merge', doc: null });
  assert.equal(broken.ok, false);
  assert.ok(broken.error.length > 0);
});

test('effect counts come from one layout pass and stay consistent', () => {
  const doc = sampleDoc();
  const scan = parseNmapXml(discoveryXml, 'ping.xml');

  const effects = scanEffects(doc, scan);
  assert.deepEqual(effects.replace, { nodes: 4, matched: 0, added: 4, stale: 0 });
  // The existing origin matches the new one, so merge adds the rest.
  assert.deepEqual(effects.merge, { nodes: 4, matched: 1, added: 3, stale: 12 });
  assert.deepEqual(effects.layer, effects.replace);
  assert.deepEqual(scanEffects(null, scan).merge, effects.replace);
});

test('a thousand-host scan still imports inside the budget', () => {
  // The canvas only paints what is on screen, so the cost that matters here is the
  // main-thread pipeline: parse → layout → effects. This is a guard against an
  // accidental quadratic pass, not a benchmark – the bound is deliberately loose.
  const hosts = Array.from({ length: 1000 }, (_, index) => {
    const octet3 = Math.floor(index / 200);
    return `<host><status state="up"/><address addr="10.${40 + octet3}.0.${(index % 200) + 1}" addrtype="ipv4"/>
      <ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh"/></port>
      <port protocol="tcp" portid="445"><state state="open"/><service name="microsoft-ds"/></port></ports></host>`;
  }).join('');
  const xml = `<?xml version="1.0"?><nmaprun scanner="nmap" args="nmap -sV -oX big.xml 10.40.0.0/16">
    ${hosts}<runstats><finished time="1"/><hosts up="1000" down="0" total="1000"/></runstats></nmaprun>`;

  const started = Date.now();
  const result = runImport({ text: xml, fileName: 'big.xml', mode: 'replace', doc: null });
  const elapsed = Date.now() - started;

  assert.equal(result.ok, true);
  assert.ok(result.doc.nodes.length > 1000, 'every host becomes a card');
  assert.ok(elapsed < 8000, `a 1000-host import took ${elapsed} ms`);
});
