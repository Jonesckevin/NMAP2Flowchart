import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDesignFile, readDesignFile } from '../src/doc/designFile';
import { createDocFromScan } from '../src/doc/docFromScan';
import { defaultRiskPolicy } from '../src/doc/risk';
import { toDrawio } from '../src/export/drawio';
import { toMermaid } from '../src/export/mermaid';
import { toSvg } from '../src/export/svg';
import { iconEmoji } from '../src/icons/registry';
import { classifyHost, routedIcon, withHopEvidence } from '../src/model/device';
import { parseNmapXml } from '../src/nmap/parseNmapXml';

/**
 * nmap's own device signatures: `<osclass type>`, `-sV`'s devicetype/ostype, CPE
 * identifiers and NSE output. These tests pin what the parser keeps and what the
 * shared classifier makes of it, because the icons and the map roles both read it.
 */

function hostXml({ ip, mac, vendor, names = [], ports = [], os = [], scripts = [] }) {
  const addresses = [`<address addr="${ip}" addrtype="ipv4"/>`];
  if (mac) addresses.push(`<address addr="${mac}" addrtype="mac" vendor="${vendor ?? 'Test Vendor'}"/>`);
  const hostnames = names.length
    ? `<hostnames>${names.map((name) => `<hostname name="${name}" type="PTR"/>`).join('')}</hostnames>`
    : '';
  const portList = ports.length
    ? `<ports>${ports
        .map((port) => {
          const attributes = [
            port.product ? `product="${port.product}"` : '',
            port.version ? `version="${port.version}"` : '',
            port.ostype ? `ostype="${port.ostype}"` : '',
            port.devicetype ? `devicetype="${port.devicetype}"` : '',
          ]
            .filter(Boolean)
            .join(' ');
          const cpes = (port.cpe ?? []).map((cpe) => `<cpe>${cpe}</cpe>`).join('');
          return `<port protocol="tcp" portid="${port.port}"><state state="open"/><service name="${port.service ?? 'unknown'}" ${attributes}>${cpes}</service></port>`;
        })
        .join('')}</ports>`
    : '';
  const osBlock = os.length
    ? `<os>${os
        .map(
          (match) =>
            `<osmatch name="${match.name}" accuracy="${match.accuracy}">${(match.classes ?? [])
              .map(
                (cls) =>
                  `<osclass type="${cls.type}" vendor="${cls.vendor ?? ''}" osfamily="${cls.osfamily ?? ''}" accuracy="${cls.accuracy ?? match.accuracy}"/>`,
              )
              .join('')}</osmatch>`,
        )
        .join('')}</os>`
    : '';
  const hostScripts = scripts.length
    ? `<hostscript>${scripts
        .map((script) => `<script id="${script.id}" output="${script.output.replace(/"/g, '&quot;').replace(/\n/g, '&#xa;')}"/>`)
        .join('')}</hostscript>`
    : '';
  return `  <host><status state="up"/>
    ${addresses.join('\n    ')}
    ${hostnames}
    ${portList}
    ${osBlock}
    ${hostScripts}
  </host>`;
}

function scanXml(hosts) {
  return `<?xml version="1.0"?>
