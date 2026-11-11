import type { DiagramDoc, DiagramNode } from '../doc/types';
import { compareIp, subnetOf } from '../graph/layout';
import { classifyHost, macsOf, withHopEvidence, NETWORK_KINDS, type DeviceKind, type DeviceProfile, type OsFamily } from '../model/device';
import { openPorts, type NmapHost } from '../model/types';

/**
 * "Try to connect": what the diagram already knows about a network, read as
 * relationships instead of as cards.
 *
 * Everything here is derived from data an import put in the document – the
 * traceroute chain on each host, its MAC address, its PTR names, its /24 – so the
 * result is evidence, not invention: every router, gateway and link carries how it
 * was found, and `analyzeConnections` never touches the document.
 */

export type ConnectLinkKind = 'same-mac' | 'same-hostname' | 'address-alias';

export type ConnectEvidence = 'trace' | 'subnet' | 'site' | 'none';

/** What a card looks like it is, as far as the scan data says. */
export type ConnectRole = 'router' | 'switch' | 'host';

export const CONNECT_LINK_LABELS: Record<ConnectLinkKind, string> = {
  'same-mac': 'same MAC',
  'same-hostname': 'same name',
  'address-alias': 'same device',
};

export type ConnectHost = {
  ip: string;
  /** Every address the imports reported for this device, `ip` first. */
  addresses: string[];
  /** The richest scan record for this address (most ports, then most names). */
  host: NmapHost;
  /** The node the card is copied from, so label, notes and accent travel along. */
  sourceNodeId: string;
  hostnames: string[];
  macs: string[];
  vendor?: string;
  /** A different MAC was seen for this address in another import. */
  macChanged: boolean;
  /** Router addresses in front of the host, outermost first, host excluded. */
  path: string[];
  segment: string;
  role: ConnectRole;
  /** Why the card is read as a router or a switch; `undefined` for a plain host. */
  roleReason?: string;
  /** What the signatures say the box is – camera, printer, switch, server… */
  kind: DeviceKind;
  /** The platform the signatures point at. */
  os: OsFamily;
  /** Set when the NIC belongs to a hypervisor: `Proxmox VE`, `VMware`, `KVM/QEMU`… */
  virtual?: string;
  /** Layers that contributed to this card. */
  layers: string[];
};

export type ConnectRouter = {
  ip: string;
  hostnames: string[];
  /** 1-based position of the router in the path closest to the scan origin. */
  depth: number;
  /** Router directly in front, `null` for a router the scan reached first. */
  parent: string | null;
  /** Host IPs whose trace ends at this router. */
  served: string[];
  segment: string;
};

export type ConnectSegment = {
  cidr: string;
  hosts: string[];
  /** Cards read as routers that no trace places in the tree, in chain order. */
  devices: string[];
  /** Cards read as switches, in chain order – layer 2 sits closest to the cards. */
  switches: string[];
  gateway: string | null;
  /**
   * The devices the subnet hangs behind, outermost first, ending with the card
   * the frame is drawn beside. A gateway that lives in a *different* subnet sits
   * inside the ones that do: its WAN side is on this wire.
   */
  chain: string[];
  /** Device the frame hangs from: the last of the chain. */
  anchor: string | null;
  evidence: ConnectEvidence;
};

export type ConnectLink = {
  kind: ConnectLinkKind;
  a: string;
  b: string;
  label: string;
};

export type ConnectFinding = {
  tone: 'route' | 'mac' | 'name' | 'device' | 'note';
  title: string;
  detail: string;
};

export type ConnectionStats = {
  hosts: number;
  routers: number;
  segments: number;
  /** Cards read as switches (outside a subnet frame in the map). */
  switches: number;
  /** Cards read as routers that no trace puts in the tree. */
  devices: number;
  /** Router cards that turned out to be one box with a WAN and a LAN address. */
  pairs: number;
  layers: number;
  /** Hosts with at least one hop in front of them. */
  traced: number;
  /** Hosts the imports only placed, without a traceroute. */
  untraced: number;
  /** Untraced hosts that will be joined to their gateway (routers excluded). */
  joinable: number;
  /** Host cards with neither an address nor a hostname, so they cannot be joined. */
  unaddressed: number;
  /** Route edges the map will draw: one per router plus one per traced host. */
  routes: number;
  links: Record<ConnectLinkKind, number>;
  /** What the signatures say the cards are, commonest first. */
  kinds: { kind: DeviceKind; count: number }[];
  /** The platforms the signatures point at, commonest first. */
  systems: { os: OsFamily; count: number }[];
  /** Cards whose NIC only exists inside a hypervisor. */
  virtual: number;
  /** The hypervisors those NICs belong to, commonest first. */
  platforms: { platform: string; count: number }[];
};

