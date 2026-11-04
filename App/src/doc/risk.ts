import { openPorts, type NmapHost } from '../model/types';
import { nodeTitle, type DiagramNode, type Layer } from './types';

/**
 * A user-defined risk level: a name, a colour, and the ports that raise it.
 *
 * `ports` is the editable text ("21, 23, 512-514"); parsing lives here so the
 * dialog can show validation and the renderers only ever see ranges.
 */
export type RiskLevel = {
  id: string;
  label: string;
  color: string;
  ports: string;
  enabled: boolean;
};

/**
 * Ordered levels: index 0 wins. A host with ports from several levels takes the
 * colour of the first (highest priority) level it matches.
 */
export type RiskPolicy = {
  version: 1;
  levels: RiskLevel[];
};

export type PortRange = { from: number; to: number };

export type PortSpec = {
  ranges: PortRange[];
  invalid: string[];
  /** Every port covered by the spec, ascending, without duplicates. */
  ports: number[];
};

export type RiskScope = 'diagram' | 'account' | 'server' | 'default';

export type RiskLayers = {
  diagram?: RiskPolicy | null;
  account?: RiskPolicy | null;
  server?: RiskPolicy | null;
};

export type ResolvedRiskPolicy = {
  policy: RiskPolicy;
  /** Which layer supplied the levels that are in force. */
  scope: RiskScope;
};

/** Palette offered in the dialog; any hex colour is accepted. */
export const RISK_COLORS = [
  '#e5484d',
  '#f08c2e',
  '#e3c53d',
  '#a855f7',
  '#3b82f6',
  '#14b8a6',
  '#ec4899',
  '#94a3b8',
];

export const MAX_RISK_LEVELS = 12;
const MAX_LABEL = 40;
const MAX_PORT_SPEC = 600;
const MAX_PORT = 65535;
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const DEFAULT_RISK_LEVELS: RiskLevel[] = [
  {
    id: 'critical',
    label: 'Critical',
    color: '#e5484d',
    ports:
      '21, 23, 69, 111, 135, 139, 445, 512-514, 1433, 1521, 2049, 3306, 3389, 5432, 5900, 5985, 6379, 9200, 11211, 27017',
    enabled: true,
  },
  {
    id: 'medium',
    label: 'Medium',
    color: '#f08c2e',
    ports: '22, 1080, 2375-2376, 3000, 3128, 5000, 5901, 7001, 8000-8100, 8443, 8888, 9090, 10000',
    enabled: true,
  },
  {
    id: 'low',
    label: 'Low',
    color: '#e3c53d',
    ports: '25, 53, 80, 110, 143, 161, 389, 443, 465, 587, 636, 873, 993, 995, 1900, 5060, 5353',
    enabled: true,
  },
];

/**
 * Reference catalogue for the risk dialog's “Common ports” page: the usual service
 * ports a scan turns up, with the name nmap prints for them. The page pairs each
 * one with the level of whatever policy is being edited, so the colours always
 * match the tiers in front of the user.
 */
