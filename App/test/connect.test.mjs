import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { analyzeConnections } from '../src/connect/analyze';
import { DEFAULT_CONNECT_OPTIONS, buildConnectLayer } from '../src/connect/build';
import { createDocFromScan, importScanAsLayer, mergeScanIntoDoc } from '../src/doc/docFromScan';
import { defaultRiskPolicy } from '../src/doc/risk';
import { toDrawio } from '../src/export/drawio';
import { toMermaid } from '../src/export/mermaid';
import { toSvg } from '../src/export/svg';
import { createNode } from '../src/doc/operations';
import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { APP_ROOT } from './helpers.mjs';

function hostXml({ ip, mac, vendor = 'Test Vendor', names = [], ports = [], trace = [], os = [] }) {
  const addresses = [`<address addr="${ip}" addrtype="ipv4"/>`];
  if (mac) addresses.push(`<address addr="${mac}" addrtype="mac" vendor="${vendor}"/>`);
  const hostnames = names.length
    ? `<hostnames>${names.map((name) => `<hostname name="${name}" type="PTR"/>`).join('')}</hostnames>`
    : '';
  const portList = ports.length
    ? `<ports>${ports
        .map(
          ([id, service]) =>
            `<port protocol="tcp" portid="${id}"><state state="open"/><service name="${service}"/></port>`,
        )
        .join('')}</ports>`
    : '';
  const hops = trace.length
    ? `<trace>${trace.map((hop, index) => `<hop ttl="${index + 1}" ipaddr="${hop}"/>`).join('')}</trace>`
    : '';
  const matches = os.length
    ? `<os>${os
        .map(
          ([name, accuracy]) =>
            `<osmatch name="${name}" accuracy="${accuracy}"><osclass type="general purpose" vendor="Linux" osfamily="Linux" accuracy="${accuracy}"/></osmatch>`,
        )
        .join('')}</os>`
    : '';
  return `  <host><status state="up"/>
    ${addresses.join('\n    ')}
    ${hostnames}
    ${portList}
    ${matches}
    ${hops}
  </host>`;
}

function scanXml(args, hosts) {
  return `<?xml version="1.0"?>
<nmaprun scanner="nmap" args="${args}" version="7.95">
${hosts.map(hostXml).join('\n')}
</nmaprun>`;
}

const EDGE_HOSTS = [
  {
    ip: '10.0.0.1',
    mac: 'AA:00:00:00:00:01',
    vendor: 'Router Works',
    names: ['gw.lab.test'],
    ports: [
      [22, 'ssh'],
      [53, 'domain'],
    ],
    trace: ['10.0.0.1'],
  },
  {
    ip: '10.0.0.5',
    mac: 'AA:00:00:00:00:05',
    vendor: 'Storage Inc',
    names: ['nas.lab.test'],
    ports: [[445, 'microsoft-ds']],
    trace: ['10.0.0.1', '10.0.0.5'],
  },
  {
    ip: '10.0.0.6',
    mac: 'AA:00:00:00:00:06',
    vendor: 'Dell Inc',
    names: ['build-01.lab.test'],
    ports: [[80, 'http']],
    trace: ['10.0.0.1', '10.0.0.6'],
  },
  {
    ip: '10.10.5.4',
    names: ['vpn-01.lab.test'],
    ports: [[443, 'https']],
    trace: ['10.0.0.1', '10.0.0.254', '10.10.5.4'],
  },
  {
    ip: '10.10.5.9',
    names: ['ci.lab.test'],
    ports: [[22, 'ssh']],
    trace: ['10.0.0.1', '10.0.0.254', '10.10.5.9'],
  },
];

const edgeScan = () => parseNmapXml(scanXml('nmap -sV --traceroute -oX edge.xml 10.0.0.0/24', EDGE_HOSTS), 'edge.xml');

const routerByIp = (analysis, ip) => analysis.routers.find((router) => router.ip === ip);
const hostByIp = (analysis, ip) => analysis.hosts.find((host) => host.ip === ip);