export type ConnectionAnalysis = {
  origin: { label: string; address: string; subtitle: string };
  hosts: ConnectHost[];
  routers: ConnectRouter[];
  segments: ConnectSegment[];
  links: ConnectLink[];
  findings: ConnectFinding[];
  stats: ConnectionStats;
};

type HostSeed = {
  best: NmapHost;
  bestScore: number;
  bestNodeId: string;
  /** The classification of the record with the most evidence, not of `best`. */
  profile: DeviceProfile;
  profileStrength: number;
  hostnames: string[];
  macs: string[];
  macVendors: string[];
  addresses: string[];
  layers: string[];
  path: string[];
  pathKey: string;
};

const unique = (values: string[]): string[] => [...new Set(values.filter((value) => value.trim().length > 0))];

function segmentSortKey(cidr: string): string {
  return cidr.split('/')[0] ?? cidr;
}

/** A scan record is "richer" when it actually probed ports and found names. */
function hostScore(host: NmapHost): number {
  return (
    (host.portsScanned === false ? 0 : 2000) +
    openPorts(host).length * 10 +
    host.ports.length +
    host.hostnames.length * 2 +
    (host.mac ? 1 : 0)
  );
}

/**
 * How much a classification is worth. One import may probe a box and another may
 * only trace past it, so the card's *device* is read from whichever record has
 * the most to say – never from whichever happened to be imported last.
 */
function profileStrength(profile: DeviceProfile): number {
  return (
    (profile.strongKind ? 100 : 0) +
    (profile.signatureKind ? 50 : 0) +
    (profile.kind !== 'unknown' ? 20 : 0) +
    (profile.os !== 'unknown' ? 10 : 0) +
    profile.kindEvidence.length +
    profile.osEvidence.length
  );
}

function addressesOf(host: NmapHost): string[] {
  return unique([host.ip, host.ipv6 ?? '', ...(host.addresses ?? [])]);
}

/**
 * The traceroute chain with the target itself removed: nmap ends the trace at the
 * host, and a one-entry trace that names the host itself means "on link", not
 * "there is a router called the same thing".
 */
function tracePath(host: NmapHost): string[] {
  return host.hops.filter((ip) => ip.length > 0 && ip !== host.ip);
}

/**
 * Routers and switches are what a subnet hangs behind, so they are drawn outside
 * its frame. The shared classifier decides what a card is; a role is only taken
 * from a categorical signature – `osclass`, `-sV` devicetype, CPE, NSE, router
 * firmware, the name it answers to, the NIC vendor, or the traceroute path – a
 * port guess never moves a card out of a frame.
 */
function roleOf(profile: DeviceProfile): { role: ConnectRole; reason?: string } {
  if (!profile.strongKind) return { role: 'host' };
  if (profile.kind === 'switch' || profile.kind === 'bridge' || profile.kind === 'hub') {
    return { role: 'switch', reason: profile.kindEvidence[0]?.detail };
  }
  if (profile.kind === 'router' || profile.kind === 'firewall') {
    return { role: 'router', reason: profile.kindEvidence[0]?.detail };
  }
  return { role: 'host' };
}

