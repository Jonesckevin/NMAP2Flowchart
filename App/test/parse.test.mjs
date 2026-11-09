import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNmapXml } from '../src/nmap/parseNmapXml';
import { discoveryOnly, openPorts } from '../src/model/types';
import { SAMPLE_FILE_NAME, SAMPLE_SCAN_XML } from '../src/data/sampleScan';

const scan = (body, args = 'nmap -oX scan.xml 10.0.0.0/24') =>
  `<?xml version="1.0"?>\n<nmaprun scanner="nmap" args="${args}" version="7.95">${body}</nmaprun>`;

test('the bundled sample scan parses completely', () => {
  const parsed = parseNmapXml(SAMPLE_SCAN_XML, SAMPLE_FILE_NAME);

  assert.equal(parsed.fileName, SAMPLE_FILE_NAME);
  assert.equal(parsed.hosts.length, 12);
  assert.match(parsed.args ?? '', /-sV -sC --traceroute -oX/);
  assert.equal(parsed.version, '7.95');
  assert.ok(parsed.startedAt?.endsWith('Z'));
  assert.ok((parsed.elapsedSeconds ?? 0) > 0);
  assert.ok((parsed.trace?.length ?? 0) > 0, 'traceroute hops are collected across hosts');

  const hosts = new Map(parsed.hosts.map((host) => [host.ip, host]));
  const db = hosts.get('10.0.0.40');
  assert.ok(db, 'the sample includes 10.0.0.40');
  assert.deepEqual(
    openPorts(db).map((port) => port.port),
    [135, 445, 3389],
  );
  assert.equal(db.hostnames[0], 'ws-office.lab.internal');
  assert.match(db.os[0]?.name ?? '', /Windows/);
  assert.equal(db.portsScanned, true);
  assert.ok(db.ports.some((port) => port.scripts.length > 0), 'NSE output is kept');

  for (const host of parsed.hosts) {
    const ports = host.ports.map((port) => port.port);
    assert.deepEqual(ports, [...ports].sort((a, b) => a - b), `${host.ip} ports are sorted`);
  }
});

test('discovery-only scans keep portsScanned false', () => {
  const parsed = parseNmapXml(
    scan(
      `<host><status state="up"/><address addr="10.0.0.7" addrtype="ipv4"/>
        <address addr="AA:BB:CC:DD:EE:FF" addrtype="mac" vendor="Acme"/>
        <hostnames><hostname name="printer.lab"/></hostnames></host>`,
      'nmap -sn -oX ping.xml 10.0.0.0/24',
    ),
  );

  const [host] = parsed.hosts;
  assert.equal(host.portsScanned, false);
  assert.equal(discoveryOnly(host), true);
  assert.deepEqual(openPorts(host), []);
  assert.equal(host.mac, 'AA:BB:CC:DD:EE:FF');
  assert.equal(host.vendor, 'Acme');
});

test('hosthint entries are imported as discovered, never as port-scanned', () => {
  const parsed = parseNmapXml(
    scan(`
      <host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/></host>
      <hosthint><status state="up"/><address addr="10.0.0.9" addrtype="ipv4"/></hosthint>`),
  );

  assert.deepEqual(
    parsed.hosts.map((host) => `${host.ip}:${host.portsScanned}`),
    ['10.0.0.5:false', '10.0.0.9:false'],
  );
});

test('numeric character references are decoded in text and attributes', () => {
  const parsed = parseNmapXml(
    scan(
      `<host><status state="up"/><address addr="10.0.0.8" addrtype="ipv4"/>
        <hostnames><hostname name="caf&#233;.lab"/></hostnames>
        <ports><port protocol="tcp" portid="22"><state state="open"/>
          <service name="ssh" product="Open&#83;SH"/></port></ports></host>`,
    ),
  );

  const [host] = parsed.hosts;
  assert.equal(host.hostnames[0], 'café.lab');
  assert.equal(host.ports[0].product, 'OpenSSH');
});

test('a DOCTYPE and duplicate addresses do not break the import', () => {
  const xml =
    '<?xml version="1.0"?><!DOCTYPE nmaprun [ <!ELEMENT nmaprun ANY> ]>' +
    scan(
      `<host><status state="up"/><address addr="10.0.0.4" addrtype="ipv4"/></host>
       <host><status state="up"/><address addr="10.0.0.4" addrtype="ipv4"/></host>`,
    ).replace(/^<\?xml[^>]*\?>\s*\n?/, '');

  assert.equal(parseNmapXml(xml).hosts.length, 1);
});

test('an entity-expansion scan cannot stall the import', () => {
  const entity = (name, body) => `<!ENTITY ${name} "${body}">`;
  const body = Array.from({ length: 9 }, (_, level) =>
    entity(`l${level}`, level === 0 ? 'lol' : `&l${level - 1};`.repeat(10)),
  ).join('');
  const bomb = `<?xml version="1.0"?><!DOCTYPE nmaprun [${body}]>${scan(
    `<host><status state="up"/><address addr="&l8;" addrtype="ipv4"/></host>`,
  ).replace(/^<\?xml[^>]*\?>\s*\n?/, '')}`;

  const started = Date.now();
  let result;
  try {
    result = { hosts: parseNmapXml(bomb, 'bomb.xml').hosts.length };
  } catch (error) {
    result = { message: error.message };
  }
  assert.ok(Date.now() - started < 1000, 'the DTD is stripped, not expanded');
  if ('message' in result) assert.match(result.message, /valid XML|nmaprun/);
  else assert.equal(result.hosts, 1, 'whatever is left of the scan still imports');
});

test('unreadable scans fail with an actionable message', () => {
  assert.throws(() => parseNmapXml('<html><body/></html>'), /No <nmaprun> root element/);

  assert.throws(
    () => parseNmapXml(scan('', 'nmap -sn -oX ping.xml 10.0.0.0/24')),
    /A ping scan only lists hosts that answer/,
  );
  assert.throws(() => parseNmapXml(scan('')), /Try nmap with -Pn/);
});