test('traceroute hops become routers between the origin and each subnet', () => {
  const analysis = analyzeConnections(createDocFromScan(edgeScan()));

  assert.equal(analysis.stats.hosts, 5);
  assert.deepEqual(
    analysis.routers.map((router) => router.ip),
    ['10.0.0.1', '10.0.0.254'],
  );

  const gateway = routerByIp(analysis, '10.0.0.1');
  assert.equal(gateway.parent, null, 'the first hop is the entry router');
  assert.equal(gateway.depth, 1);
  assert.deepEqual(gateway.served, ['10.0.0.5', '10.0.0.6']);
  assert.deepEqual(gateway.hostnames, ['gw.lab.test']);

  const internal = routerByIp(analysis, '10.0.0.254');
  assert.equal(internal.parent, '10.0.0.1');
  assert.equal(internal.depth, 2);
  assert.deepEqual(internal.served, ['10.10.5.4', '10.10.5.9']);

  const local = analysis.segments.find((segment) => segment.cidr === '10.0.0.0/24');
  assert.equal(local.gateway, '10.0.0.1');
  assert.deepEqual(local.hosts, ['10.0.0.1', '10.0.0.5', '10.0.0.6']);

  const remote = analysis.segments.find((segment) => segment.cidr === '10.10.5.0/24');
  assert.equal(remote.gateway, '10.0.0.254');

  assert.equal(analysis.stats.traced, 4);
  assert.equal(analysis.stats.untraced, 1, '10.0.0.1 only traces itself');
  assert.equal(analysis.stats.joinable, 0, 'the one untraced card is the gateway itself');
  assert.equal(analysis.stats.routes, analysis.routers.length + analysis.stats.traced);
  assert.ok(analysis.findings.some((finding) => /fronts 10\.0\.0\.0\/24/.test(finding.title)));
});

test('the same address in two imports becomes one card with the richer record', () => {
  const audit = parseNmapXml(
    scanXml('nmap -sV -oX audit.xml 10.0.0.0/24', [
      {
        ip: '10.0.0.5',
        mac: 'AA:00:00:00:00:55',
        vendor: 'Storage Inc',
        names: ['nas.lab.test'],
        ports: [
          [22, 'ssh'],
          [139, 'netbios-ssn'],
          [445, 'microsoft-ds'],
        ],
        trace: ['10.0.0.1', '10.0.0.5'],
      },
      {
        ip: '10.0.0.7',
        mac: 'AA:00:00:00:00:05',
        vendor: 'Storage Inc',
        names: ['nas.lab.test', 'nas-02.lab.test'],
        ports: [[445, 'microsoft-ds']],
        trace: ['10.0.0.1', '10.0.0.7'],
      },
    ]),
    'audit.xml',
  );

  const doc = importScanAsLayer(createDocFromScan(edgeScan()), audit).doc;
  const analysis = analyzeConnections(doc);
  const nas = hostByIp(analysis, '10.0.0.5');

  assert.equal(analysis.stats.hosts, 6, 'six distinct addresses across the two layers');
  assert.equal(analysis.stats.layers, 2);
  assert.deepEqual(nas.hostnames, ['nas.lab.test']);
  assert.deepEqual(nas.macs, ['AA:00:00:00:00:05', 'AA:00:00:00:00:55']);
  assert.equal(nas.macChanged, true, 'two MACs under one address is worth reporting');
  assert.equal(nas.host.ports.length, 3, 'the record with the most ports wins');
  assert.ok(analysis.findings.some((finding) => /changed hardware/.test(finding.title)));

  const macLink = analysis.links.find((link) => link.kind === 'same-mac');
  assert.ok(macLink, 'a MAC at two addresses is one device');
  assert.deepEqual([macLink.a, macLink.b], ['10.0.0.5', '10.0.0.7']);
  assert.equal(analysis.stats.links['same-mac'], 1);
  assert.equal(
    analysis.links.filter((link) => link.kind === 'same-hostname').length,
    0,
    'the same pair is not linked twice',
  );
});

test('a shared PTR name links addresses that hardware does not', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml('nmap -sV -oX alias.xml 10.0.0.0/24', [
        { ip: '10.0.0.8', mac: 'AA:00:00:00:00:08', names: ['shared.lab.test'], ports: [[22, 'ssh']] },
        { ip: '10.0.0.9', mac: 'AA:00:00:00:00:09', names: ['shared.lab.test'], ports: [[80, 'http']] },
      ]),
      'alias.xml',
    ),
  );
  const analysis = analyzeConnections(doc);

  const nameLink = analysis.links.find((link) => link.kind === 'same-hostname');
  assert.ok(nameLink);
  assert.deepEqual([nameLink.a, nameLink.b], ['10.0.0.8', '10.0.0.9']);
  assert.equal(nameLink.label, 'same name');
});

