import { XMLParser } from 'fast-xml-parser';
import type { NmapHost, NmapOsMatch, NmapPort, NmapScan, NmapScript, NmapTraceHop } from '../model/types';

const ARRAY_PATHS = new Set([
  'nmaprun.host',
  'nmaprun.host.address',
  'nmaprun.host.hostnames.hostname',
  'nmaprun.host.ports.port',
  'nmaprun.host.ports.port.script',
  'nmaprun.host.ports.port.service.cpe',
  'nmaprun.host.hostscript.script',
  'nmaprun.host.os.osmatch',
  'nmaprun.host.os.osmatch.osclass',
  'nmaprun.host.trace.hop',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (_name, jpath) => ARRAY_PATHS.has(typeof jpath === 'string' ? jpath : jpath.toString('.')),
});

type Raw = Record<string, unknown>;

function asArray<T>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = decodeEntities(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function decodeEntities(value: string): string {
  if (!value.includes('&#')) return value;
  const fromCode = (code: number) =>
    Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => fromCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => fromCode(Number.parseInt(dec, 10)));
}

function attr(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  return text((node as Raw)[`@_${name}`]);
}

function child(node: Raw | undefined, name: string): Raw | undefined {
  const value = node?.[name];
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Raw;
  return undefined;
}

function toScripts(value: unknown): NmapScript[] {
  return asArray<Raw>(value)
    .map((script) => ({ id: attr(script, 'id') ?? 'script', output: attr(script, 'output') ?? '' }))
    .filter((script) => script.output.length > 0);
}

function toPort(raw: Raw): NmapPort {
  const state = child(raw, 'state');
  const service = child(raw, 'service');
  const cpe = asArray<unknown>(service?.cpe)
    .map((entry) => (typeof entry === 'string' ? text(entry) : attr(entry, 'cpe') ?? text(entry)))
    .filter((entry): entry is string => Boolean(entry));
  return {
    port: Number(attr(raw, 'portid') ?? 0),
    protocol: attr(raw, 'protocol') ?? 'tcp',
    state: attr(state, 'state') ?? 'unknown',
    service: attr(service, 'name'),
    product: attr(service, 'product'),
    version: attr(service, 'version'),
    extrainfo: attr(service, 'extrainfo'),
    devicetype: attr(service, 'devicetype'),
    ostype: attr(service, 'ostype'),
    cpe: cpe.length > 0 ? cpe : undefined,
    scripts: toScripts(raw.script),
  };
}

function toOsMatch(raw: Raw): NmapOsMatch {
  const classes = asArray<Raw>(raw.osclass)
    .map((entry) => ({
      type: attr(entry, 'type') ?? '',
      vendor: attr(entry, 'vendor'),
      osfamily: attr(entry, 'osfamily'),
      osgen: attr(entry, 'osgen'),
      accuracy: Number(attr(entry, 'accuracy') ?? 0),
    }))
    .filter((entry) => entry.type.length > 0);
  return {
    name: attr(raw, 'name') ?? 'unknown',
    accuracy: Number(attr(raw, 'accuracy') ?? 0),
    ...(classes.length > 0 ? { classes } : {}),
  };
}

function toTrace(raw: Raw): NmapTraceHop[] {
  return asArray<Raw>(child(raw, 'trace')?.hop)
    .map((hop) => ({
      ip: attr(hop, 'ipaddr') ?? '',
      ttl: Number(attr(hop, 'ttl') ?? 0),
      rtt: attr(hop, 'rtt') ? Number(attr(hop, 'rtt')) : undefined,
      host: attr(hop, 'host'),
    }))
    .filter((hop) => hop.ip.length > 0 && hop.ip !== '-')
    .sort((a, b) => a.ttl - b.ttl);
}