function mergeHosts(nodes: DiagramNode[], layerNames: Map<string, string>): ConnectHost[] {
  const seeds = new Map<string, HostSeed>();

  for (const node of nodes) {
    const host = node.host;
    if (node.kind !== 'host' || !host?.ip) continue;

    const path = tracePath(host);
    const score = hostScore(host);
    const profile = classifyHost(host);
    const strength = profileStrength(profile);
    const seed = seeds.get(host.ip);
    const layerName = layerNames.get(node.layerId);

    if (!seed) {
      seeds.set(host.ip, {
        best: host,
        bestScore: score,
        bestNodeId: node.id,
        profile,
        profileStrength: strength,
        hostnames: unique(host.hostnames),
        macs: macsOf(host),
        macVendors: unique([host.vendor ?? '', ...(host.macs ?? []).map((entry) => entry.vendor ?? '')]),
        addresses: addressesOf(host),
        layers: layerName ? [layerName] : [],
        path,
        pathKey: path.join('>'),
      });
      continue;
    }

    if (score > seed.bestScore) {
      seed.best = host;
      seed.bestScore = score;
      seed.bestNodeId = node.id;
    }
    if (strength > seed.profileStrength) {
      seed.profile = profile;
      seed.profileStrength = strength;
    }
    seed.hostnames = unique([...seed.hostnames, ...host.hostnames]);
    seed.macs = unique([...seed.macs, ...macsOf(host)]).sort();
    seed.macVendors = unique([
      ...seed.macVendors,
      host.vendor ?? '',
      ...(host.macs ?? []).map((entry) => entry.vendor ?? ''),
    ]);
    seed.addresses = unique([...seed.addresses, ...addressesOf(host)]);
    if (layerName && !seed.layers.includes(layerName)) seed.layers.push(layerName);
    // The longest trace is the one with something to say; ties break on the
    // chain itself so two runs of the same import always agree.
    const key = path.join('>');
    if (path.length > seed.path.length || (path.length === seed.path.length && key < seed.pathKey)) {
      seed.path = path;
      seed.pathKey = key;
    }
  }

  // Every address some host's trace passes through, which proves it forwards.
  const hopIps = new Set([...seeds.values()].flatMap((seed) => seed.path));

  return [...seeds.entries()].sort(([a], [b]) => compareIp(a, b)).map(([ip, seed]) => {
    // A trace that passes *through* an address proves it forwards packets, which
    // is what a router does – whatever else the box also serves.
    const profile = hopIps.has(ip) ? withHopEvidence(seed.profile) : seed.profile;
    const { role, reason } = roleOf(profile);
    return {
      ip,
      addresses: unique([ip, ...seed.addresses]),
      host: seed.best,
      sourceNodeId: seed.bestNodeId,
      hostnames: seed.hostnames,
      macs: seed.macs,
      vendor: seed.macVendors[0] ?? seed.best.vendor,
      macChanged: seed.macs.length > 1,
      path: seed.path,
      segment: subnetOf(ip),
      role,
      roleReason: reason,
      kind: profile.kind,
      os: profile.os,
      virtual: profile.virtual,
      layers: seed.layers,
    } satisfies ConnectHost;
  });
}

function hostnamesOfHops(nodes: DiagramNode[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const node of nodes) {
    if (node.kind !== 'hop' || !node.address || !node.subtitle) continue;
    if (!names.has(node.address)) names.set(node.address, node.subtitle);
  }
  return names;
}

function deriveRouters(hosts: ConnectHost[], nodes: DiagramNode[]): ConnectRouter[] {
  const votes = new Map<
    string,
    { depth: number; parents: Map<string | null, number>; served: Set<string> }
  >();

  const vote = (ip: string) => {
    const existing = votes.get(ip);
    if (existing) return existing;
    const created = {
      depth: Number.POSITIVE_INFINITY,
      parents: new Map<string | null, number>(),
      served: new Set<string>(),
    };
    votes.set(ip, created);
    return created;
  };

  for (const host of hosts) {
    host.path.forEach((ip, index) => {
      const entry = vote(ip);
      entry.depth = Math.min(entry.depth, index + 1);
      const parent = index === 0 ? null : host.path[index - 1];
      entry.parents.set(parent, (entry.parents.get(parent) ?? 0) + 1);
    });
    const last = host.path[host.path.length - 1];
    if (last) votes.get(last)?.served.add(host.ip);
  }

  // A hop card left by an earlier import names a device even when the host
  // records no longer carry that trace. A hop that is also a host is not extra
  // information – the host card already covers it.
  const hostIps = new Set(hosts.map((host) => host.ip));
  const hopNames = hostnamesOfHops(nodes);
  for (const node of nodes) {
    if (node.kind !== 'hop' || !node.address) continue;
    if (hostIps.has(node.address) || votes.has(node.address)) continue;
    const entry = vote(node.address);
    entry.depth = Math.min(entry.depth, Math.max(1, node.depth ?? 1));
    entry.parents.set(null, 1);
  }

  const routers: ConnectRouter[] = [...votes.entries()].map(([ip, entry]) => {
    let parent: string | null = null;
    let bestCount = -1;
    for (const [candidate, count] of [...entry.parents.entries()].sort(([a], [b]) =>
      String(a ?? '').localeCompare(String(b ?? '')),
    )) {
      // A tie goes to "entry router": it is the shallower, safer reading.
      if (count > bestCount || (count === bestCount && candidate === null)) {
        parent = candidate;
        bestCount = count;
      }
    }
    const host = hosts.find((item) => item.ip === ip);
    return {
      ip,
      hostnames: unique([...(host?.hostnames ?? []), hopNames.get(ip) ?? '']),
      depth: entry.depth,
      parent,
      served: [...entry.served].sort(compareIp),
      segment: subnetOf(ip),
    } satisfies ConnectRouter;
  });

  // A parent must be nearer the origin than its child; dropping the rest breaks
  // every loop a contradictory trace could describe.
  const byIp = new Map(routers.map((router) => [router.ip, router]));
  for (const router of routers) {
    if (router.parent === null) continue;
    const parent = byIp.get(router.parent);
    if (!parent || parent.depth >= router.depth) router.parent = null;
  }

  return routers.sort((a, b) => (a.depth === b.depth ? compareIp(a.ip, b.ip) : a.depth - b.depth));
}