test('the map layer copies the diagram and leaves the source layers alone', () => {
  const doc = importScanAsLayer(createDocFromScan(edgeScan()), edgeScan()).doc;
  const before = JSON.stringify(doc);
  const result = buildConnectLayer(doc, analyzeConnections(doc), DEFAULT_CONNECT_OPTIONS);

  assert.equal(JSON.stringify(doc), before, 'building the map never edits the document it reads');

  assert.equal(result.doc.layers.length, doc.layers.length + 1);
  assert.equal(result.layerName, 'Network map');
  const layer = result.doc.layers.at(-1);
  assert.equal(layer.id, result.layerId);
  assert.equal(layer.parentId, null);
  assert.equal(layer.visible, true);

  assert.equal(result.added, result.doc.nodes.length - doc.nodes.length);
  assert.deepEqual(result.doc.nodes.slice(0, doc.nodes.length), doc.nodes);
  assert.deepEqual(result.doc.edges.slice(0, doc.edges.length), doc.edges);

  const added = result.doc.nodes.slice(doc.nodes.length);
  assert.ok(added.length > 0);
  for (const node of added) assert.equal(node.layerId, result.layerId, `${node.id} belongs to the new layer`);

  const ids = new Set(result.doc.nodes.map((node) => node.id));
  assert.equal(ids.size, result.doc.nodes.length, 'ids stay unique in a copied layer');
  for (const edge of result.doc.edges) {
    assert.ok(ids.has(edge.source) && ids.has(edge.target), `edge ${edge.id} has both ends`);
  }

  const sections = added.filter((node) => node.kind === 'section');
  assert.equal(sections.length, 2);
  for (const section of sections) {
    const children = added.filter((child) => child.parentId === section.id);
    assert.ok(children.length > 0, 'a subnet frame holds its cards');
    for (const child of children) {
      assert.ok(child.position.x >= 0 && child.position.y >= 0, 'child coordinates are section-relative');
      assert.ok(child.position.x + 216 <= section.size.w, `${child.id} fits inside its frame`);
    }
  }

  const origin = added.find((node) => node.kind === 'origin');
  assert.ok(origin);
  const routers = added.filter((node) => node.kind === 'hop');
  assert.equal(routers.length, 1, '10.0.0.254 is not a scanned host, so it becomes a hop card');
  assert.equal(routers[0].address, '10.0.0.254');
  assert.ok(result.routes > 0);
});

test('the map draws observed routes and inferred links as different edges', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml('nmap -sV -oX mixed.xml 10.0.0.0/24', [
        ...EDGE_HOSTS,
        { ip: '10.0.0.30', mac: 'AA:00:00:00:00:05', vendor: 'Storage Inc', names: ['nas-old.lab.test'] },
      ]),
      'mixed.xml',
    ),
  );
  const analysis = analyzeConnections(doc);
  assert.equal(analysis.stats.joinable, 1, 'only 10.0.0.30 is joined by its subnet');
  const plain = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
  const addedEdges = plain.doc.edges.slice(doc.edges.length);

  assert.ok(
    addedEdges.some((edge) => edge.kind === 'route' && addedEdges.length > 0),
    'traced paths are route edges',
  );
  const subnet = addedEdges.find((edge) => edge.kind === 'link' && edge.label === 'subnet');
  assert.ok(subnet, '10.0.0.30 has no trace and is attached to the subnet gateway');
  const mac = addedEdges.find((edge) => edge.label === 'same MAC');
  assert.ok(mac, '10.0.0.30 shares a MAC with the NAS');

  const noLinks = buildConnectLayer(doc, analysis, { ...DEFAULT_CONNECT_OPTIONS, macLinks: false, subnetLinks: false });
  const bare = noLinks.doc.edges.slice(doc.edges.length);
  assert.equal(bare.length, analysis.stats.routes, 'only the observed routes remain');
  assert.ok(bare.every((edge) => edge.kind === 'route'));
});

