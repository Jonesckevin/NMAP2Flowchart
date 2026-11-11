import { SECTION_HEADER, SECTION_PAD } from '../doc/measure';
import {
  LAYER_COLORS,
  type DiagramDoc,
  type DiagramEdge,
  type DiagramNode,
  type Layer,
} from '../doc/types';
import { HOP_H, HOP_W, HOST_H, HOST_W, ORIGIN_H, ORIGIN_W, compareIp } from '../graph/layout';
import { detectIcon } from '../icons/registry';
import { DEVICE_KIND_ICONS } from '../model/device';
import type {
  ConnectHost,
  ConnectRouter,
  ConnectSegment,
  ConnectionAnalysis,
} from './analyze';

/**
 * Rebuilds the document as a network map: a copy of every host and router in a
 * new layer, laid out left to right from the scan origin along the paths the
 * analysis found, with route edges for observed traces and link edges for the
 * relationships inferred from MACs and names.
 *
 * The source layers are left exactly as they were – this returns a new document,
 * so the editor can put it on the undo stack.
 */

export type ConnectOptions = {
  /** Link hosts that report the same MAC address at different addresses. */
  macLinks: boolean;
  /** Link hosts that answer to the same PTR name. */
  hostnameLinks: boolean;
  /** Attach hosts without a traceroute to the gateway of their /24. */
  subnetLinks: boolean;
};

export const DEFAULT_CONNECT_OPTIONS: ConnectOptions = {
  macLinks: true,
  hostnameLinks: true,
  subnetLinks: true,
};

export const CONNECT_OPTION_HINTS: { key: keyof ConnectOptions; label: string; hint: string }[] = [
  {
    key: 'subnetLinks',
    label: 'Join hosts without a traceroute',
    hint: 'dotted by /24 and attached to the gateway the other traces found',
  },
  {
    key: 'macLinks',
    label: 'Link addresses that share a MAC',
    hint: 'one device with two addresses, or an address that moved',
  },
  {
    key: 'hostnameLinks',
    label: 'Link addresses that share a name',
    hint: 'an alias or a renamed host that kept its PTR record',
  },
];

export type ConnectResult = {
  doc: DiagramDoc;
  layerId: string;
  layerName: string;
  /** Nodes the new layer adds. */
  added: number;
  routes: number;
  links: number;
  hosts: number;
  /** Cards the map lifted out of a frame as switches. */
  switches: number;
};

const COL_GAP = 150;
const ROW_GAP = 34;
const H_GAP = 16;
const V_GAP = 14;
const MAP_COLS = 3;
const EDGE_PREFIX = 'map';

function slug(value: string): string {
  return value.replace(/[^0-9a-zA-Z./:]+/g, '_');
}