/**
 * The devices a subnet hangs behind, outermost first. A gateway that lives on
 * *this* wire is the outermost device; one that lives in another subnet is
 * reached through this one, so the routers here are upstream of it.
 */
function chainFor(hosts: string[], devices: string[], switches: string[], gateway: string | null): string[] {
  const onWire = gateway ? hosts.includes(gateway) : false;
  return unique([
    ...(gateway && onWire ? [gateway] : []),
    ...devices,
    ...(gateway && !onWire ? [gateway] : []),
    ...switches,
  ]);
}

/** The card a frame is drawn beside: the last device that lives on its own wire. */
function anchorFor(hosts: string[], chain: string[]): string | null {
  return [...chain].reverse().find((ip) => hosts.includes(ip)) ?? chain.at(-1) ?? null;
}

function deriveSegments(hosts: ConnectHost[], routers: ConnectRouter[]): ConnectSegment[] {
  const segments = new Map<string, ConnectSegment>();
  const ensure = (cidr: string): ConnectSegment => {
    const existing = segments.get(cidr);
    if (existing) return existing;
    const created: ConnectSegment = {
      cidr,
      hosts: [],
      devices: [],
      switches: [],
      gateway: null,
      chain: [],
      anchor: null,
      evidence: 'none',
    };
    segments.set(cidr, created);
    return created;
  };

  const hostsByCidr = new Map<string, ConnectHost[]>();
  for (const host of hosts) {
    const segment = ensure(host.segment);
    segment.hosts.push(host.ip);
    if (host.path.length > 0) segment.evidence = 'trace';
    const bucket = hostsByCidr.get(host.segment);
    if (bucket) bucket.push(host);
    else hostsByCidr.set(host.segment, [host]);
  }

  const routersByCidr = new Map<string, string[]>();
  for (const router of routers) {
    const bucket = routersByCidr.get(router.segment);
    if (bucket) bucket.push(router.ip);
    else routersByCidr.set(router.segment, [router.ip]);
  }

  const traceRouters = new Set(routers.map((router) => router.ip));

  // The gateway of a subnet is the router most traces inside it end at.
  const votes = new Map<string, Map<string, number>>();
  for (const host of hosts) {
    const last = host.path[host.path.length - 1];
    if (!last) continue;
    const bucket = votes.get(host.segment) ?? new Map<string, number>();
    bucket.set(last, (bucket.get(last) ?? 0) + 1);
    votes.set(host.segment, bucket);
  }

  for (const segment of segments.values()) {
    const bucket = votes.get(segment.cidr);
    if (bucket && bucket.size > 0) {
      let gateway = '';
      let bestCount = -1;
      for (const [ip, count] of bucket) {
        if (count > bestCount || (count === bestCount && compareIp(ip, gateway) < 0)) {
          gateway = ip;
          bestCount = count;
        }
      }
      segment.gateway = gateway;
    } else if ((routersByCidr.get(segment.cidr) ?? []).length > 0) {
      // No trace ends inside this subnet: the router nearest the origin is the
      // best reading of "what this segment sits behind".
      const candidates = routers
        .filter((router) => router.segment === segment.cidr)
        .sort((a, b) => a.depth - b.depth || compareIp(a.ip, b.ip));
      segment.gateway = candidates[0]?.ip ?? null;
      if (segment.evidence === 'none') segment.evidence = 'subnet';
    } else {
      // No trace ends here and no router lives on this wire, but a router the scan
      // found in the same site does: a /22 is drawn as four /24s, and the gateway of
      // the network the scan covered fronts all of them.
      const site = (ip: string) => ip.split('.').slice(0, 2).join('.');
      const nearby = routers
        .filter((router) => site(router.segment) === site(segment.cidr))
        .sort((a, b) => a.depth - b.depth || compareIp(a.ip, b.ip))[0];
      if (nearby) {
        segment.gateway = nearby.ip;
        if (segment.evidence === 'none') segment.evidence = 'site';
      }
    }

    // Routers and switches belong outside the frame: they are what the frame
    // hangs from. Routers first (L3), switches last (L2, closest to the cards).
    const inSegment = hostsByCidr.get(segment.cidr) ?? [];
    const lifted = inSegment.filter((host) => host.role !== 'host' && !traceRouters.has(host.ip));
    segment.devices = lifted
      .filter((host) => host.role === 'router')
      .map((host) => host.ip)
      .sort(compareIp);
    segment.switches = lifted
      .filter((host) => host.role === 'switch')
      .map((host) => host.ip)
      .sort(compareIp);

    segment.chain = chainFor(segment.hosts, segment.devices, segment.switches, segment.gateway);
    segment.anchor = anchorFor(segment.hosts, segment.chain);
    segment.hosts.sort(compareIp);
  }

  return [...segments.values()].sort((a, b) => compareIp(segmentSortKey(a.cidr), segmentSortKey(b.cidr)));
}