test('a discovery-only diagram still gets a connected map', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      `<?xml version="1.0"?>
       <nmaprun scanner="nmap" args="nmap -sn -oX ping.xml 10.0.0.0/24" version="7.95">
         <host><status state="up"/><address addr="10.0.0.7" addrtype="ipv4"/></host>
         <host><status state="up"/><address addr="10.0.0.8" addrtype="ipv4"/><hostnames><hostname name="printer.lab.test"/></hostnames></host>
       </nmaprun>`,
      'ping.xml',
    ),
  );
  const analysis = analyzeConnections(doc);
  assert.equal(analysis.stats.hosts, 2);
  assert.equal(analysis.stats.routers, 0);
  assert.equal(analysis.stats.traced, 0);

  const result = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
  const added = result.doc.nodes.slice(doc.nodes.length);
  assert.equal(added.filter((node) => node.kind === 'host').length, 2);
  const links = result.doc.edges.slice(doc.edges.length).filter((edge) => edge.kind === 'link');
  assert.equal(links.length, 2);
  assert.ok(links.every((edge) => edge.label === 'on-link'), 'no router is named, so the origin is the anchor');

  // The cards keep the discovery-only flag: no ports appear out of nowhere.
  for (const node of added.filter((item) => item.kind === 'host')) {
    assert.equal(node.host.portsScanned, false);
    assert.deepEqual(node.host.ports, []);
  }
});

test('the map is deterministic and adding a second one collides with nothing', () => {
  const doc = importScanAsLayer(createDocFromScan(edgeScan()), edgeScan()).doc;
  const analysis = analyzeConnections(doc);
  const first = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
  const second = buildConnectLayer(doc, analyzeConnections(doc), DEFAULT_CONNECT_OPTIONS);

  assert.equal(
    JSON.stringify(first.doc.nodes.slice(doc.nodes.length)),
    JSON.stringify(second.doc.nodes.slice(doc.nodes.length)),
  );
  assert.equal(
    JSON.stringify(first.doc.edges.slice(doc.edges.length)),
    JSON.stringify(second.doc.edges.slice(doc.edges.length)),
  );

  const twice = buildConnectLayer(first.doc, analyzeConnections(first.doc), DEFAULT_CONNECT_OPTIONS);
  assert.equal(twice.doc.layers.length, doc.layers.length + 2);
  assert.equal(twice.layerName, 'Network map 2');
  assert.equal(new Set(twice.doc.nodes.map((node) => node.id)).size, twice.doc.nodes.length);
  assert.equal(new Set(twice.doc.layers.map((layer) => layer.id)).size, twice.doc.layers.length);
});

test('a card without an address is reported, not silently dropped', () => {
  const doc = createDocFromScan(edgeScan());
  const { doc: withBlank } = createNode(doc, 'host', { x: 40, y: 40 }, doc.layers[0].id);
  const analysis = analyzeConnections(withBlank);

  assert.equal(analysis.stats.hosts, 5, 'the blank card has no address to merge on');
  assert.equal(analysis.stats.unaddressed, 1);
  assert.ok(analysis.findings.some((finding) => /no address/.test(finding.title)));

  const result = buildConnectLayer(withBlank, analysis, DEFAULT_CONNECT_OPTIONS);
  assert.equal(result.doc.nodes.filter((node) => node.layerId === result.layerId && node.kind === 'host').length, 5);
});