export const COMMON_PORTS: { port: number; service: string; note?: string }[] = [
  { port: 20, service: 'ftp-data' },
  { port: 21, service: 'ftp', note: 'cleartext file transfer' },
  { port: 22, service: 'ssh', note: 'remote shell' },
  { port: 23, service: 'telnet', note: 'cleartext remote shell' },
  { port: 25, service: 'smtp' },
  { port: 53, service: 'domain', note: 'DNS' },
  { port: 67, service: 'dhcp' },
  { port: 69, service: 'tftp' },
  { port: 80, service: 'http' },
  { port: 88, service: 'kerberos' },
  { port: 110, service: 'pop3' },
  { port: 111, service: 'rpcbind', note: 'portmapper' },
  { port: 123, service: 'ntp' },
  { port: 135, service: 'msrpc' },
  { port: 137, service: 'netbios-ns' },
  { port: 139, service: 'netbios-ssn' },
  { port: 143, service: 'imap' },
  { port: 161, service: 'snmp', note: 'often public community strings' },
  { port: 389, service: 'ldap' },
  { port: 443, service: 'https' },
  { port: 445, service: 'microsoft-ds', note: 'SMB file sharing' },
  { port: 465, service: 'smtps' },
  { port: 514, service: 'syslog' },
  { port: 515, service: 'printer', note: 'LPD' },
  { port: 548, service: 'afp' },
  { port: 554, service: 'rtsp', note: 'IP cameras' },
  { port: 587, service: 'submission' },
  { port: 623, service: 'ipmi', note: 'out-of-band server control' },
  { port: 631, service: 'ipp', note: 'CUPS printing' },
  { port: 636, service: 'ldaps' },
  { port: 873, service: 'rsync' },
  { port: 902, service: 'vmware-auth' },
  { port: 993, service: 'imaps' },
  { port: 995, service: 'pop3s' },
  { port: 1080, service: 'socks' },
  { port: 1194, service: 'openvpn' },
  { port: 1433, service: 'ms-sql-s' },
  { port: 1521, service: 'oracle' },
  { port: 1701, service: 'l2tp' },
  { port: 1883, service: 'mqtt' },
  { port: 1900, service: 'upnp' },
  { port: 2049, service: 'nfs' },
  { port: 2375, service: 'docker', note: 'unauthenticated Docker API' },
  { port: 2376, service: 'docker-s' },
  { port: 3000, service: 'http-alt', note: 'Grafana, Gitea, dev servers' },
  { port: 3128, service: 'squid-http', note: 'proxy' },
  { port: 3260, service: 'iscsi' },
  { port: 3306, service: 'mysql' },
  { port: 3389, service: 'ms-wbt-server', note: 'RDP' },
  { port: 4000, service: 'http-alt' },
  { port: 5000, service: 'upnp', note: 'Synology DSM, registries' },
  { port: 5060, service: 'sip' },
  { port: 5432, service: 'postgresql' },
  { port: 5672, service: 'amqp' },
  { port: 5900, service: 'vnc', note: 'often without a password' },
  { port: 5985, service: 'wsman', note: 'WinRM over HTTP' },
  { port: 5986, service: 'wsmans' },
  { port: 6379, service: 'redis' },
  { port: 6443, service: 'kubernetes', note: 'API server' },
  { port: 7001, service: 'afs3-callback', note: 'WebLogic' },
  { port: 8000, service: 'http-alt' },
  { port: 8006, service: 'http-alt', note: 'Proxmox VE web UI' },
  { port: 8080, service: 'http-proxy' },
  { port: 8081, service: 'http-alt' },
  { port: 8086, service: 'influxdb' },
  { port: 8443, service: 'https-alt' },
  { port: 8888, service: 'http-alt', note: 'Jupyter' },
  { port: 9000, service: 'http-alt', note: 'Portainer, SonarQube' },
  { port: 9090, service: 'http-alt', note: 'Prometheus, Cockpit' },
  { port: 9100, service: 'jetdirect', note: 'raw printing' },
  { port: 9200, service: 'elasticsearch' },
  { port: 10000, service: 'snet-sensor-mgmt', note: 'Webmin' },
  { port: 11211, service: 'memcache' },
  { port: 27017, service: 'mongod' },
  { port: 32400, service: 'plex' },
];

export function defaultRiskPolicy(): RiskPolicy {
  return { version: 1, levels: DEFAULT_RISK_LEVELS.map((level) => ({ ...level })) };
}

export function cloneRiskPolicy(policy: RiskPolicy): RiskPolicy {
  return { version: 1, levels: policy.levels.map((level) => ({ ...level })) };
}

// ---------------------------------------------------------------------------
// Port specs: "22", "8000-8100", "21, 23, 512-514", also space/semicolon separated
// ---------------------------------------------------------------------------
function parseToken(token: string): PortRange | null {
  const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(token);
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] ? Number(match[2]) : from;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from < 1 || to > MAX_PORT || from > to) return null;
  return { from, to };
}

export function parsePortSpec(spec: string): PortSpec {
  const ranges: PortRange[] = [];
  const invalid: string[] = [];
  const tokens = String(spec ?? '')
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const range = parseToken(token);
    if (range) ranges.push(range);
    else invalid.push(token);
  }

  const merged = mergeRanges(ranges);
  const ports: number[] = [];
  for (const range of merged) {
    for (let port = range.from; port <= range.to; port += 1) ports.push(port);
  }
  return { ranges: merged, invalid, ports };
}

function mergeRanges(ranges: PortRange[]): PortRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: PortRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

