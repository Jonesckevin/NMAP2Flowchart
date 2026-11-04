export type NmapScript = {
  id: string;
  output: string;
};

export type NmapPort = {
  port: number;
  protocol: string;
  state: string;
  service?: string;
  product?: string;
  version?: string;
  extrainfo?: string;
  scripts: NmapScript[];
};

export type NmapOsMatch = {
  name: string;
  accuracy: number;
};

export type NmapMac = {
  addr: string;
  vendor?: string;
};

export type NmapTraceHop = {
  ip: string;
  ttl: number;
  rtt?: number;
  host?: string;
};

export type NmapHost = {
  id: string;
  ip: string;
  ipv6?: string;
  addresses?: string[];
  mac?: string;
  vendor?: string;
  macs?: NmapMac[];
  hostnames: string[];
  status: string;
  os: NmapOsMatch[];
  ports: NmapPort[];
  portsScanned?: boolean;
  scripts: NmapScript[];
  hops: string[];
};

export type NmapScan = {
  fileName: string;
  args?: string;
  version?: string;
  startedAt?: string;
  elapsedSeconds?: number;
  hosts: NmapHost[];
  trace?: NmapTraceHop[];
};

export type Workspace = {
  version: 1;
  scan: NmapScan;
  positions: [string, { x: number; y: number }][];
  collapsed: string[];
};

export function openPorts(host: NmapHost): NmapPort[] {
  return host.ports.filter((p) => p.state === 'open' || p.state === 'open|filtered');
}

export function discoveryOnly(host: NmapHost): boolean {
  return host.portsScanned === false;
}

export function portSummaryOr(host: NmapHost, fallback: string, limit = 6): string {
  const summary = portSummary(host, limit);
  if (summary) return summary;
  return discoveryOnly(host) ? fallback : 'no open ports';
}

export function hostLabel(host: NmapHost): string {
  return host.hostnames.find((name) => name.trim()) ?? host.mac ?? 'unnamed host';
}

export function serviceLabel(port: NmapPort): string {
  if (port.product) {
    return [port.product, port.version].filter(Boolean).join(' ');
  }
  return port.service ?? 'unknown';
}

export function portSummary(host: NmapHost, limit = 6): string {
  const open = openPorts(host);
  const shown = open.slice(0, limit).map((p) => (p.service ? `${p.port}/${p.service}` : `${p.port}`));
  const rest = open.length - shown.length;
  if (rest > 0) shown.push(`+${rest}`);
  return shown.join(', ');
}