test('a named router and a switch keep the subnet frame behind them', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml('nmap -sV -oX devices.xml 10.0.0.0/24', [
        {
          ip: '10.0.0.2',
          mac: 'BB:00:00:00:00:02',
          vendor: 'Cisco Systems',
          names: ['rtr-01.lab.test'],
          ports: [
            [22, 'ssh'],
            [53, 'domain'],
          ],
        },
        {
          ip: '10.0.0.10',
          mac: 'BB:00:00:00:00:10',
          vendor: 'Cisco Systems',
          names: ['sw-01.lab.test'],
          ports: [
            [22, 'ssh'],
            [23, 'telnet'],
            [80, 'http'],
          ],
        },
        { ip: '10.0.0.20', names: ['db-01.lab.test'], ports: [[5432, 'postgresql']] },
        { ip: '10.0.0.21', names: ['cache-01.lab.test'], ports: [[6379, 'redis']] },
      ]),
      'devices.xml',
    ),
  );
  const analysis = analyzeConnections(doc);

  assert.equal(analysis.routers.length, 0, 'no traceroute names a router');
  const segment = analysis.segments[0];
  assert.deepEqual(segment.devices, ['10.0.0.2']);
  assert.deepEqual(segment.switches, ['10.0.0.10']);
  assert.equal(segment.anchor, '10.0.0.10', 'the frame hangs from the switch');
  assert.equal(analysis.stats.devices, 1);
  assert.equal(analysis.stats.switches, 1);
  assert.ok(analysis.findings.some((finding) => finding.tone === 'device' && /switch/.test(finding.title)));

  const result = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
  const added = result.doc.nodes.slice(doc.nodes.length);
  const byIp = new Map(added.filter((node) => node.host).map((node) => [node.host.ip, node]));
  const section = added.find((node) => node.kind === 'section');

  assert.equal(byIp.get('10.0.0.2').parentId, undefined, 'the router is outside the frame');
  assert.equal(byIp.get('10.0.0.10').parentId, undefined, 'the switch is outside the frame');
  assert.equal(byIp.get('10.0.0.10').icon, 'switch');
  assert.equal(byIp.get('10.0.0.2').icon, 'router');
  assert.equal(byIp.get('10.0.0.20').parentId, section.id);
  assert.equal(byIp.get('10.0.0.21').parentId, section.id);

  // origin → router → switch → frame, left to right.
  assert.ok(byIp.get('10.0.0.10').position.x > byIp.get('10.0.0.2').position.x);
  assert.ok(section.position.x > byIp.get('10.0.0.10').position.x);

  const edges = result.doc.edges.slice(doc.edges.length);
  const between = (a, b) => edges.find((edge) => edge.source === a && edge.target === b);
  const originId = added.find((node) => node.kind === 'origin').id;
  assert.ok(between(originId, byIp.get('10.0.0.2').id), 'the router hangs off the origin');
  const chain = between(byIp.get('10.0.0.2').id, byIp.get('10.0.0.10').id);
  assert.ok(chain, 'the switch hangs off the router');
  assert.equal(chain.label, 'subnet');
  assert.equal(chain.line, 'dotted');
  assert.ok(between(byIp.get('10.0.0.10').id, byIp.get('10.0.0.20').id), 'cards join from the switch');
});

test('a traced gateway hands the frame to the switch behind it', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml('nmap -sV --traceroute -oX chain.xml 10.0.0.0/24', [
        {
          ip: '10.0.0.1',
          mac: 'CC:00:00:00:00:01',
          names: ['gw.lab.test'],
          ports: [[22, 'ssh']],
          trace: ['10.0.0.1'],
        },
        {
          ip: '10.0.0.10',
          mac: 'CC:00:00:00:00:10',
          names: ['sw-01.lab.test'],
          ports: [[23, 'telnet']],
          trace: ['10.0.0.10'],
        },
        {
          ip: '10.0.0.20',
          names: ['db-01.lab.test'],
          ports: [[5432, 'postgresql']],
          trace: ['10.0.0.1', '10.0.0.20'],
        },
      ]),
      'chain.xml',
    ),
  );
  const analysis = analyzeConnections(doc);
  const segment = analysis.segments[0];
  assert.equal(segment.gateway, '10.0.0.1');
  assert.deepEqual(segment.switches, ['10.0.0.10']);
  assert.equal(segment.anchor, '10.0.0.10');

  const result = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
  const added = result.doc.nodes.slice(doc.nodes.length);
  const byIp = new Map(added.filter((node) => node.host).map((node) => [node.host.ip, node]));
  const section = added.find((node) => node.kind === 'section');
  assert.equal(byIp.get('10.0.0.10').parentId, undefined);
  assert.ok(section.position.x > byIp.get('10.0.0.10').position.x);
  assert.ok(byIp.get('10.0.0.10').position.x > byIp.get('10.0.0.1').position.x, 'the switch sits after the gateway');

  const edges = result.doc.edges.slice(doc.edges.length);
  assert.ok(
    edges.some((edge) => edge.source === byIp.get('10.0.0.1').id && edge.target === byIp.get('10.0.0.10').id),
    'the gateway feeds the switch',
  );
});