export function formatPortSpec(ranges: PortRange[]): string {
  return mergeRanges(ranges)
    .map((range) => (range.from === range.to ? `${range.from}` : `${range.from}-${range.to}`))
    .join(', ');
}

export function portInRanges(port: number, ranges: PortRange[]): boolean {
  return ranges.some((range) => port >= range.from && port <= range.to);
}

/** Human summary for a spec, e.g. "5 ports" or "1,000 ports". */
export function describePortCount(spec: string): string {
  const { ports, invalid } = parsePortSpec(spec);
  const label = `${ports.length.toLocaleString()} ${ports.length === 1 ? 'port' : 'ports'}`;
  return invalid.length > 0 ? `${label} · ${invalid.length} invalid` : label;
}

// ---------------------------------------------------------------------------
// Normalisation and layering
// ---------------------------------------------------------------------------
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function uniqueLevelId(label: string, existing: RiskLevel[], fallbackIndex = 0): string {
  const taken = new Set(existing.map((level) => level.id));
  const base = slug(label) || `level-${fallbackIndex + 1}`;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function normalizeLevel(raw: unknown, index: number): RiskLevel | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<RiskLevel>;
  const label = String(value.label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
  const rawPorts = String(value.ports ?? '').trim().slice(0, MAX_PORT_SPEC);
  if (!label && !rawPorts) return null;

  const color = typeof value.color === 'string' && HEX_COLOR.test(value.color.trim())
    ? value.color.trim()
    : RISK_COLORS[index % RISK_COLORS.length];
  const id =
    typeof value.id === 'string' && /^[a-z0-9-]{1,40}$/.test(value.id)
      ? value.id
      : `level-${index + 1}`;

  return {
    id,
    label: label || `Level ${index + 1}`,
    color,
    ports: rawPorts,
    enabled: value.enabled !== false,
  };
}

/**
 * Validates whatever came from storage, an account, or the API.
 * `null` means "no policy here, use the layer below"; an empty `levels` array is
 * a deliberate "nothing is flagged" policy.
 */
export function normalizeRiskPolicy(value: unknown): RiskPolicy | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { levels?: unknown }).levels;
  if (!Array.isArray(raw)) return null;

  const levels: RiskLevel[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, MAX_RISK_LEVELS)) {
    const level = normalizeLevel(entry, levels.length);
    if (!level) continue;
    const id = seen.has(level.id) ? uniqueLevelId(level.label, levels) : level.id;
    if (seen.has(id)) continue;
    seen.add(id);
    levels.push({ ...level, id });
  }
  return { version: 1, levels };
}

/** Reads `doc.risk`: `undefined`/`null` means the diagram inherits. */
export function normalizeDiagramRisk(value: unknown): RiskPolicy | null {
  return normalizeRiskPolicy(value);
}

export function resolveRiskPolicy(layers: RiskLayers): ResolvedRiskPolicy {
  if (layers.diagram) return { policy: layers.diagram, scope: 'diagram' };
  if (layers.account) return { policy: layers.account, scope: 'account' };
  if (layers.server) return { policy: layers.server, scope: 'server' };
  return { policy: defaultRiskPolicy(), scope: 'default' };
}

export const RISK_SCOPE_LABEL: Record<RiskScope, string> = {
  diagram: 'this diagram',
  account: 'your account',
  server: 'the server default',
  default: 'the built-in default',
};

// ---------------------------------------------------------------------------
// Resolution against a scan
// ---------------------------------------------------------------------------
export type RiskBadge = { label: string; color: string };

/**
 * What a single node should show. `badges` is keyed by port so the card can
 * tint each port chip with the level it matched.
 */
export type NodeRisk = {
  /** Id of the highest-priority matched level. */
  id: string;
  label: string;
  color: string;
  /** Ports matched by the highest-priority level. */
  ports: number[];
  /** Every matched port, whatever the level. */
  flagged: number[];
  tooltip: string;
  badges: Record<string, RiskBadge>;
};

type CompiledLevel = { level: RiskLevel; ranges: PortRange[] };

const compiledCache = new WeakMap<RiskPolicy, CompiledLevel[]>();

function compiled(policy: RiskPolicy): CompiledLevel[] {
  const cached = compiledCache.get(policy);
  if (cached) return cached;
  const out = policy.levels
    .filter((level) => level.enabled)
    .map((level) => ({ level, ranges: parsePortSpec(level.ports).ranges }));
  compiledCache.set(policy, out);
  return out;
}

