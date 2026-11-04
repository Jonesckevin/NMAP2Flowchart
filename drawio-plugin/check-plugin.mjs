#!/usr/bin/env node
/**
 * Release check for the draw.io plugin.
 *
 * The plugin has no build step — it is mounted into draw.io as-is — so there is
 * nothing to compile. What can go wrong is drift: it mirrors the app's risk
 * tiers, layout numbers and cell styles, and the bundled sample scan has to keep
 * parsing. This script loads the plugin the way the browser would, then compares
 * it against App/ and the sample. `build-release.ps1` runs it before packaging.
 *
 *   node drawio-plugin/check-plugin.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pluginPath = join(here, 'plugins', 'nmap2drawio.js');
const samplePath = join(here, 'samples', 'lab-scan.xml');
const appRiskPath = join(root, 'App', 'src', 'doc', 'risk.ts');
const appLayoutPath = join(root, 'App', 'src', 'graph', 'layout.ts');
const appDrawioPath = join(root, 'App', 'src', 'export', 'drawio.ts');

const failures = [];
let checks = 0;

function check(label, run) {
  checks += 1;
  try {
    run();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.log(`  FAIL ${label} → ${error.message}`);
  }
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const read = (path) => readFileSync(path, 'utf8');
const label = (path) => relative(root, path).replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// A very small XML DOM, just enough for the plugin's parser (elements,
// attributes and child elements — it never reads text nodes).
// ---------------------------------------------------------------------------
const decode = (text) =>
  text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(
          entity[1] === 'x' || entity[1] === 'X'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10),
        );
    }
  });

function parseXml(source) {
  const cleaned = source
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  const document = { nodeType: 9, nodeName: '#document', childNodes: [] };
  const stack = [document];
  const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
  let cursor = 0;
  let match;

  while ((match = TAG.exec(cleaned))) {
    cursor = TAG.lastIndex;
    if (match[1]) {
      if (stack.length > 1 && stack[stack.length - 1].nodeName === match[2]) stack.pop();
      continue;
    }
    const element = {
      nodeType: 1,
      nodeName: match[2],
      attributes: new Map(),
      childNodes: [],
      getAttribute(name) {
        const value = this.attributes.get(name);
        return value === undefined ? null : value;
      },
      hasAttribute(name) {
        return this.attributes.has(name);
      },
    };
    ATTR.lastIndex = 0;
    let attribute;
    while ((attribute = ATTR.exec(match[3]))) element.attributes.set(attribute[1], decode(attribute[2]));
    stack[stack.length - 1].childNodes.push(element);
    if (!match[4]) stack.push(element);
  }

  const walk = (node, name, out) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (name === '*' || child.nodeName === name) out.push(child);
      walk(child, name, out);
    }
    return out;
  };

  document.documentElement = document.childNodes.find((node) => node.nodeType === 1) ?? null;
  document.getElementsByTagName = (name) => walk(document, name, []);
  document.getElementsByTagNameNS = (_namespace, name) => walk(document, name, []);
  return document;
}

// ---------------------------------------------------------------------------
// Loading the plugin in a bare context: no draw.io, no DOM beyond DOMParser.
// ---------------------------------------------------------------------------
const pluginSource = read(pluginPath);
const sampleXml = read(samplePath);

const sandbox = {
  console,
  document: { currentScript: { src: 'plugins/nmap2drawio.js' } },
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
};
sandbox.window = { console, setInterval: sandbox.setInterval, clearInterval: sandbox.clearInterval };
sandbox.window.DOMParser = function DOMParser() {
  this.parseFromString = (xml) => parseXml(String(xml));
};

check('plugin loads without draw.io and registers window.Nmap2Drawio', () => {
  vm.runInNewContext(pluginSource, sandbox, { filename: 'nmap2drawio.js' });
  const api = sandbox.window.Nmap2Drawio;
  expect(api && typeof api === 'object', 'window.Nmap2Drawio was not defined');
  for (const name of ['parseScanXml', 'describeScan', 'layoutScan', 'groupHosts', 'insertScan', 'install', 'openImportDialog']) {
    expect(typeof api[name] === 'function', `window.Nmap2Drawio.${name} is not a function`);
  }
  expect(typeof api.version === 'string' && api.version.length > 0, 'plugin version is missing');
});

const api = sandbox.window.Nmap2Drawio ?? {};
const scan = typeof api.parseScanXml === 'function' ? api.parseScanXml(sampleXml, 'lab-scan.xml') : null;

// ---------------------------------------------------------------------------
// Drift checks against App/
// ---------------------------------------------------------------------------
const expandPorts = (spec) => {
  const ports = new Set();
  for (const token of String(spec ?? '').split(/[,;\s]+/)) {
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(token);
    if (!match) continue;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    for (let port = from; port <= to; port += 1) ports.add(port);
  }
  return ports;
};

check(`risk tiers match App/src/doc/risk.ts defaults`, () => {
  const appRisk = read(appRiskPath);
  const appLevels = [...appRisk.matchAll(
    /label:\s*'([^']+)',\s*color:\s*'(#[0-9a-fA-F]{3,8})',\s*ports:\s*'([^']*)'/g,
  )].map((match) => ({ label: match[1], color: match[2].toLowerCase(), ports: match[3] }));
  expect(appLevels.length > 0, 'could not read DEFAULT_RISK_LEVELS from App/src/doc/risk.ts');
  const pluginLevels = Array.isArray(api.riskLevels) ? api.riskLevels : [];
  expect(
    pluginLevels.length === appLevels.length,
    `plugin has ${pluginLevels.length} levels, the app has ${appLevels.length}`,
  );
  appLevels.forEach((expected, index) => {
    const actual = pluginLevels[index];
    expect(actual.label === expected.label, `level ${index + 1} is “${actual.label}”, the app has “${expected.label}”`);
    expect(
      String(actual.color).toLowerCase() === expected.color,
      `${expected.label} colour is ${actual.color}, the app uses ${expected.color}`,
    );
    const mine = expandPorts(actual.ports);
    const theirs = expandPorts(expected.ports);
    const missing = [...theirs].filter((port) => !mine.has(port));
    const extra = [...mine].filter((port) => !theirs.has(port));
    expect(
      missing.length === 0 && extra.length === 0,
      `${expected.label} ports differ (missing ${missing.slice(0, 8).join(', ') || 'none'}; extra ${extra.slice(0, 8).join(', ') || 'none'})`,
    );
  });
});

check('layout sizes match App/src/graph/layout.ts', () => {
  const appLayout = read(appLayoutPath);
  for (const name of ['HOST_W', 'HOST_H', 'HOP_W', 'HOP_H', 'ORIGIN_W', 'ORIGIN_H']) {
    const match = new RegExp(`export const ${name} = (\\d+);`).exec(appLayout);
    expect(match, `${name} is not exported from App/src/graph/layout.ts`);
    const pluginValue = Number(new RegExp(`var ${name} = (\\d+);`).exec(pluginSource)?.[1]);
    expect(
      pluginValue === Number(match[1]),
      `${name} is ${pluginValue} in the plugin and ${match[1]} in the app`,
    );
  }
});

check('cell styles keep every key the app exporter writes', () => {
  const appExport = read(appDrawioPath);
  // A scan import creates frames, cards, hops and the origin — no notes and no
  // hand-drawn links, so those two app styles have no plugin counterpart.
  const notMirrored = new Set(['NOTE_STYLE', 'LINK_EDGE']);
  const styles = [
    ...appExport.matchAll(/const (HOST_STYLE|SECTION_STYLE|NOTE_STYLE|HOP_STYLE|ORIGIN_STYLE|ROUTE_EDGE|LINK_EDGE) =\s*'([^']*)'/g),
  ];
  expect(styles.length >= 5, 'could not read the *_STYLE constants from App/src/export/drawio.ts');
  for (const [, name, style] of styles) {
    const pluginStyle = new RegExp(`var ${name} =\\s*'([^']*)'`).exec(pluginSource)?.[1];
    if (!pluginStyle) {
      expect(notMirrored.has(name), `${name} is missing from the plugin`);
      continue;
    }
    for (const pair of style.split(';').filter(Boolean)) {
      expect(pluginStyle.split(';').includes(pair), `${name} drops “${pair}” from the app exporter`);
    }
  }
});

// ---------------------------------------------------------------------------
// The bundled sample has to keep parsing the way the plugin expects.
// ---------------------------------------------------------------------------
check('bundled sample scan parses to the hosts and open ports the XML holds', () => {
  expect(scan, 'parseScanXml is unavailable');
  const hostsInXml = (sampleXml.match(/<host[\s>]/g) ?? []).length;
  expect(hostsInXml > 0, 'the sample contains no <host> elements');
  expect(scan.hosts.length === hostsInXml, `parsed ${scan.hosts.length} of ${hostsInXml} hosts`);
  const openInXml = (sampleXml.match(/state="open(\|filtered)?"/g) ?? []).length;
  const described = api.describeScan(scan);
  expect(
    described.openPorts === openInXml,
    `counted ${described.openPorts} open ports, the XML has ${openInXml}`,
  );
  expect(described.subnets >= 1, 'the sample produced no subnets');
  expect(described.hops >= 1, 'the sample produced no traceroute hops');
  expect(
    Object.keys(described.riskLevels).length > 0,
    'no sample port matched a risk level — the tiers and the sample have drifted apart',
  );
});

check('layoutScan produces a drawable box for the sample', () => {
  expect(scan, 'parseScanXml is unavailable');
  const layout = api.layoutScan(scan);
  expect(layout.subnets.length >= 1, 'no subnet frames');
  expect(Number.isFinite(layout.width) && layout.width > 0, `width is ${layout.width}`);
  expect(Number.isFinite(layout.height) && layout.height > 0, `height is ${layout.height}`);
  for (const subnet of layout.subnets) {
    expect(subnet.hosts.length > 0, `subnet ${subnet.cidr} has no hosts`);
    expect(subnet.w > 0 && subnet.h > 0, `subnet ${subnet.cidr} has no size`);
  }
});

check('webapp/js/PostConfig.js parses and still loads the plugin', () => {
  const loader = read(join(here, 'webapp', 'js', 'PostConfig.js'));
  // Parsed, not executed: it exists to run inside draw.io's page.
  new vm.Script(loader, { filename: 'PostConfig.js' });
  expect(loader.includes('nmap2drawio.js'), 'PostConfig.js no longer loads plugins/nmap2drawio.js');
});

check('the package manifest lists files that exist', () => {
  const manifest = read(join(here, 'package-files.txt'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  expect(manifest.length > 0, 'package-files.txt is empty');
  for (const entry of manifest) {
    expect(existsSync(join(here, entry)), `package-files.txt lists ${entry}, which does not exist`);
  }
  for (const required of ['plugins/nmap2drawio.js', 'samples/lab-scan.xml', 'webapp/js/PostConfig.js', 'install-plugin.sh', 'docker-compose.yml']) {
    expect(
      manifest.some((entry) => required === entry || required.startsWith(entry)),
      `package-files.txt no longer ships ${required}`,
    );
  }
  const compose = read(join(here, 'docker-compose.yml'));
  for (const mounted of ['./plugins/nmap2drawio.js', './samples/lab-scan.xml', './webapp/js/PostConfig.js']) {
    expect(compose.includes(mounted), `docker-compose.yml no longer mounts ${mounted}`);
  }
  const installer = read(join(here, 'install-plugin.ps1'));
  expect(installer.includes('nmap2drawio.js'), 'install-plugin.ps1 does not reference the plugin');
});

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`\nAll ${checks} checks passed for ${label(pluginPath)}`);