test('an OS guess on its own does not turn a card into network gear', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml('nmap -O -oX os.xml 10.0.0.0/24', [
        {
          ip: '10.0.0.30',
          names: ['vm-01.lab.test'],
          ports: [[22, 'ssh']],
          os: [
            ['Linux 5.15', 100],
            ['MikroTik RouterOS 7.2 (Linux 5.6.3)', 100],
          ],
        },
        {
          ip: '10.0.0.31',
          names: ['vm-02.lab.test'],
          ports: [[22, 'ssh']],
          os: [['MikroTik RouterOS 7.2 (Linux 5.6.3)', 100]],
        },
      ]),
      'os.xml',
    ),
  );
  const analysis = analyzeConnections(doc);
  const byIp = new Map(analysis.hosts.map((host) => [host.ip, host]));

  assert.equal(byIp.get('10.0.0.30').role, 'host', 'the guess is tied with a plain Linux kernel');
  assert.equal(byIp.get('10.0.0.31').role, 'router', 'an unmatched RouterOS guess is evidence');
});

test('a router reached over another subnet is one card with a WAN and a LAN address', () => {
  // The ASUS shape: a router whose LAN is 10.0.0.1 answers on the upstream wire as
  // 192.168.5.10, where every client trace ends at its LAN address. The two
  // addresses share the services only that box runs, so they are one device, and
  // the upstream router at .1 becomes its parent.
  const scan = parseNmapXml(
    scanXml('nmap -sV --traceroute -oX two-tier.xml 10.0.0.0/24', [
      { ip: '192.168.5.1', names: ['rtr-outer.lab.test'], ports: [[53, 'domain'], [80, 'http']] },
      {
        ip: '192.168.5.10',
        names: ['gw-wan.lab.test'],
        ports: [
          [80, 'http'],
          [7788, 'http'],
          [18017, 'http'],
          [38333, 'upnp'],
        ],
      },
      {
        ip: '10.0.0.1',
        names: ['gw-lan.lab.test'],
        ports: [
          [53, 'domain'],
          [80, 'http'],
          [7788, 'http'],
          [18017, 'http'],
          [38333, 'upnp'],
        ],
        trace: ['10.0.0.1'],
      },
      { ip: '10.0.0.20', mac: 'AA:00:00:00:00:20', names: ['nas.lab.test'], ports: [[445, 'microsoft-ds']], trace: ['10.0.0.1', '10.0.0.20'] },
      { ip: '192.168.5.30', names: ['tv.lab.test'], ports: [[80, 'http']], trace: ['10.0.0.1'] },
    ]),
    'two-tier.xml',
  );

  const doc = createDocFromScan(scan);
  assert.equal(
    doc.nodes.filter((node) => node.kind === 'host').length,
    5,
    'the source layer still has a card per scanned address',
  );

  const analysis = analyzeConnections(doc);
  const router = hostByIp(analysis, '10.0.0.1');
  assert.deepEqual(router.addresses, ['10.0.0.1', '192.168.5.10']);
  assert.equal(hostByIp(analysis, '192.168.5.10'), undefined, 'the WAN address is folded into the router');
  assert.equal(analysis.stats.pairs, 1);
  assert.deepEqual(analysis.routers.map((entry) => [entry.ip, entry.depth, entry.parent]), [
    ['10.0.0.1', 2, '192.168.5.1'],
  ]);

  // The upstream wire owns the router: its LAN address is one hop in from it.
  const upstream = analysis.segments.find((segment) => segment.cidr === '192.168.5.0/24');
  assert.equal(upstream.gateway, '10.0.0.1');
  assert.deepEqual(upstream.devices, ['192.168.5.1']);
  assert.deepEqual(upstream.chain, ['192.168.5.1', '10.0.0.1']);
  assert.equal(upstream.anchor, '192.168.5.1');

  const inner = analysis.segments.find((segment) => segment.cidr === '10.0.0.0/24');
  assert.deepEqual(inner.chain, ['10.0.0.1'], 'the LAN wire hangs off the router');

  const map = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
  const nodes = map.doc.nodes.filter((node) => node.layerId === map.layerId);
  const card = nodes.find((node) => node.host?.ip === '10.0.0.1');
  assert.match(card.subtitle, /^192\.168\.5\.10/, 'the card leads with the address the scan cannot label');
  assert.equal(nodes.filter((node) => node.host?.ip === '192.168.5.10').length, 0);
  assert.ok(
    map.doc.edges.some(
      (edge) => edge.kind === 'route' && edge.source === 'map:host:192.168.5.1' && edge.target === 'map:host:10.0.0.1',
    ),
    'the outer router is chained to the one it hands an address to',
  );
});