function uniqueLayerName(doc: DiagramDoc, base: string): string {
  const used = new Set(doc.layers.map((layer) => layer.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}

type PlanNode = {
  kind: 'origin' | 'router' | 'device' | 'segment';
  w: number;
  h: number;
  depth: number;
  subtree: number;
  x: number;
  y: number;
  children: PlanNode[];
  router?: ConnectRouter;
  segment?: ConnectSegment;
  /** A card lifted out of a frame because the imports name it a router or switch. */
  device?: ConnectHost;
  /** Host cards drawn inside a segment frame. */
  hosts?: ConnectHost[];
};

function grid(count: number): { cols: number; rows: number; w: number; h: number } {
  const cols = Math.min(MAP_COLS, Math.max(1, Math.ceil(Math.sqrt(count))));
  const rows = Math.ceil(count / cols);
  return {
    cols,
    rows,
    w: cols * HOST_W + (cols - 1) * H_GAP + SECTION_PAD * 2,
    h: rows * HOST_H + (rows - 1) * V_GAP + SECTION_PAD * 2 + SECTION_HEADER,
  };
}

function nextLayerColor(doc: DiagramDoc): string {
  const used = new Set(doc.layers.map((layer) => layer.color));
  return LAYER_COLORS.find((color) => !used.has(color)) ?? LAYER_COLORS[doc.layers.length % LAYER_COLORS.length];
}

export function buildConnectLayer(
  doc: DiagramDoc,
  analysis: ConnectionAnalysis,
  options: ConnectOptions = DEFAULT_CONNECT_OPTIONS,
): ConnectResult {
  const takenNodeIds = new Set(doc.nodes.map((node) => node.id));
  const claimNode = (base: string): string => {
    let id = base;
    for (let n = 2; takenNodeIds.has(id); n += 1) id = `${base}~${n}`;
    takenNodeIds.add(id);
    return id;
  };
  const takenLayerIds = new Set(doc.layers.map((layer) => layer.id));
  let layerId = `layer:${EDGE_PREFIX}`;
  for (let n = 2; takenLayerIds.has(layerId); n += 1) layerId = `layer:${EDGE_PREFIX}~${n}`;

  const layer: Layer = {
    id: layerId,
    name: uniqueLayerName(doc, 'Network map'),
    parentId: null,
    visible: true,
    color: nextLayerColor(doc),
  };

  const sourceById = new Map(doc.nodes.map((node) => [node.id, node]));
  const hostByIp = new Map(analysis.hosts.map((host) => [host.ip, host]));
  const segmentByCidr = new Map(analysis.segments.map((segment) => [segment.cidr, segment]));

  // The map is a second picture of the same network: dropping it under the
  // existing content keeps it findable after the focus is cleared.
  const bottomOf = (node: DiagramNode) =>
    node.position.y + (node.size?.h ?? (node.kind === 'section' ? 240 : 120));
  const offsetY = Math.max(0, ...doc.nodes.filter((node) => !node.parentId).map(bottomOf)) + 160;

  // ---- plan: routers and segments hang off the origin ----------------------
  const origin: PlanNode = {
    kind: 'origin',
    w: ORIGIN_W,
    h: ORIGIN_H,
    depth: 0,
    subtree: 0,
    x: 0,
    y: 0,
    children: [],
  };

  const routerPlans = new Map<string, PlanNode>();
  for (const router of analysis.routers) {
    const scanned = hostByIp.has(router.ip);
    const size = scanned ? { w: HOST_W, h: HOST_H } : { w: HOP_W, h: HOP_H };
    routerPlans.set(router.ip, {
      kind: 'router',
      w: size.w,
      h: size.h,
      depth: 0,
      subtree: 0,
      x: 0,
      y: 0,
      children: [],
      router,
    });
  }

  const segmentPlans = new Map<string, PlanNode>();

  // Cards the imports name as routers or switches are drawn outside the frame:
  // they are the devices a subnet hangs behind. The chain runs gateway → other
  // routers → switches, because layer 2 sits closest to the cards.
  const devicePlans = new Map<string, PlanNode>();
  const planFor = (ip: string | null | undefined): PlanNode | undefined =>
    ip ? (routerPlans.get(ip) ?? devicePlans.get(ip)) : undefined;

  for (const segment of analysis.segments) {
    for (const ip of segment.chain) {
      if (routerPlans.has(ip) || devicePlans.has(ip)) continue;
      const host = hostByIp.get(ip);
      if (!host) continue;
      devicePlans.set(ip, {
        kind: 'device',
        w: HOST_W,
        h: HOST_H,
        depth: 0,
        subtree: 0,
        x: 0,
        y: 0,
        children: [],
        device: host,
      });
    }
  }

  for (const segment of analysis.segments) {
    const hosts = segment.hosts
      .map((ip) => hostByIp.get(ip))
      .filter((host): host is ConnectHost => Boolean(host))
      // A router or switch is drawn once, as a device: it never also sits in a frame.
      .filter((host) => !routerPlans.has(host.ip) && !devicePlans.has(host.ip));
    if (hosts.length === 0) continue;
    const box = grid(hosts.length);
    segmentPlans.set(segment.cidr, {
      kind: 'segment',
      w: box.w,
      h: box.h,
      depth: 0,
      subtree: 0,
      x: 0,
      y: 0,
      children: [],
      segment,
      hosts,
    });
  }

  const sortChildren = (children: PlanNode[]) =>
    children.sort((a, b) => {
      const rank = (node: PlanNode) =>
        node.kind === 'router' ? 0 : node.kind === 'device' ? 1 : node.kind === 'segment' ? 2 : 3;
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      const left = a.router?.ip ?? a.device?.ip ?? a.segment?.cidr ?? '';
      const right = b.router?.ip ?? b.device?.ip ?? b.segment?.cidr ?? '';
      return compareIp(left, right);
    });

  for (const plan of routerPlans.values()) {
    // A router can hang from another router or from a router card drawn as a
    // device (a gateway whose own subnet no trace names).
    const parent = plan.router?.parent ? planFor(plan.router.parent) : undefined;
    (parent ?? origin).children.push(plan);
  }

  for (const segment of analysis.segments) {
    // origin → … → the innermost device. The chain already starts with the gateway
    // when it lives on this wire; a router that hangs from another router is left
    // where the router tree put it.
    let parent = origin;
    for (const ip of segment.chain) {
      const plan = planFor(ip);
      if (!plan || plan === parent) continue;
      if (!plan.router && !parent.children.includes(plan)) parent.children.push(plan);
      parent = plan;
    }
    // The frame belongs to the device on its own wire: a gateway reached from
    // somewhere else is a router further in, not the one serving these cards.
    const frame = segmentPlans.get(segment.cidr);
    const owner = planFor(segment.anchor) ?? parent;
    if (frame) owner.children.push(frame);
  }
  for (const plan of [origin, ...routerPlans.values(), ...devicePlans.values()]) sortChildren(plan.children);

  // ---- layout: columns by depth, rows by subtree height --------------------
  const walk = (node: PlanNode, depth: number): void => {
    node.depth = depth;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(origin, 0);

  const columnW = new Map<number, number>();
  const measureColumns = (node: PlanNode): void => {
    columnW.set(node.depth, Math.max(columnW.get(node.depth) ?? 0, node.w));
    for (const child of node.children) measureColumns(child);
  };
  measureColumns(origin);

  const columnX = new Map<number, number>([[0, 0]]);
  const deepest = Math.max(...columnW.keys());
  for (let depth = 1; depth <= deepest; depth += 1) {
    columnX.set(depth, (columnX.get(depth - 1) ?? 0) + (columnW.get(depth - 1) ?? 0) + COL_GAP);
  }

  const measureSubtrees = (node: PlanNode): number => {
    if (node.children.length === 0) {
      node.subtree = node.h;
      return node.subtree;
    }
    let used = 0;
    node.children.forEach((child, index) => {
      used += measureSubtrees(child) + (index > 0 ? ROW_GAP : 0);
    });
    node.subtree = Math.max(node.h, used);
    return node.subtree;
  };
  measureSubtrees(origin);

  const place = (node: PlanNode, top: number): void => {
    node.x = Math.round(columnX.get(node.depth) ?? 0);
    node.y = Math.round(top + (node.subtree - node.h) / 2);
    if (node.children.length === 0) return;
    const used =
      node.children.reduce((total, child) => total + child.subtree, 0) +
      ROW_GAP * Math.max(0, node.children.length - 1);
    let cursor = top + (node.subtree - used) / 2;
    for (const child of node.children) {
      place(child, cursor);
      cursor += child.subtree + ROW_GAP;
    }
  };
  place(origin, 0);

  // ---- nodes ---------------------------------------------------------------
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const edgeKeys = new Set<string>();
  let routes = 0;
  let links = 0;

  const originId = claimNode('map:origin');
  nodes.push({
    id: originId,
    kind: 'origin',
    layerId,
    position: { x: origin.x, y: origin.y + offsetY },
    icon: 'cloud',
    label: analysis.origin.label,
    address: analysis.origin.address,
    subtitle: analysis.origin.subtitle,
  });

  const routerIds = new Map<string, string>();
  const hostIds = new Map<string, string>();
  /** Cards that actually sit inside a frame – only those get a subnet join. */
  const framed = new Set<string>();

  const hostNode = (host: ConnectHost, position: { x: number; y: number }, parentId?: string): DiagramNode => {
    const id = claimNode(`map:host:${slug(host.ip)}`);
    hostIds.set(host.ip, id);
    // A router with a WAN and a LAN address is one card: both addresses resolve
    // to it, so the traces and links that name either one still land here.
    for (const address of host.addresses) if (!hostIds.has(address)) hostIds.set(address, id);
    const source = sourceById.get(host.sourceNodeId);
    const other = host.addresses.filter((address) => address !== host.ip);
    const notes = [
      source?.notes,
      other.length > 0 ? `Also answers as ${other.join(', ')}` : '',
      host.macChanged ? `MAC addresses seen: ${host.macs.join(', ')}` : '',
    ]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .join('\n');
    // A card lifted out of a frame gets the icon that says what it is.
    const roleIcon = host.role === 'host' ? undefined : DEVICE_KIND_ICONS[host.kind];
    return {
      id,
      kind: 'host',
      layerId,
      position,
      ...(parentId ? { parentId } : {}),
      host: host.host,
      icon: roleIcon ?? source?.icon ?? detectIcon(host.host),
      label: source?.label,
      // The other address of a two-address router goes first: the source record can
      // only name one of them, and the narrow card truncates the tail.
      ...(other.length > 0
        ? { subtitle: [...other, host.hostnames[0]].filter(Boolean).join(' · ') }
        : {}),
      accent: source?.accent,
      notes: notes.length > 0 ? notes : undefined,
    };
  };

  for (const plan of routerPlans.values()) {
    const router = plan.router as ConnectRouter;
    const host = hostByIp.get(router.ip);
    const position = { x: plan.x, y: plan.y + offsetY };
    if (host) {
      const node = hostNode(host, position);
      routerIds.set(router.ip, node.id);
      nodes.push(node);
      continue;
    }
    const id = claimNode(`map:hop:${slug(router.ip)}`);
    routerIds.set(router.ip, id);
    nodes.push({
      id,
      kind: 'hop',
      layerId,
      position,
      address: router.ip,
      depth: Math.max(1, router.depth),
      subtitle: router.hostnames[0],
      icon: 'router',
    });
  }

  for (const plan of devicePlans.values()) {
    const host = plan.device as ConnectHost;
    nodes.push(hostNode(host, { x: plan.x, y: plan.y + offsetY }));
  }

  for (const plan of segmentPlans.values()) {
    const segment = plan.segment as ConnectSegment;
    const hosts = plan.hosts ?? [];
    const box = grid(hosts.length);
    const id = claimNode(`map:section:${slug(segment.cidr)}`);
    nodes.push({
      id,
      kind: 'section',
      layerId,
      position: { x: plan.x, y: plan.y + offsetY },
      cidr: segment.cidr,
      label: segment.cidr,
      icon: 'server',
      size: { w: box.w, h: box.h },
    });
    hosts
      .slice()
      .sort((a, b) => compareIp(a.ip, b.ip))
      .forEach((host, index) => {
        const position = {
          x: SECTION_PAD + (index % box.cols) * (HOST_W + H_GAP),
          y: SECTION_PAD + SECTION_HEADER + Math.floor(index / box.cols) * (HOST_H + V_GAP),
        };
        nodes.push(hostNode(host, position, id));
        framed.add(host.ip);
      });
  }

  // ---- edges ---------------------------------------------------------------
  const edge = (
    kind: 'route' | 'link',
    source: string,
    target: string,
    label?: string,
    line?: 'dotted',
  ): void => {
    if (!source || !target || source === target) return;
    // One edge between two cards, whichever direction or reason won first: a card
    // pair joined by a trace never also grows a reverse "subnet" link.
    const pair = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (edgeKeys.has(pair)) return;
    edgeKeys.add(pair);
    edges.push({
      id: claimNode(`${EDGE_PREFIX}:${kind}:${source}~${target}`),
      source,
      target,
      kind,
      ...(label ? { label } : {}),
      ...(line ? { line } : {}),
    });
    if (kind === 'route') routes += 1;
    else links += 1;
  };

  for (const plan of origin.children) {
    // The first router on the way in is reached by the traces, whether the scan
    // probed it (a host card) or only found it named (a device card).
    if (plan.kind === 'device' && plan.device?.role !== 'router') continue;
    const router = plan.router ?? undefined;
    const ip = router?.ip ?? plan.device?.ip;
    if (!ip) continue;
    edge('route', originId, hostIds.get(ip) ?? routerIds.get(ip) ?? '');
  }
  for (const router of analysis.routers) {
    if (!router.parent) continue;
    edge(
      'route',
      hostIds.get(router.parent) ?? routerIds.get(router.parent) ?? '',
      hostIds.get(router.ip) ?? routerIds.get(router.ip) ?? '',
    );
  }
  for (const host of analysis.hosts) {
    const last = host.path.at(-1);
    if (!last) continue;
    edge('route', routerIds.get(last) ?? '', hostIds.get(host.ip) ?? '');
  }

  // The device chain in front of each frame: gateway → other routers → switches.
  for (const segment of analysis.segments) {
    let parentId = routerIds.get(segment.gateway ?? '') ?? originId;
    for (const ip of segment.chain) {
      const id = hostIds.get(ip) ?? routerIds.get(ip);
      if (!id || id === parentId) continue;
      edge('link', parentId, id, parentId === originId ? 'on-link' : 'subnet', 'dotted');
      parentId = id;
    }
  }

  if (options.subnetLinks) {
    for (const host of analysis.hosts) {
      if (host.path.length > 0 || !framed.has(host.ip)) continue;
      const segment = segmentByCidr.get(host.segment);
      const anchor = segment?.anchor ? (hostIds.get(segment.anchor) ?? routerIds.get(segment.anchor)) : undefined;
      const sourceId = anchor ?? originId;
      // Dotted: this join is inferred from the /24, not observed in a trace.
      edge('link', sourceId, hostIds.get(host.ip) ?? '', anchor ? 'subnet' : 'on-link', 'dotted');
    }
  }

  for (const link of analysis.links) {
    const enabled = link.kind === 'same-hostname' ? options.hostnameLinks : options.macLinks;
    if (!enabled) continue;
    edge('link', hostIds.get(link.a) ?? '', hostIds.get(link.b) ?? '', link.label);
  }

  return {
    doc: {
      ...doc,
      layers: [...doc.layers, layer],
      nodes: [...doc.nodes, ...nodes],
      edges: [...doc.edges, ...edges],
    },
    layerId,
    layerName: layer.name,
    added: nodes.length,
    routes,
    links,
    hosts: analysis.hosts.length,
    switches: analysis.stats.switches,
  };
}