export function levelForPort(port: number, policy: RiskPolicy): RiskLevel | null {
  for (const entry of compiled(policy)) {
    if (portInRanges(port, entry.ranges)) return entry.level;
  }
  return null;
}

export function nodeRisk(host: NmapHost | undefined, policy: RiskPolicy): NodeRisk | null {
  if (!host) return null;
  const levels = compiled(policy);
  if (levels.length === 0) return null;

  const open = openPorts(host);
  if (open.length === 0) return null;

  const badges: Record<string, RiskBadge> = {};
  const perLevel = new Map<string, number[]>();

  for (const port of open) {
    const level = levelForPort(port.port, policy);
    if (!level) continue;
    badges[String(port.port)] = { label: level.label, color: level.color };
    const bucket = perLevel.get(level.id);
    if (bucket) bucket.push(port.port);
    else perLevel.set(level.id, [port.port]);
  }

  // Priority is the order of the policy, not the order the ports appear in the
  // scan: a red port outranks an orange one wherever it sits in the list.
  const matched = levels.filter((entry) => perLevel.has(entry.level.id)).map((entry) => entry.level);
  if (matched.length === 0) return null;

  const top = matched[0];
  const flagged = open.filter((port) => badges[String(port.port)]).map((port) => port.port);
  const ports = perLevel.get(top.id) ?? [];
  const detail = matched
    .map((level) => `${level.label}: ${(perLevel.get(level.id) ?? []).join(', ')}`)
    .join(' · ');

  return {
    id: top.id,
    label: top.label,
    color: top.color,
    ports,
    flagged,
    tooltip: detail,
    badges,
  };
}

/** Ports of one level for the inspector's per-level warnings. */
export function portsByLevel(host: NmapHost | undefined, policy: RiskPolicy): { level: RiskLevel; ports: number[] }[] {
  if (!host) return [];
  const levels = compiled(policy);
  const open = openPorts(host);
  const out: { level: RiskLevel; ports: number[] }[] = [];
  for (const entry of levels) {
    const matched = open
      .filter((port) => portInRanges(port.port, entry.ranges))
      .map((port) => port.port);
    if (matched.length > 0) out.push({ level: entry.level, ports: matched });
  }
  return out;
}

export type RiskStats = {
  /** Hosts with at least one flagged port. */
  hosts: number;
  /** Flagged open ports across all hosts. */
  ports: number;
  levels: { level: RiskLevel; hosts: number; ports: number }[];
};

/** Counts used by the dialog preview, the legend and the overview panel. */
export function riskStats(hosts: NmapHost[], policy: RiskPolicy): RiskStats {
  const entries = policy.levels
    .filter((level) => level.enabled)
    .map((level) => ({ level, hosts: 0, ports: 0 }));
  const byId = new Map(entries.map((entry) => [entry.level.id, entry]));

  let flaggedHosts = 0;
  let flaggedPorts = 0;
  for (const host of hosts) {
    const matched = new Set<string>();
    for (const port of openPorts(host)) {
      const level = levelForPort(port.port, policy);
      if (!level) continue;
      const entry = byId.get(level.id);
      if (!entry) continue;
      entry.ports += 1;
      flaggedPorts += 1;
      matched.add(level.id);
    }
    if (matched.size > 0) flaggedHosts += 1;
    for (const id of matched) {
      const entry = byId.get(id);
      if (entry) entry.hosts += 1;
    }
  }

  return { hosts: flaggedHosts, ports: flaggedPorts, levels: entries };
}

// ---------------------------------------------------------------------------
// Summary tree for the Risk panel: level → port → hosts
// ---------------------------------------------------------------------------
export type RiskSummaryHost = {
  nodeId: string;
  /** Card title, usually the IP address. */
  label: string;
  /** First hostname found by the scan, or ''. */
  hostname: string;
  /** Name of the layer the card lives on, when known. */
  layer: string;
};

export type RiskSummaryPort = {
  port: number;
  /** Service name (`http`) or the product string, whichever the scan has. */
  service: string;
  hosts: RiskSummaryHost[];
};