<nmaprun scanner="nmap" args="nmap -sV -O -oX signatures.xml 10.0.0.0/24" version="7.95">
${hosts.map(hostXml).join('\n')}
</nmaprun>`;
}

const hostByIp = (scan, ip) => scan.hosts.find((host) => host.ip === ip);

test('the parser keeps osclass, devicetype, ostype and CPE identifiers', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '10.0.0.2',
        ports: [
          {
            port: 22,
            service: 'ssh',
            product: 'Cisco IOS sshd',
            ostype: 'Linux',
            devicetype: 'router',
            cpe: ['cpe:/o:cisco:ios:15.2'],
          },
        ],
        os: [
          {
            name: 'Cisco IOS 15.2 (Catalyst 2960 series)',
            accuracy: 98,
            classes: [{ type: 'switch', vendor: 'Cisco', osfamily: 'IOS', accuracy: 98 }],
          },
        ],
      },
    ]),
    'signatures.xml',
  );

  const host = hostByIp(scan, '10.0.0.2');
  assert.deepEqual(host.os.map((match) => match.name), ['Cisco IOS 15.2 (Catalyst 2960 series)']);
  assert.deepEqual(host.os[0].classes, [{ type: 'switch', vendor: 'Cisco', osfamily: 'IOS', osgen: undefined, accuracy: 98 }]);
  assert.equal(host.ports[0].devicetype, 'router');
  assert.equal(host.ports[0].ostype, 'Linux');
  assert.deepEqual(host.ports[0].cpe, ['cpe:/o:cisco:ios:15.2']);
});

test('an osclass category decides what the box is', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '10.0.0.2',
        os: [
          {
            name: 'Cisco IOS 15.2 (Catalyst 2960 series)',
            accuracy: 98,
            classes: [{ type: 'switch', vendor: 'Cisco', osfamily: 'IOS', accuracy: 98 }],
          },
        ],
      },
      {
        ip: '10.0.0.3',
        os: [
          {
            name: 'Linux 5.15 - 5.19',
            accuracy: 100,
            classes: [{ type: 'general purpose', vendor: 'Linux', osfamily: 'Linux', accuracy: 100 }],
          },
          {
            name: 'MikroTik RouterOS 7.2 (Linux 5.6.3)',
            accuracy: 100,
            classes: [{ type: 'router', vendor: 'MikroTik', osfamily: 'RouterOS', accuracy: 100 }],
          },
        ],
      },
    ]),
    'signatures.xml',
  );

  const managedSwitch = classifyHost(hostByIp(scan, '10.0.0.2'));
  assert.equal(managedSwitch.kind, 'switch');
  assert.equal(managedSwitch.os, 'network');
  assert.equal(managedSwitch.strongKind, true);
  assert.equal(managedSwitch.signatureKind, true);
  assert.match(managedSwitch.kindEvidence[0].detail, /osclass “switch”/);

  // The RouterOS guess is tied with a plain Linux kernel – the tie nmap reports
  // for plenty of VMs – so it is not allowed to name the box.
  const virtualMachine = classifyHost(hostByIp(scan, '10.0.0.3'));
  assert.notEqual(virtualMachine.kind, 'router');
});

test('a service devicetype and ostype name the box and its platform', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '10.0.0.10',
        ports: [
          { port: 80, service: 'http', product: 'HP LaserJet 4250', devicetype: 'printer', ostype: 'embedded' },
          { port: 631, service: 'ipp' },
        ],
      },
      {
        ip: '10.0.0.11',
        ports: [{ port: 3389, service: 'ms-wbt-server', ostype: 'Windows' }],
      },
    ]),
    'signatures.xml',
  );

  const printer = classifyHost(hostByIp(scan, '10.0.0.10'));
  assert.equal(printer.kind, 'printer');
  assert.equal(printer.signatureKind, true);

  const desktop = classifyHost(hostByIp(scan, '10.0.0.11'));
  assert.equal(desktop.os, 'windows');
});

test('NSE output is read: smb-os-discovery names Windows, snmp-sysdescr names a switch', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '10.0.0.20',
        ports: [{ port: 445, service: 'microsoft-ds' }],
        scripts: [
          {
            id: 'smb-os-discovery',
            output: 'OS: Windows Server 2019 Standard 17763\nComputer name: DC01\nDomain name: lab.test\nFQDN: dc01.lab.test',
          },
        ],
      },
      {
        ip: '10.0.0.21',
        ports: [{ port: 161, service: 'snmp' }],
        scripts: [
          {
            id: 'snmp-sysdescr',
            output: 'sysDescr: Cisco IOS Software, C2960S Software (C2960S-UNIVERSALK9-M), Version 15.2(2)E9',
          },
        ],
      },
    ]),
    'signatures.xml',
  );

  const windowsServer = classifyHost(hostByIp(scan, '10.0.0.20'));
  assert.equal(windowsServer.os, 'windows');
  assert.equal(windowsServer.kind, 'server');

  const catalyst = classifyHost(hostByIp(scan, '10.0.0.21'));
  assert.equal(catalyst.kind, 'switch');
});

test('a CPE hardware identifier and an OUI vendor fill in what the banners do not', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '10.0.0.30',
        ports: [
          {
            port: 443,
            service: 'https',
            product: 'camera web UI',
            cpe: ['cpe:/h:hikvision:ds-2cd2143g0-i'],
          },
        ],
      },
      {
        ip: '10.0.0.31',
        mac: 'AA:BB:CC:00:00:31',
        vendor: 'Brother Industries',
        ports: [{ port: 515, service: 'printer' }],
      },
    ]),
    'signatures.xml',
  );

  assert.equal(classifyHost(hostByIp(scan, '10.0.0.30')).kind, 'camera');
  const brother = classifyHost(hostByIp(scan, '10.0.0.31'));
  assert.equal(brother.kind, 'printer');
  assert.ok(brother.kindEvidence.some((entry) => entry.source === 'vendor'));
});

test('a router names itself in its hostname, its model or its certificate', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '10.1.1.222',
        mac: 'AA:BB:CC:00:01:22',
        vendor: 'ASUSTek COMPUTER INC.',
        names: ['RT-AX55-1650.lab.test'],
        ports: [
          { port: 80, service: 'http', product: 'httpd', ostype: 'Linux' },
          { port: 18017, service: 'http', product: 'Asus wanduck WAN monitor httpd' },
        ],
      },
      {
        ip: '192.168.69.222',
        ports: [{ port: 443, service: 'https' }, { port: 53, service: 'domain' }],
        scripts: [
          {
            id: 'ssl-cert',
            output:
              "Subject: commonName=SAGEMCOM F@st 3896/organizationName=Sagemcom SAS/countryName=FR\nIssuer: commonName=SAGEMCOM F@st 3896/organizationName=Sagemcom SAS/countryName=FR",
          },
        ],
      },
    ]),
    'signatures.xml',
  );

  const asus = classifyHost(hostByIp(scan, '10.1.1.222'));
  assert.equal(asus.kind, 'router');
  assert.equal(asus.strongKind, true);

  const sagemcom = classifyHost(hostByIp(scan, '192.168.69.222'));
  assert.equal(sagemcom.kind, 'router');
  assert.ok(sagemcom.kindEvidence.some((entry) => /ssl-cert: Sagemcom/.test(entry.detail)));
});

test('a virtual NIC says which hypervisor the guest belongs to', () => {
  const scan = parseNmapXml(
    scanXml([
      { ip: '10.1.3.80', mac: 'BC:24:11:37:8F:1A', vendor: 'Unknown', ports: [{ port: 80, service: 'http' }] },
      { ip: '10.1.3.22', mac: 'AA:BB:CC:00:03:22', vendor: 'Super Micro Computer', ports: [{ port: 8006, service: 'http' }] },
    ]),
    'signatures.xml',
  );

  assert.equal(classifyHost(hostByIp(scan, '10.1.3.80')).virtual, 'Proxmox VE');
  assert.equal(classifyHost(hostByIp(scan, '10.1.3.22')).virtual, undefined, 'bare metal has no virtual NIC');
});

test('a media server and a Hyper-V console are named by their own services', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        ip: '192.168.69.111',
        ports: [{ port: 32400, service: 'http', product: 'Plex Media Server httpd' }],
      },
      {
        ip: '10.1.3.159',
        ports: [{ port: 2179, service: 'vmrdp' }],
      },
    ]),
    'signatures.xml',
  );

  assert.equal(classifyHost(hostByIp(scan, '192.168.69.111')).kind, 'media');
  assert.equal(classifyHost(hostByIp(scan, '10.1.3.159')).kind, 'hypervisor');
});

test('a guest card is drawn and exported as a virtual machine', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml([{ ip: '10.1.3.80', mac: 'BC:24:11:37:8F:1A', vendor: 'Unknown', ports: [{ port: 80, service: 'http' }] }]),
      'vm.xml',
    ),
  );

  const card = doc.nodes.find((node) => node.kind === 'host');
  assert.equal(card.icon, 'vm', 'the card uses the virtual machine icon');

  // The marker has to survive into the pictures, not only the canvas.
  const mermaid = toMermaid(doc, defaultRiskPolicy());
  assert.match(mermaid, /10\.1\.3\.80 \(VM\)/);
  assert.ok(mermaid.includes(iconEmoji('vm')), 'the icon travels as its glyph');
  const drawio = toDrawio(doc, defaultRiskPolicy());
  assert.match(drawio, /10\.1\.3\.80 \(VM\)/);
  const svg = toSvg(doc, defaultRiskPolicy()).svg;
  assert.match(svg, />VM<\/text>/, 'the picture carries a VM chip');
});

test('router firmware in a banner outranks the device type a UPnP description declares', () => {
  const scan = parseNmapXml(
    scanXml([
      {
        // The ASUS shape: its own UPnP service says `devicetype="WAP"`, while the
        // banners name the firmware that only ships on a router.
        ip: '192.168.69.111',
        ports: [
          { port: 18017, service: 'http', product: 'Asus wanduck WAN monitor httpd' },
          { port: 38333, service: 'upnp', product: 'MiniUPnP', version: '2.2.0', extrainfo: 'AsusWRT 386; UPnP 1.1', devicetype: 'WAP' },
          { port: 32400, service: 'plex' },
        ],
      },
      {
        // A NAS that happens to advertise UPnP is not a router.
        ip: '10.0.0.60',
        ports: [
          { port: 5000, service: 'http', product: 'Synology DSM' },
          { port: 1900, service: 'upnp', product: 'MiniUPnPd', devicetype: 'NAS' },
        ],
      },
    ]),
    'signatures.xml',
  );

  const router = classifyHost(hostByIp(scan, '192.168.69.111'));
  assert.equal(router.kind, 'router');
  assert.equal(router.strongKind, true, 'the firmware the vendor signed is categorical');
  assert.ok(router.kindEvidence.some((entry) => entry.source === 'firmware'));

  assert.notEqual(classifyHost(hostByIp(scan, '10.0.0.60')).kind, 'router');
});

test('a device a traceroute passes through is network gear, whatever else it serves', () => {
  // The Plex server that also fronts a subnet: the trace proves it forwards, so it
  // is a router on the map – the media evidence stays in the list.
  const host = (ip, extra = '') => `<host><status state="up"/><address addr="${ip}" addrtype="ipv4"/>${extra}</host>`;
  const traced = `<ports><port protocol="tcp" portid="1024"><state state="open"/><service name="http" product="Plex Media Server httpd"/></port></ports>
    <hostscript><script id="http-favicon" output="Plex"/></hostscript>`;
  const scan = parseNmapXml(
    `<nmaprun args="nmap -sV -sC -O --traceroute -oX traced.xml 10.0.0.0/24">
      ${host('10.0.0.1', `${traced}<hostnames><hostname name="rt-ax55.lab"/></hostnames>`)}
      ${host('10.0.0.40', '<trace><hop ttl="1" ipaddr="10.0.0.1"/><hop ttl="2" ipaddr="10.0.0.40"/></trace>')}
    </nmaprun>`,
    'traced.xml',
  );

  const hop = scan.hosts.find((entry) => entry.ip === '10.0.0.1');
  const profile = withHopEvidence(classifyHost(hop));
  assert.equal(profile.kind, 'router');
  assert.equal(profile.strongKind, true);
  assert.ok(profile.kindEvidence.some((evidence) => evidence.source === 'hop'));
  assert.ok(
    profile.kindEvidence.some((evidence) => /Plex/.test(evidence.detail)),
    'what else it serves is still reported',
  );

  // A box the traces never pass through keeps its own reading.
  const other = scan.hosts.find((entry) => entry.ip === '10.0.0.40');
  assert.notEqual(classifyHost(other).kind, 'router');
  assert.equal(routedIcon(hop), 'router', 'the hop card wears a network icon');
});

test('a design file keeps the signature fields so a reopened diagram still knows', () => {
  const doc = createDocFromScan(
    parseNmapXml(
      scanXml([
        {
          ip: '10.0.0.2',
          ports: [
            {
              port: 22,
              service: 'ssh',
              ostype: 'Linux',
              devicetype: 'router',
              cpe: ['cpe:/o:cisco:ios:15.2'],
            },
          ],
          os: [
            {
              name: 'Cisco IOS 15.2 (Catalyst 2960 series)',
              accuracy: 98,
              classes: [{ type: 'switch', vendor: 'Cisco', osfamily: 'IOS', accuracy: 98 }],
            },
          ],
        },
      ]),
      'signatures.xml',
    ),
  );

  const result = readDesignFile(JSON.stringify(buildDesignFile(doc)));
  assert.equal(result.ok, true);
  const reopened = result.doc.nodes.find((node) => node.kind === 'host');
  assert.deepEqual(reopened.host.os[0].classes, [
    { type: 'switch', vendor: 'Cisco', osfamily: 'IOS', osgen: undefined, accuracy: 98 },
  ]);
  assert.equal(reopened.host.ports[0].devicetype, 'router');
  assert.equal(reopened.host.ports[0].ostype, 'Linux');
  assert.deepEqual(reopened.host.ports[0].cpe, ['cpe:/o:cisco:ios:15.2']);
  assert.equal(classifyHost(reopened.host).kind, 'switch');
});