function toHost(raw: Raw, index: number): NmapHost | null {
  const addresses = asArray<Raw>(raw.address);
  const pick = (type: string) => addresses.find((a) => attr(a, 'addrtype') === type);
  const ipv4 = pick('ipv4');
  const ipv6 = pick('ipv6');
  const mac = pick('mac');
  const ip = attr(ipv4, 'addr') ?? attr(ipv6, 'addr');
  if (!ip) return null;

  const hostnames = asArray<Raw>(child(raw, 'hostnames')?.hostname)
    .map((n) => attr(n, 'name'))
    .filter((n): n is string => Boolean(n));

  const portsBlock = child(raw, 'ports');
  const ports = asArray<Raw>(portsBlock?.port)
    .map(toPort)
    .sort((a, b) => a.port - b.port);

  const os: NmapOsMatch[] = asArray<Raw>(child(raw, 'os')?.osmatch).map(toOsMatch);

  const hops = toTrace(raw).map((hop) => hop.ip);

  const allAddresses = [
    ...new Set(
      addresses
        .filter((entry) => ['ipv4', 'ipv6'].includes(attr(entry, 'addrtype') ?? ''))
        .map((entry) => attr(entry, 'addr'))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (!allAddresses.includes(ip)) allAddresses.unshift(ip);
  const macs = addresses
    .filter((entry) => attr(entry, 'addrtype') === 'mac')
    .map((entry) => ({ addr: (attr(entry, 'addr') ?? '').toUpperCase(), vendor: attr(entry, 'vendor') }))
    .filter((entry) => entry.addr.length > 0);

  return {
    id: `host-${ip.replace(/[^0-9a-zA-Z]+/g, '-')}-${index}`,
    ip,
    ipv6: ipv4 ? attr(ipv6, 'addr') : undefined,
    addresses: allAddresses.length > 1 ? allAddresses : undefined,
    mac: attr(mac, 'addr')?.toUpperCase(),
    vendor: attr(mac, 'vendor'),
    macs: macs.length > 1 ? macs : undefined,
    hostnames,
    status: attr(child(raw, 'status'), 'state') ?? 'up',
    os,
    ports,
    portsScanned: portsBlock !== undefined,
    scripts: toScripts(child(raw, 'hostscript')?.script),
    hops,
  };
}

function collectTrace(hosts: Raw[]): NmapTraceHop[] {
  const byIp = new Map<string, NmapTraceHop>();
  for (const raw of hosts) {
    for (const hop of toTrace(raw)) {
      const seen = byIp.get(hop.ip);
      if (!seen) {
        byIp.set(hop.ip, hop);
        continue;
      }
      if (!seen.host && hop.host) seen.host = hop.host;
      if (seen.rtt === undefined && hop.rtt !== undefined) seen.rtt = hop.rtt;
      if (hop.ttl > seen.ttl) seen.ttl = hop.ttl;
    }
  }
  return [...byIp.values()].sort((a, b) => a.ttl - b.ttl);
}

export function parseNmapXml(xml: string, fileName = 'scan.xml'): NmapScan {
  const cleaned = xml.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?>/gi, '');

  let parsed: Raw;
  try {
    parsed = parser.parse(cleaned) as Raw;
  } catch (error) {
    throw new Error(`That file is not valid XML (${(error as Error).message}).`);
  }

  const run = child(parsed, 'nmaprun');
  if (!run) {
    throw new Error('No <nmaprun> root element. Run nmap with -oX to produce XML output.');
  }

  const hosts: NmapHost[] = [];
  const seen = new Set<string>();
  for (const raw of asArray<Raw>(run.host)) {
    const host = toHost(raw, hosts.length);
    if (!host || seen.has(host.ip)) continue;
    seen.add(host.ip);
    hosts.push(host);
  }
  for (const raw of asArray<Raw>(run.hosthint)) {
    const host = toHost(raw, hosts.length);
    if (!host || seen.has(host.ip)) continue;
    seen.add(host.ip);
    hosts.push({ ...host, portsScanned: false });
  }

  const trace = collectTrace(asArray<Raw>(run.host));

  // A scan that found nothing is still a scan: nmap writes it, exits 0, and the
  // runstats line says why. The import flow decides what to do with it – this
  // reader only reports it.
  const start = attr(run, 'start');
  const finished = child(child(run, 'runstats'), 'finished');
  const elapsed = attr(finished, 'elapsed');

  return {
    fileName,
    args: attr(run, 'args'),
    version: attr(run, 'version'),
    startedAt: start ? new Date(Number(start) * 1000).toISOString() : undefined,
    elapsedSeconds: elapsed ? Number(elapsed) : undefined,
    summary: attr(finished, 'summary'),
    hosts,
    trace: trace.length > 0 ? trace : undefined,
  };
}