export type RiskSummaryLevel = {
  level: RiskLevel;
  /** 1-based position in the policy; 1 is the top of the hierarchy. */
  priority: number;
  ports: RiskSummaryPort[];
  /** Cards with a port at this level. */
  hosts: number;
  /** Flagged open ports at this level, counted once per card. */
  open: number;
  /** Cards whose highest-priority level is this one. */
  topHosts: number;
};

export type RiskSummary = {
  levels: RiskSummaryLevel[];
  /** Cards with at least one flagged port. */
  hosts: number;
  /** Flagged open ports, counted once per card. */
  open: number;
  /** Distinct flagged port numbers. */
  ports: number;
};

/**
 * Groups a set of cards by level, then by port, then by host – the shape the
 * Risk panel shows and both report exports walk. Pass only the cards the canvas
 * is showing to summarise the current view.
 */
export function riskSummary(
  nodes: DiagramNode[],
  policy: RiskPolicy,
  layers?: Map<string, Layer>,
): RiskSummary {
  const levels = policy.levels.filter((level) => level.enabled);
  const portsByLevel = new Map<string, Map<number, RiskSummaryPort>>();
  const hostsByLevel = new Map<string, Set<string>>();
  const flagged = new Set<string>();
  const distinctPorts = new Set<number>();
  let open = 0;

  for (const node of nodes) {
    if (!node.host) continue;
    const entry: RiskSummaryHost = {
      nodeId: node.id,
      label: nodeTitle(node),
      hostname: node.host.hostnames.find((name) => name.trim()) ?? '',
      layer: layers?.get(node.layerId)?.name ?? '',
    };
    for (const port of openPorts(node.host)) {
      const level = levelForPort(port.port, policy);
      if (!level) continue;
      let ports = portsByLevel.get(level.id);
      if (!ports) {
        ports = new Map();
        portsByLevel.set(level.id, ports);
      }
      let slot = ports.get(port.port);
      if (!slot) {
        slot = { port: port.port, service: port.service ?? port.product ?? '', hosts: [] };
        ports.set(port.port, slot);
      }
      if (!slot.hosts.some((item) => item.nodeId === node.id)) slot.hosts.push(entry);
      let levelHosts = hostsByLevel.get(level.id);
      if (!levelHosts) {
        levelHosts = new Set();
        hostsByLevel.set(level.id, levelHosts);
      }
      levelHosts.add(node.id);
      flagged.add(node.id);
      distinctPorts.add(port.port);
      open += 1;
    }
  }

  const topHosts = new Map<string, number>();
  for (const node of nodes) {
    const risk = nodeRisk(node.host, policy);
    if (risk) topHosts.set(risk.id, (topHosts.get(risk.id) ?? 0) + 1);
  }

  return {
    hosts: flagged.size,
    open,
    ports: distinctPorts.size,
    levels: levels.map((level, index) => {
      const ports = [...(portsByLevel.get(level.id)?.values() ?? [])];
      return {
        level,
        priority: index + 1,
        hosts: hostsByLevel.get(level.id)?.size ?? 0,
        open: ports.reduce((total, port) => total + port.hosts.length, 0),
        topHosts: topHosts.get(level.id) ?? 0,
        // Busiest port first, so the top of a big tree is the interesting part.
        ports: ports.sort((a, b) => b.hosts.length - a.hosts.length || a.port - b.port),
      };
    }),
  };
}

/** `#e5484d` + 0.2 → `rgba(229, 72, 77, 0.2)`; passes through non-hex values. */
export function hexToRgba(color: string, alpha: number): string {
  const hex = String(color ?? '').trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = match[1];
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Filter helper for `risk:<value>` in the search box. */
export function hostMatchesRiskFilter(host: NmapHost | undefined, policy: RiskPolicy, needle: string): boolean {
  if (!host) return false;
  const matches = portsByLevel(host, policy);
  if (matches.length === 0) return false;
  const value = needle.trim().toLowerCase();
  if (!value || value === 'any' || value === '*') return true;
  if (value === 'high') {
    // Legacy shorthand from when there was a single "high risk" set.
    const top = policy.levels.find((level) => level.enabled);
    return top ? matches.some((entry) => entry.level.id === top.id) : false;
  }
  return matches.some(
    (entry) =>
      entry.level.label.toLowerCase().includes(value) || entry.level.id.toLowerCase().includes(value),
  );
}