// The scans the feature was designed against live outside the app; when they are
// not in this checkout the rest of the suite still runs.
const SANITIZED = path.join(APP_ROOT, '..', 'sanitized-test-data');
const hasSanitized = existsSync(path.join(SANITIZED, 'scan-01.xml')) && existsSync(path.join(SANITIZED, 'scan-14.xml'));
const hasTwoTier = ['scan-16.xml', 'scan-17.xml', 'scan-18.xml', 'scan-19.xml'].every((name) =>
  existsSync(path.join(SANITIZED, name)),
);

test(
  'the sanitized scans produce routes through their gateways',
  { skip: hasSanitized ? false : 'sanitized-test-data is not in this checkout' },
  () => {
    const read = (name) => readFileSync(path.join(SANITIZED, name), 'utf8');
    const first = parseNmapXml(read('scan-01.xml'), 'scan-01.xml');
    const second = parseNmapXml(read('scan-14.xml'), 'scan-14.xml');
    const doc = importScanAsLayer(createDocFromScan(first), second).doc;
    const analysis = analyzeConnections(doc);

    assert.ok(analysis.stats.hosts >= 14, `expected the /24 cards, saw ${analysis.stats.hosts}`);
    assert.ok(analysis.routers.length >= 1, 'the traces name at least one router');

    for (const segment of analysis.segments) {
      if (segment.hosts.length === 0) continue;
      assert.ok(segment.gateway, `${segment.cidr} is placed behind a router`);
      assert.ok(
        analysis.stats.untraced === 0 || segment.evidence !== 'none',
        `${segment.cidr} says how its gateway was found`,
      );
    }

    const result = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
    assert.ok(result.routes > 0);
    assert.ok(result.added > analysis.stats.hosts);
  },
);