type RouterPair = { lan: string; wan: string; shared: number };

/**
 * Kinds that can be the other end of a router: L3 boxes and access points. A
 * switch, bridge or hub is layer 2 and cannot be a router's other address.
 */
const PAIR_KINDS: ReadonlySet<DeviceKind> = new Set(
  [...NETWORK_KINDS].filter((kind) => kind !== 'switch' && kind !== 'bridge' && kind !== 'hub'),
);

/**
 * One box, two addresses. A router that fronts a subnet it does not live in is
 * reached *through* that subnet – its WAN side is on that wire – and when a card
 * on the wire is also read as a router and the two answer on the same services,
 * they are the LAN and WAN address of one device. Drawing both would put the same
 * box in the tree twice.
 *
 * The evidence has to be strong: two routers on one LAN is an ordinary setup, and
 * merging them would hide a hop. Two shared services and half the smaller port set
 * is the bar, and a tie between candidates means "two routers", not one.
 */
function collapseRouterPairs(
  hosts: ConnectHost[],
  routers: ConnectRouter[],
  segments: ConnectSegment[],
): { hosts: ConnectHost[]; routers: ConnectRouter[]; segments: ConnectSegment[]; pairs: RouterPair[] } {
  const hostByIp = new Map(hosts.map((host) => [host.ip, host]));
  const pairs: RouterPair[] = [];
  const merged = new Map<string, string>();

  const portsOf = (host: ConnectHost) => new Set(openPorts(host.host).map((port) => port.port));
  const sharedPorts = (a: ConnectHost, b: ConnectHost) => {
    const ports = portsOf(a);
    let shared = 0;
    for (const port of portsOf(b)) if (ports.has(port)) shared += 1;
    return shared;
  };

  for (const segment of segments) {
    const card = segment.gateway ? hostByIp.get(segment.gateway) : undefined;
    if (!card || card.role !== 'router') continue;
    if (segment.hosts.includes(card.ip)) continue;
    // The WAN side of a router often fingerprints as an access point (the UPnP
    // description of an ASUS says `devicetype=WAP`), so any network gear counts.
    const candidates = segment.hosts
      .filter((ip) => ip !== card.ip)
      .map((ip) => hostByIp.get(ip))
      .flatMap((host) => (host && PAIR_KINDS.has(host.kind) ? [host] : []))
      .map((host) => ({
        host,
        shared: sharedPorts(host, card),
        ceiling: Math.min(portsOf(host).size, portsOf(card).size),
      }))
      .filter((entry) => entry.shared >= 2 && entry.shared >= entry.ceiling / 2)
      .sort((a, b) => b.shared - a.shared || compareIp(a.host.ip, b.host.ip));
    if (candidates.length === 0) continue;
    if (candidates.length > 1 && candidates[0].shared === candidates[1].shared) continue;

    const wan = candidates[0].host;
    pairs.push({ lan: card.ip, wan: wan.ip, shared: candidates[0].shared });
    merged.set(wan.ip, card.ip);
    // The card speaks for both addresses, and says so.
    card.addresses = unique([...card.addresses, ...wan.addresses]);
    card.hostnames = unique([...card.hostnames, ...wan.hostnames]);
    card.macs = unique([...card.macs, ...wan.macs]).sort();
    card.macChanged = card.macs.length > 1;
    if (!card.vendor) card.vendor = wan.vendor;
    if (card.kind === 'unknown' && wan.kind !== 'unknown') card.kind = wan.kind;
    if (card.os === 'unknown' && wan.os !== 'unknown') card.os = wan.os;
    card.virtual ??= wan.virtual;
    for (const layer of wan.layers) if (!card.layers.includes(layer)) card.layers.push(layer);
  }

  if (merged.size === 0) return { hosts, routers, segments, pairs };

  const remap = (ip: string) => merged.get(ip) ?? ip;
  const keptHosts = hosts.filter((host) => !merged.has(host.ip));
  for (const host of keptHosts) host.path = host.path.map(remap).filter((ip) => ip !== host.ip);

  const keptSegments = segments.map((segment) => {
    const drop = (ips: string[]) => unique(ips.filter((ip) => !merged.has(ip)));
    const hosts = drop(segment.hosts);
    const devices = drop(segment.devices);
    const switches = drop(segment.switches);
    const gateway = segment.gateway ? remap(segment.gateway) : null;
    // Rebuild the order rather than remap it: the merged address was a device on
    // this wire, and it must not jump in front of the routers that stay there.
    const chain = chainFor(hosts, devices, switches, gateway);
    return {
      ...segment,
      hosts,
      devices,
      switches,
      gateway,
      chain,
      anchor: anchorFor(hosts, chain),
    };
  });

  const keptRouters = routers
    .filter((router) => !merged.has(router.ip))
    .map((router) => (router.parent ? { ...router, parent: remap(router.parent) } : router));

  return { hosts: keptHosts, routers: keptRouters, segments: keptSegments, pairs };
}

