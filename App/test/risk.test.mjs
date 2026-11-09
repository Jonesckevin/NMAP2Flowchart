import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RISK_LEVELS,
  defaultRiskPolicy,
  describePortCount,
  formatPortSpec,
  hexToRgba,
  hostMatchesRiskFilter,
  levelForPort,
  nodeRisk,
  normalizeRiskPolicy,
  parsePortSpec,
  portInRanges,
  resolveRiskPolicy,
  riskStats,
  riskSummary,
} from '../src/doc/risk';
import { discoveryOnly } from '../src/model/types';

const policy = defaultRiskPolicy();

const nmapHost = (ports, extra = {}) => ({
  id: 'h',
  ip: '10.0.0.1',
  hostnames: [],
  status: 'up',
  os: [],
  ports: ports.map((port) =>
    typeof port === 'number' ? { port, protocol: 'tcp', state: 'open', scripts: [] } : port,
  ),
  portsScanned: true,
  scripts: [],
  hops: [],
  ...extra,
});

const diagramNode = (host) => ({
  id: 'node-1',
  kind: 'host',
  layerId: 'layer:main',
  position: { x: 0, y: 0 },
  host,
});

test('port specs accept lists, ranges and separators, and report junk', () => {
  assert.deepEqual(parsePortSpec('22, 80, 443').ports, [22, 80, 443]);
  assert.deepEqual(parsePortSpec('8000-8003').ports, [8000, 8001, 8002, 8003]);
  assert.deepEqual(parsePortSpec('21 23;512-514').ports, [21, 23, 512, 513, 514]);
  // Overlapping and touching ranges merge instead of duplicating ports.
  assert.deepEqual(parsePortSpec('20-25, 22-30, 31').ranges, [{ from: 20, to: 31 }]);
  assert.deepEqual(parsePortSpec('  ').ports, []);
  assert.deepEqual(parsePortSpec('abc, 22').invalid, ['abc']);
  assert.deepEqual(parsePortSpec('0, 70000, 9-4').invalid, ['0', '70000', '9-4']);

  assert.equal(formatPortSpec([{ from: 20, to: 25 }, { from: 26, to: 30 }]), '20-30');
  assert.equal(describePortCount('22,80,443'), '3 ports');
  assert.equal(describePortCount('22,wat'), '1 port · 1 invalid');
  assert.equal(portInRanges(23, [{ from: 20, to: 25 }]), true);
  assert.equal(portInRanges(26, [{ from: 20, to: 25 }]), false);
});

test('the built-in policy keeps the three documented tiers', () => {
  assert.deepEqual(
    DEFAULT_RISK_LEVELS.map((level) => `${level.id}:${level.enabled}`),
    ['critical:true', 'medium:true', 'low:true'],
  );

  // 3389 is critical in the shipped tiers; the canvas and every exporter read this.
  assert.equal(levelForPort(3389, policy)?.id, 'critical');
  assert.equal(levelForPort(22, policy)?.id, 'medium');
  assert.equal(levelForPort(443, policy)?.id, 'low');
  assert.equal(levelForPort(12345, policy), null);

  // A fresh policy never aliases the exported constant.
  const clone = defaultRiskPolicy();
  clone.levels[0].color = '#000000';
  assert.equal(DEFAULT_RISK_LEVELS[0].color, '#e5484d');
});

test('normalisation repairs junk instead of dropping it', () => {
  assert.equal(normalizeRiskPolicy(null), null);
  assert.equal(normalizeRiskPolicy({ nope: true }), null);
  assert.deepEqual(normalizeRiskPolicy({ levels: [] }), { version: 1, levels: [] });

  const normalised = normalizeRiskPolicy({
    levels: [
      { id: 'bad id!', label: 'Bad', color: 'not-a-colour', ports: '22' },
      { id: 'ok', label: 'Ok', color: '#00ff00', ports: '80', enabled: false },
      { id: 'ok', label: 'Duplicate', color: '#0000ff', ports: '443' },
    ],
  });

  assert.deepEqual(
    normalised.levels.map(({ id, color, enabled }) => ({ id, color, enabled })),
    [
      { id: 'level-1', color: '#e5484d', enabled: true },
      { id: 'ok', color: '#00ff00', enabled: false },
      { id: 'duplicate', color: '#0000ff', enabled: true },
    ],
  );

  // A disabled tier is ignored during resolution.
  assert.equal(levelForPort(80, normalised), null);
  assert.equal(levelForPort(443, normalised)?.id, 'duplicate');
});