test(
  'a router with a WAN and a LAN address is one card, outside the subnet it serves',
  { skip: hasTwoTier ? false : 'sanitized-test-data is not in this checkout' },
  () => {
    const read = (name) => readFileSync(path.join(SANITIZED, name), 'utf8');
    // Two sweeps per network: the -sC one carries the traceroute, the full-port one
    // the service fingerprints that prove 10.1.1.222 and 192.168.69.111 are one box.
    let doc = createDocFromScan(parseNmapXml(read('scan-16.xml'), 'scan-16.xml'));
    for (const name of ['scan-17.xml', 'scan-18.xml', 'scan-19.xml']) {
      doc = mergeScanIntoDoc(doc, parseNmapXml(read(name), name)).doc;
    }

    const addresses = doc.nodes
      .filter((node) => node.kind === 'host' || node.kind === 'hop')
      .map((node) => (node.kind === 'host' ? node.host.ip : node.address));
    assert.deepEqual(
      addresses.filter((ip, index) => addresses.indexOf(ip) !== index),
      [],
      'every address is drawn once',
    );

    const card = doc.nodes.find((node) => node.id === 'host:10.1.1.222');
    assert.equal(card.kind, 'host');
    assert.equal(card.depth, 1, 'the card sits in the route lane');
    assert.ok(card.host.hostnames.includes('RT-AX55-1650.MedaVerse'));
    assert.ok(card.host.hops.length > 0, 'a ports-only sweep did not erase the traceroute');

    const analysis = analyzeConnections(doc);
    const router = hostByIp(analysis, '10.1.1.222');
    const outer = hostByIp(analysis, '192.168.69.222');
    assert.equal(router.role, 'router');
    assert.deepEqual(router.addresses, ['10.1.1.222', '192.168.69.111'], 'one box, both addresses');
    assert.equal(hostByIp(analysis, '192.168.69.111'), undefined, 'the WAN address is not a card of its own');
    assert.equal(analysis.stats.pairs, 1);
    assert.ok(
      analysis.findings.some((finding) => /one router/.test(finding.title)),
      'the preview says what was merged and why',
    );

    // The WAN side lives on 192.168.69.0/24, so that wire is upstream of the ASUS.
    assert.deepEqual(analysis.routers.map((entry) => [entry.ip, entry.depth, entry.parent]), [
      ['10.1.1.222', 2, '192.168.69.222'],
    ]);
    assert.equal(outer.role, 'router', 'the Sagemcom certificate names the outside router');

    const clientNet = analysis.segments.find((segment) => segment.cidr === '192.168.69.0/24');
    assert.equal(clientNet.gateway, '10.1.1.222');
    assert.deepEqual(clientNet.devices, ['192.168.69.222']);
    assert.deepEqual(clientNet.chain, ['192.168.69.222', '10.1.1.222'], 'outside router first');
    assert.equal(clientNet.anchor, '192.168.69.222', 'the clients sit on the outside router\'s wire');

    // The /22 is drawn as four /24s; the router the scan found fronts all of them.
    for (const cidr of ['10.1.2.0/24', '10.1.3.0/24']) {
      const segment = analysis.segments.find((entry) => entry.cidr === cidr);
      assert.equal(segment.gateway, '10.1.1.222');
      assert.equal(segment.evidence, 'site');
    }

    assert.equal(analysis.stats.virtual, 5, 'the Proxmox guests are counted');
    assert.deepEqual(analysis.stats.platforms, [{ platform: 'Proxmox VE', count: 5 }]);

    const result = buildConnectLayer(doc, analysis, DEFAULT_CONNECT_OPTIONS);
    const mapNodes = result.doc.nodes.filter((node) => node.layerId === result.layerId);
    const id = (address) => `map:host:${address}`;
    const asus = mapNodes.find((node) => node.id === id('10.1.1.222'));
    assert.ok(asus && !asus.parentId, 'the inner router is outside a frame');
    assert.match(asus.subtitle, /192\.168\.69\.111/, 'the card names its WAN address too');
    assert.equal(mapNodes.filter((node) => node.id === id('192.168.69.111')).length, 0, 'the WAN address is not a second card');

    // origin → outside router → the ASUS it hands an address to.
    assert.ok(
      result.doc.edges.some((edge) => edge.kind === 'route' && edge.source === 'map:origin' && edge.target === id('192.168.69.222')),
      'the outside router is reached from the origin',
    );
    assert.ok(
      result.doc.edges.some((edge) => edge.kind === 'route' && edge.source === id('192.168.69.222') && edge.target === id('10.1.1.222')),
      'the two routers are chained',
    );

    const inner = mapNodes.find((node) => node.host?.ip === '10.1.1.222');
    const frames = mapNodes.filter((node) => node.kind === 'section');
    const clientFrame = frames.find((node) => node.cidr === '192.168.69.0/24');
    const innerFrame = frames.find((node) => node.cidr === '10.1.1.0/24');
    assert.ok(clientFrame.position.x < innerFrame.position.x, 'the outside wire is drawn before the inner subnets');
    assert.ok(innerFrame.position.x > inner.position.x, 'the inner subnets hang right of the ASUS');
    assert.deepEqual(
      mapNodes.filter((node) => node.parentId === clientFrame.id).map((node) => node.host.ip).sort(),
      ['192.168.69.36', '192.168.69.62', '192.168.69.71', '192.168.69.115', '192.168.69.139', '192.168.69.140', '192.168.69.147', '192.168.69.148', '192.168.69.215'].sort(),
      'the clients stay inside the frame, the two routers do not',
    );

    // The map is an ordinary diagram, so the pictures must carry it.
    const focused = { ...result.doc, focusedLayerId: result.layerId };
    const pictures = [toMermaid(focused, defaultRiskPolicy()), toDrawio(focused, defaultRiskPolicy()), toSvg(focused, defaultRiskPolicy()).svg];
    for (const picture of pictures) {
      assert.ok(picture.includes('10.1.1.222') && picture.includes('192.168.69.222'), 'both routers are drawn');
      assert.ok(picture.includes('192.168.69.111'), 'the WAN address travels on the one card');
    }
  },
);