/**
 * A router that hangs inside another subnet's chain is downstream of that subnet's
 * own routers: the wire it is reached over belongs to them.
 */
function orderNestedRouters(routers: ConnectRouter[], segments: ConnectSegment[]): void {
  const byIp = new Map(routers.map((router) => [router.ip, router]));
  for (const segment of segments) {
    if (segment.chain.length < 2) continue;
    const inner = byIp.get(segment.chain[segment.chain.length - 1]);
    if (!inner || inner.parent) continue;
    const outerIp = segment.chain[segment.chain.length - 2];
    const outer = byIp.get(outerIp);
    // A trace that already puts the outer router deeper is a contradiction, not a hint.
    if (outer && outer.depth >= inner.depth) continue;
    inner.parent = outerIp;
    inner.depth = (outer?.depth ?? 1) + 1;
  }
  routers.sort((a, b) => (a.depth === b.depth ? compareIp(a.ip, b.ip) : a.depth - b.depth));
}

function inferLinks(hosts: ConnectHost[]): ConnectLink[] {
  const links: ConnectLink[] = [];
  const seen = new Set<string>();
  const add = (kind: ConnectLinkKind, a: string, b: string) => {
    if (a === b) return;
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    links.push({ kind, a, b, label: CONNECT_LINK_LABELS[kind] });
  };

  // One physical device, more than one address: DHCP moved it, or it has two NICs.
  const byMac = new Map<string, string[]>();
  for (const host of hosts) {
    for (const mac of host.macs) {
      const bucket = byMac.get(mac);
      if (bucket) bucket.push(host.ip);
      else byMac.set(mac, [host.ip]);
    }
  }
  for (const [, ips] of [...byMac.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...ips].sort(compareIp);
    for (const other of sorted.slice(1)) add('same-mac', sorted[0], other);
  }

  const byName = new Map<string, string[]>();
  for (const host of hosts) {
    for (const name of host.hostnames) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      const bucket = byName.get(key);
      if (bucket) bucket.push(host.ip);
      else byName.set(key, [host.ip]);
    }
  }
  for (const [, ips] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...ips].sort(compareIp);
    for (const other of sorted.slice(1)) add('same-hostname', sorted[0], other);
  }

  // An import that reported two addresses for one host, of which the other one is
  // a card of its own.
  const byIp = new Map(hosts.map((host) => [host.ip, host]));
  for (const host of hosts) {
    for (const address of host.addresses) {
      if (address === host.ip) continue;
      const twin = byIp.get(address);
      if (twin) add('address-alias', host.ip, twin.ip);
    }
  }

  return links.sort((a, b) =>
    a.kind === b.kind ? compareIp(a.a, b.a) || compareIp(a.b, b.b) : a.kind.localeCompare(b.kind),
  );
}

function baseDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  return labels.slice(-2).join('.');
}