test('resolution layers diagram over account over server over the default', () => {
  const level = { ...DEFAULT_RISK_LEVELS[0] };
  const diagram = { version: 1, levels: [{ ...level, id: 'diagram' }] };
  const account = { version: 1, levels: [{ ...level, id: 'account' }] };
  const server = { version: 1, levels: [{ ...level, id: 'server' }] };

  assert.deepEqual(
    [
      resolveRiskPolicy({ diagram, account, server }).scope,
      resolveRiskPolicy({ account, server }).scope,
      resolveRiskPolicy({ server }).scope,
      resolveRiskPolicy({}).scope,
    ],
    ['diagram', 'account', 'server', 'default'],
  );
  assert.equal(resolveRiskPolicy({}).policy.levels.length, 3);
});

test('a host is scored by the highest tier, not by port order', () => {
  const risky = nodeRisk(nmapHost([443, 3389]), policy);
  assert.equal(risky?.id, 'critical');
  assert.equal(risky?.color, '#e5484d');
  assert.deepEqual(risky?.ports, [3389]);
  assert.deepEqual(risky?.flagged, [443, 3389]);
  assert.deepEqual(Object.keys(risky?.badges ?? {}), ['443', '3389']);

  assert.equal(nodeRisk(nmapHost([12345]), policy), null);
  assert.equal(nodeRisk(undefined, policy), null);
  // An empty policy flags nothing, which is how "no risk levels" is expressed.
  assert.equal(nodeRisk(nmapHost([3389]), { version: 1, levels: [] }), null);

  const stats = riskStats([nmapHost([3389]), nmapHost([443]), nmapHost([])], policy);
  assert.equal(stats.hosts, 2);
  assert.equal(stats.ports, 2);
  assert.equal(stats.levels.find((entry) => entry.level.id === 'critical')?.ports, 1);
});

test('discovery-only hosts never look risky', () => {
  const host = nmapHost([], { portsScanned: false });
  assert.equal(discoveryOnly(host), true);
  assert.equal(nodeRisk(host, policy), null);
});

test('the risk: filter matches level names, not ports', () => {
  const host = nmapHost([3389]);

  assert.equal(hostMatchesRiskFilter(host, policy, 'critical'), true);
  assert.equal(hostMatchesRiskFilter(host, policy, 'crit'), true);
  assert.equal(hostMatchesRiskFilter(host, policy, 'low'), false);
  assert.equal(hostMatchesRiskFilter(host, policy, 'any'), true);
  // Legacy shorthand: the first enabled tier.
  assert.equal(hostMatchesRiskFilter(host, policy, 'high'), true);
  assert.equal(hostMatchesRiskFilter(undefined, policy, 'any'), false);
});

test('risk summaries are built from cards, not hosts', () => {
  const host = nmapHost([
    { port: 3389, protocol: 'tcp', state: 'open', service: 'rdp', product: 'Microsoft', scripts: [] },
  ]);
  const summary = riskSummary([diagramNode(host)], policy);
  const critical = summary.levels.find((entry) => entry.level.id === 'critical');

  assert.equal(summary.hosts, 1);
  assert.equal(summary.open, 1);
  assert.equal(summary.ports, 1);
  assert.equal(critical?.open, 1);
  assert.equal(critical?.ports[0]?.port, 3389);
  assert.equal(critical?.ports[0]?.hosts[0]?.nodeId, 'node-1');

  assert.equal(hexToRgba('#e5484d', 0.5), 'rgba(229, 72, 77, 0.5)');
  assert.equal(hexToRgba('#abc', 0.2), 'rgba(170, 187, 204, 0.2)');
  // Non-hex values pass through, which is what tiers with named colours rely on.
  assert.equal(hexToRgba('var(--accent)', 0.5), 'var(--accent)');
});
