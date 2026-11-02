import type { NmapHost, NmapScan } from '../model/types';

export const HOST_W = 216;
export const HOST_H = 96;
export const HOP_W = 156;
export const HOP_H = 54;
export const ORIGIN_W = 268;
export const ORIGIN_H = 68;
export const NOTE_W = 224;
export const NOTE_H = 150;

const PAD = 24;
const HEADER_H = 44;
const H_GAP = 16;
const V_GAP = 14;
const SUBNET_GAP = 36;
const MAX_ROW_W = 1760;
const MAX_COLS = 4;

export type PlacedHost = { host: NmapHost; x: number; y: number };
export type PlacedSubnet = {
  cidr: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hosts: PlacedHost[];
};
export type PlacedHop = { ip: string; depth: number; x: number; y: number; hostname?: string };

export type ScanLayout = {
  origin: { x: number; y: number };
  subnets: PlacedSubnet[];
  hops: PlacedHop[];
  width: number;
  height: number;
};

function ipParts(ip: string): number[] {
  return ip
    .replace(/::/g, ':0:')
    .split(/[.:]/)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareIp(a: string, b: string): number {
  const left = ipParts(a);
  const right = ipParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

export function subnetOf(ip: string): string {
  if (ip.includes(':')) {
    const parts = ip.split(':').filter((part) => part.length > 0);
    return `${parts[0] ?? '0000'}:${parts[1] ?? '0000'}::/64`;
  }
  const octets = ip.split('.');
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  return 'unrouted';
}

export function groupHosts(hosts: NmapHost[]): { cidr: string; hosts: NmapHost[] }[] {
  const buckets = new Map<string, NmapHost[]>();
  for (const host of hosts) {
    const cidr = subnetOf(host.ip);
    const bucket = buckets.get(cidr);
    if (bucket) bucket.push(host);
    else buckets.set(cidr, [host]);
  }
  return [...buckets.entries()]
    .map(([cidr, list]) => ({ cidr, hosts: [...list].sort((a, b) => compareIp(a.ip, b.ip)) }))
    .sort((a, b) => compareIp(a.cidr.replace('/24', '.0'), b.cidr.replace('/24', '.0')));
}

function layoutRoute(scan: NmapScan): { hops: PlacedHop[]; bottom: number } {
  const depthByIp = new Map<string, number>();
  for (const host of scan.hosts) {
    host.hops.forEach((ip, index) => {
      const depth = index + 1;
      if ((depthByIp.get(ip) ?? 0) < depth) depthByIp.set(ip, depth);
    });
  }

  const byDepth = new Map<number, string[]>();
  for (const [ip, depth] of depthByIp) {
    const column = byDepth.get(depth);
    if (column) column.push(ip);
    else byDepth.set(depth, [ip]);
  }

  const hops: PlacedHop[] = [];
  const names = new Map((scan.trace ?? []).filter((hop) => hop.host).map((hop) => [hop.ip, hop.host as string]));
  let bottom = 0;
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const column = [...(byDepth.get(depth) ?? [])].sort(compareIp);
    column.forEach((ip, row) => {
      const y = row * (HOP_H + 12);
      hops.push({ ip, depth, x: ORIGIN_W + 140 + (depth - 1) * (HOP_W + 84), y, hostname: names.get(ip) });
      bottom = Math.max(bottom, y + HOP_H);
    });
  }
  return { hops, bottom };
}

export function layoutScan(scan: NmapScan): ScanLayout {
  const route = layoutRoute(scan);
  const top = Math.max(route.bottom, ORIGIN_H) + 96;

  const subnets: PlacedSubnet[] = [];
  let cursorX = 0;
  let cursorY = top;
  let rowHeight = 0;

  for (const group of groupHosts(scan.hosts)) {
    const count = group.hosts.length;
    const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(Math.sqrt(count))));
    const rows = Math.ceil(count / cols);
    const innerW = cols * HOST_W + (cols - 1) * H_GAP;
    const innerH = rows * HOST_H + (rows - 1) * V_GAP;
    const w = innerW + PAD * 2;
    const h = innerH + PAD * 2 + HEADER_H;

    if (cursorX > 0 && cursorX + w > MAX_ROW_W) {
      cursorX = 0;
      cursorY += rowHeight + SUBNET_GAP;
      rowHeight = 0;
    }

    const placed: PlacedHost[] = group.hosts.map((host, index) => ({
      host,
      x: PAD + (index % cols) * (HOST_W + H_GAP),
      y: PAD + HEADER_H + Math.floor(index / cols) * (HOST_H + V_GAP),
    }));

    subnets.push({ cidr: group.cidr, x: cursorX, y: cursorY, w, h, hosts: placed });
    cursorX += w + SUBNET_GAP;
    rowHeight = Math.max(rowHeight, h);
  }

  const width = Math.max(
    ORIGIN_W,
    ...subnets.map((s) => s.x + s.w),
    ...route.hops.map((h) => h.x + HOP_W),
  );
  const height = Math.max(ORIGIN_H, ...subnets.map((s) => s.y + s.h));

  return { origin: { x: 0, y: 0 }, subnets, hops: route.hops, width, height };
}