function buildFindings(
  hosts: ConnectHost[],
  routers: ConnectRouter[],
  segments: ConnectSegment[],
  links: ConnectLink[],
): ConnectFinding[] {
  const findings: ConnectFinding[] = [];
  const routerByIp = new Map(routers.map((router) => [router.ip, router]));
  const hostByIp = new Map(hosts.map((host) => [host.ip, host]));

  for (const segment of segments) {
    if (!segment.gateway || segment.hosts.length === 0) continue;
    const router = routerByIp.get(segment.gateway);
    const behind = segment.hosts.filter((ip) => hostByIp.get(ip)?.path.at(-1) === segment.gateway).length;
    const name = router?.hostnames[0];
    const how =
      behind > 0
        ? `${behind} of ${segment.hosts.length} host${segment.hosts.length === 1 ? '' : 's'} traced through it`
        : segment.evidence === 'site'
          ? 'no trace reaches this subnet – the router the scan found on this site fronts it'
          : segment.evidence === 'subnet'
            ? 'no trace ends here – the nearest router found in this subnet fronts it'
            : 'the only router the imports place inside this subnet';
    findings.push({
      tone: 'route',
      title: `${segment.gateway} fronts ${segment.cidr}`,
      detail: `${how}${name ? ` · ${name}` : ''}`,
    });
  }

  for (const router of routers) {
    if (!router.parent || router.served.length === 0) continue;
    findings.push({
      tone: 'route',
      title: `${router.ip} sits behind ${router.parent}`,
      detail: `${router.served.length} host${router.served.length === 1 ? '' : 's'} traced through it${router.hostnames[0] ? ` · ${router.hostnames[0]}` : ''}`,
    });
  }

  // Routers and switches the imports *name* rather than trace.
  for (const segment of segments) {
    if (segment.hosts.length === 0) continue;
    for (const ip of [...segment.devices, ...segment.switches]) {
      const host = hostByIp.get(ip);
      if (!host) continue;
      findings.push({
        tone: 'device',
        title: `${ip} reads as a ${host.role}`,
        detail: `${host.roleReason ?? 'network gear'} · kept outside the ${segment.cidr} frame`,
      });
    }
  }

  for (const link of links) {
    if (link.kind !== 'same-mac') continue;
    const a = hostByIp.get(link.a);
    const b = hostByIp.get(link.b);
    const mac = a?.macs.find((entry) => b?.macs.includes(entry));
    findings.push({
      tone: 'mac',
      title: `${link.a} and ${link.b} look like one device`,
      detail: `both report MAC ${mac ?? 'the same address'}${a?.vendor ? ` · ${a.vendor}` : ''}`,
    });
  }

  for (const host of hosts) {
    if (!host.macChanged) continue;
    findings.push({
      tone: 'mac',
      title: `${host.ip} changed hardware between imports`,
      detail: `seen with ${host.macs.join(' and ')}`,
    });
  }

  const untraced = hosts.filter((host) => host.path.length === 0);
  const routerIps = new Set(routers.map((router) => router.ip));
  const joinable = untraced.filter((host) => !routerIps.has(host.ip)).length;
  if (joinable > 0 && hosts.length > 1) {
    findings.push({
      tone: 'note',
      title: `${joinable} of ${hosts.length} host${hosts.length === 1 ? '' : 's'} ${
        joinable === 1 ? 'has' : 'have'
      } no traceroute`,
      detail: 'placed behind the gateway of their /24 instead of on a traced path',
    });
  }
  const domains = new Map<string, string[]>();
  for (const host of hosts) {
    for (const name of host.hostnames) {
      const domain = baseDomain(name);
      if (!domain.includes('.')) continue;
      const bucket = domains.get(domain);
      if (!bucket) domains.set(domain, [host.ip]);
      else if (!bucket.includes(host.ip)) bucket.push(host.ip);
    }
  }
  for (const [domain, ips] of [...domains.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (ips.length < 3) continue;
    findings.push({
      tone: 'name',
      title: `${ips.length} hosts resolve under ${domain}`,
      detail: 'same PTR domain – likely one site or one DHCP scope',
    });
  }

  if (hosts.length === 0) {
    findings.push({
      tone: 'note',
      title: 'No hosts to connect',
      detail: 'import an nmap scan before running this',
    });
  }

  return findings;
}

export function analyzeConnections(doc: DiagramDoc): ConnectionAnalysis {
  const layerNames = new Map(doc.layers.map((layer) => [layer.id, layer.name]));
  // Notes are the user's own commentary, never a network fact.
  const nodes = doc.nodes.filter((node) => node.kind !== 'note');

  const found = mergeHosts(nodes, layerNames);
  const traceRouters = deriveRouters(found, nodes);
  const foundSegments = deriveSegments(found, traceRouters);
  // A router with a WAN address and a LAN address is one box, not two hops.
  const collapsed = collapseRouterPairs(found, traceRouters, foundSegments);
  const hosts = collapsed.hosts;
  const routers = collapsed.routers;
  const segments = collapsed.segments;
  orderNestedRouters(routers, segments);
  const links = inferLinks(hosts);

  const traced = hosts.filter((host) => host.path.length > 0).length;
  const routerIps = new Set(routers.map((router) => router.ip));
  // Every router and switch is drawn outside the frames, so it is not "joined".
  const lifted = new Set([...routerIps, ...hosts.filter((host) => host.role !== 'host').map((host) => host.ip)]);
  const joinable = hosts.filter((host) => host.path.length === 0 && !lifted.has(host.ip)).length;
  const switches = hosts.filter((host) => host.role === 'switch').length;
  const devices = hosts.filter((host) => host.role === 'router' && !routerIps.has(host.ip)).length;
  const unaddressed = nodes.filter((node) => node.kind === 'host' && !node.host?.ip).length;
  const layers = new Set(hosts.flatMap((host) => host.layers));
  const linkCounts: Record<ConnectLinkKind, number> = {
    'same-mac': 0,
    'same-hostname': 0,
    'address-alias': 0,
  };
  for (const link of links) linkCounts[link.kind] += 1;

  const scannedSubnets = segments.filter((segment) => segment.hosts.length > 0).length;
  const scans = Math.max(1, layers.size);
  const kindCounts = new Map<DeviceKind, number>();
  for (const host of hosts) {
    if (host.kind === 'unknown') continue;
    kindCounts.set(host.kind, (kindCounts.get(host.kind) ?? 0) + 1);
  }
  const kinds = [...kindCounts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  const osCounts = new Map<OsFamily, number>();
  for (const host of hosts) {
    if (host.os === 'unknown') continue;
    osCounts.set(host.os, (osCounts.get(host.os) ?? 0) + 1);
  }
  const systems = [...osCounts.entries()]
    .map(([os, count]) => ({ os, count }))
    .sort((a, b) => b.count - a.count || a.os.localeCompare(b.os));
  const platformCounts = new Map<string, number>();
  for (const host of hosts) {
    if (!host.virtual) continue;
    platformCounts.set(host.virtual, (platformCounts.get(host.virtual) ?? 0) + 1);
  }
  const platforms = [...platformCounts.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform));
  const findings = buildFindings(hosts, routers, segments, links);
  for (const pair of collapsed.pairs) {
    const card = hosts.find((host) => host.ip === pair.lan);
    findings.push({
      tone: 'device',
      title: `${pair.lan} and ${pair.wan} are one router`,
      detail: `${pair.wan} is its WAN address, ${pair.lan} its LAN address · ${pair.shared} services on both${card?.hostnames[0] ? ` · ${card.hostnames[0]}` : ''}`,
    });
  }
  if (platforms.length > 0) {
    findings.push({
      tone: 'device',
      title: `${platforms.reduce((sum, entry) => sum + entry.count, 0)} cards sit on virtual NICs`,
      detail: platforms.map((entry) => `${entry.platform} × ${entry.count}`).join(' · '),
    });
  }
  if (unaddressed > 0) {
    findings.push({
      tone: 'note',
      title: `${unaddressed} host card${unaddressed === 1 ? ' has' : 's have'} no address`,
      detail: 'left out of the map – give the card an IP on its source layer first',
    });
  }
  // The preview shows the first few findings, so the order decides what a user
  // actually reads: what the network *is* comes before the long tail of notes.
  const toneRank: Record<ConnectFinding['tone'], number> = { route: 0, device: 1, mac: 2, name: 3, note: 4 };
  findings.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  return {
    origin: {
      label: 'Scan origin',
      address: doc.fileName,
      subtitle: `${scans} layer${scans === 1 ? '' : 's'} · ${hosts.length} hosts · ${scannedSubnets} subnet${scannedSubnets === 1 ? '' : 's'}`,
    },
    hosts,
    routers,
    segments,
    links,
    findings,
    stats: {
      hosts: hosts.length,
      routers: routers.length,
      segments: scannedSubnets,
      switches,
      devices,
      pairs: collapsed.pairs.length,
      layers: layers.size,
      traced,
      untraced: hosts.length - traced,
      joinable,
      unaddressed,
      routes: routers.length + traced,
      links: linkCounts,
      kinds,
      systems,
      virtual: hosts.filter((host) => host.virtual).length,
      platforms,
    },
  };
}
