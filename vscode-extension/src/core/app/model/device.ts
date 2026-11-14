import { openPorts, type NmapHost } from './types';

/**
 * What a scanned box is, from every signature nmap gives us.
 *
 * The signals are used in the order nmap itself trusts them:
 *
 * 1. `<osclass type>` – nmap's own category (router, switch, WAP, firewall, printer,
 *    phone…), which the app used to throw away. Only taken from guesses that are not
 *    tied with a plain "general purpose" one, because `-O` reports several classes
 *    at the same accuracy for plenty of machines.
 * 2. `<service devicetype>` – `-sV`'s category for a port, e.g. `router`, `printer`.
 * 3. `<ostype>` and `<cpe>` – the platform behind a banner (`cpe:/o:microsoft:windows`)
 *    and hardware identifiers (`cpe:/h:cisco:catalyst_2960`).
 * 4. NSE output – `smb-os-discovery`, `nbstat`, `snmp-sysdescr`, `http-title`.
 * 5. The NIC vendor, the PTR name, the product strings and the shape of the open ports.
 *
 * `classifyHost` is pure and never reads anything but the host record, so the icon on a
 * card and the role on a map cannot disagree.
 */

export type DeviceKind =
  | 'router'
  | 'switch'
  | 'firewall'
  | 'wap'
  | 'bridge'
  | 'hub'
  | 'balancer'
  | 'server'
  | 'desktop'
  | 'camera'
  | 'printer'
  | 'nas'
  | 'phone'
  | 'media'
  | 'hypervisor'
  | 'embedded'
  | 'unknown';

export type OsFamily = 'windows' | 'linux' | 'macos' | 'bsd' | 'android' | 'ios' | 'network' | 'unknown';

export type EvidenceSource =
  | 'osclass'
  | 'devicetype'
  | 'cpe'
  | 'nse'
  | 'firmware'
  | 'hop'
  | 'os-model'
  | 'vendor'
  | 'name'
  | 'service'
  | 'port'
  | 'os';

export type DeviceEvidence = { source: EvidenceSource; detail: string };

export type DeviceProfile = {
  kind: DeviceKind;
  kindEvidence: DeviceEvidence[];
  os: OsFamily;
  osEvidence: DeviceEvidence[];
  /** The kind came from a categorical signature, not from ports or a hint. */
  strongKind: boolean;
  /** The kind came from a signature the icon rules did not already read (osclass, `-sV`, CPE, NSE). */
  signatureKind: boolean;
  /** Set when the NIC is a virtual one: `Proxmox VE`, `VMware`, `KVM/QEMU`, `Hyper-V`… */
  virtual?: string;
};

export const UNKNOWN_PROFILE: DeviceProfile = {
  kind: 'unknown',
  kindEvidence: [],
  os: 'unknown',
  osEvidence: [],
  strongKind: false,
  signatureKind: false,
};

/**
 * NIC prefixes that only exist inside a hypervisor. A card with one of these is a
 * guest, which is worth saying out loud: it means the box is not the hardware.
 */
const VIRTUAL_OUIS: [string, string][] = [
  ['BC:24:11', 'Proxmox VE'],
  ['00:0C:29', 'VMware'],
  ['00:50:56', 'VMware'],
  ['00:05:69', 'VMware'],
  ['00:1C:14', 'VMware'],
  ['08:00:27', 'VirtualBox'],
  ['0A:00:27', 'VirtualBox'],
  ['52:54:00', 'KVM/QEMU'],
  ['00:15:5D', 'Hyper-V'],
  ['00:03:FF', 'Hyper-V'],
  ['00:16:3E', 'Xen'],
  ['02:42', 'Docker'],
];

/** The hypervisor a virtual NIC belongs to, if any of the MACs is one. */
export function virtualPlatform(macs: string[]): string | undefined {
  for (const mac of macs) {
    const normalized = mac.toUpperCase();
    for (const [prefix, platform] of VIRTUAL_OUIS) {
      if (normalized.startsWith(prefix)) return platform;
    }
  }
  return undefined;
}

/** Every MAC a host reports, whether it listed one or several. */
export function macsOf(host: NmapHost): string[] {
  const macs = [host.mac ?? '', ...(host.macs ?? []).map((entry) => entry.addr)].filter((mac) => mac.length > 0);
  return [...new Set(macs)].sort();
}

/** The hypervisor a host's NIC belongs to – the card is a guest, not the hardware. */
export function virtualPlatformOf(host: NmapHost | undefined): string | undefined {
  return host ? virtualPlatform(macsOf(host)) : undefined;
}

/** Sources strong enough to move a card out of its subnet frame. */
const CATEGORICAL: ReadonlySet<EvidenceSource> = new Set<EvidenceSource>([
  'osclass',
  'devicetype',
  'cpe',
  'nse',
  'firmware',
  'hop',
  'os-model',
  'vendor',
  'name',
]);

/** Sources the icon rules never read; used to let nmap's own classification win. */
const SIGNATURE: ReadonlySet<EvidenceSource> = new Set<EvidenceSource>([
  'osclass',
  'devicetype',
  'cpe',
  'nse',
  'firmware',
]);

/**
 * Firmware names that only ship on routers. A UPnP description declares its own
 * device type – plenty of routers answer `devicetype="WAP"` – so the firmware the
 * vendor signed, which describes the box rather than the service, outranks it.
 */
const ROUTER_FIRMWARE =
  /asuswrt|wanduck|routeros|routerboard|edgeos|pfsense|opnsense|fritz!?box|internet gateway device|airos/i;

const OS_CLASS_KIND: Record<string, DeviceKind> = {
  router: 'router',
  'broadband router': 'router',
  switch: 'switch',
  bridge: 'bridge',
  hub: 'hub',
  firewall: 'firewall',
  wap: 'wap',
  printer: 'printer',
  webcam: 'camera',
  phone: 'phone',
  'voip phone': 'phone',
  'voip adapter': 'embedded',
  'media device': 'media',
  'game console': 'media',
  storage: 'nas',
  'load balancer': 'balancer',
  'power device': 'embedded',
  telecom: 'embedded',
};

const DEVICE_TYPE_KIND: Record<string, DeviceKind> = {
  router: 'router',
  switch: 'switch',
  firewall: 'firewall',
  wap: 'wap',
  bridge: 'bridge',
  hub: 'hub',
  printer: 'printer',
  scanner: 'printer',
  webcam: 'camera',
  camera: 'camera',
  phone: 'phone',
  'media device': 'media',
  storage: 'nas',
  'load balancer': 'balancer',
  hypervisor: 'hypervisor',
};

/** Model, product and CPE tokens that name a category of box. */
const KIND_TOKENS: [RegExp, DeviceKind][] = [
  [
    /catalyst|\bnexus\b|procurve|powerconnect|\bswitch\b|\bsg-?\d{3,4}\b|\bdgs-|\bex\d{4}\b|juniper ex|\bws-c\d|\bc\d{4}[a-z]?\b/i,
    'switch',
  ],
  [/camera|webcam|ipcam|hikvision|dahua|reolink|amcrest|ezviz|vivotek|\bnvr\b|\bdvr\b/i, 'camera'],
  [/laserjet|officejet|deskjet|imageclass|\bmfp\b|printer|jetdirect|\bipp\b|scanner/i, 'printer'],
  [/diskstation|\bnas\b|\bsan\b|freenas|truenas|qnap|synology|drobo/i, 'nas'],
  [/fortigate|pfsense|opnsense|sonicwall|palo alto|check ?point|firewall/i, 'firewall'],
  [/unifi|access point|\bwap\b|\bwifi\b|airmax|airport/i, 'wap'],
  [
    /routeros|routerboard|edgerouter|edgemax|\brouter\b|mikrotik|openwrt|dd-wrt|pfsense|rt-ax\d|rt-ac\d|rt-n\d|zenwifi|asuswrt|wanduck|fritz|archer|nighthawk|orbi|velop|eero|deco/i,
    'router',
  ],
  [/proxmox|\besxi\b|xen(server)?|hyper-?v/i, 'hypervisor'],
  [/\bplex\b|twonky|jellyfin|emby|\bkodi\b|chromecast/i, 'media'],
  [/polycom|yealink|grandstream|\bvoip\b|\bsip phone\b/i, 'phone'],
  [/\bups\b|power device|\bpdu\b|apc ups/i, 'embedded'],
];

const OS_TOKENS: [RegExp, OsFamily][] = [
  [/^cpe:\/o:microsoft:windows|^\s*(microsoft\s+)?windows/i, 'windows'],
  [/^cpe:\/o:apple:mac|^cpe:\/o:apple:osx|^(mac ?os|macos|os x|darwin)/i, 'macos'],
  [/^cpe:\/o:apple:ios|^apple ios/i, 'ios'],
  [/^cpe:\/o:google:android|^android/i, 'android'],
  [/^cpe:\/o:(freebsd|openbsd|netbsd)|^(freebsd|openbsd|netbsd)/i, 'bsd'],
  [/^cpe:\/o:cisco:ios|^cpe:\/o:mikrotik:routeros|^cpe:\/o:juniper|cisco ios|ios xe|ios xr|junos|routeros|routerboard|nx-os|arubaos|procurve/i, 'network'],
  [/^cpe:\/o:linux|^(linux|unix|openwrt|dd-wrt|tomato|debian|ubuntu|centos|rhel|fedora|alpine|arch|gentoo|suse|kali|raspbian|openbsd)/i, 'linux'],
];

const VENDOR_KINDS: [RegExp, DeviceKind][] = [
  [/hikvision|dahua|axis comm|reolink|amcrest|ezviz|vivotek|hanwha|uniview/i, 'camera'],
  [/brother|canon|epson|xerox|lexmark|ricoh|zebra|kyocera/i, 'printer'],
  [/synology|qnap|drobo|seagate|western digital/i, 'nas'],
  [/arista|aruba|juniper|netgear|d-link|zyxel|extreme networks|brocade|ruckus|tp-link/i, 'switch'],
  // Cisco makes servers and phones as well as routers, so its OUI says "network
  // gear" rather than "router" – the model and the name decide.
  [/mikrotik|ubiquiti|fortinet|palo alto|sonicwall|draytek/i, 'router'],
  [/sagemcom|technicolor|arris|calix|actiontec/i, 'router'],
  [/polycom|yealink|grandstream|avaya/i, 'phone'],
  [/espressif|tuya/i, 'embedded'],
];

const NAME_KINDS: [RegExp, DeviceKind][] = [
  [/(^|[\s._-])(sw|switch|asw|dsw|csw)\d*([\s._-]|$)/i, 'switch'],
  [/(^|[\s._-])(rtr|router|gw|gateway|fw|firewall|edge|border)\d*([\s._-]|$)/i, 'router'],
  [/(^|[\s._-])(rt-ax|rt-ac|rt-n|zenwifi|fritz|archer|nighthawk|orbi|velop|eero|deco)\d*([\s._-]|$)/i, 'router'],
  [/(^|[\s._-])(cam|camera|ipc|nvr|dvr)\d*([\s._-]|$)/i, 'camera'],
  [/(^|[\s._-])(prn|printer|print|mfp)\d*([\s._-]|$)/i, 'printer'],
  [/(^|[\s._-])(nas|san|storage)\d*([\s._-]|$)/i, 'nas'],
  [/(^|[\s._-])(ap|wap|wifi)\d*([\s._-]|$)/i, 'wap'],
  [/(^|[\s._-])(pve|esxi|hv|hyperv)\d*([\s._-]|$)/i, 'hypervisor'],
  [/(^|[\s._-])(phone|sip|voip)\d*([\s._-]|$)/i, 'phone'],
  [/(^|[\s._-])(srv|server|dc|web|www|app|db|sql|mail|smtp|dns|proxy|vpn|mon|git|ci|build|k8s)\d*([\s._-]|$)/i, 'server'],
];

type Score = { score: number; evidence: DeviceEvidence[] };

function add(scores: Map<string, Score>, key: string, points: number, evidence: DeviceEvidence): void {
  const current = scores.get(key) ?? { score: 0, evidence: [] };
  current.score += points;
  if (!current.evidence.some((entry) => entry.detail === evidence.detail)) current.evidence.push(evidence);
  scores.set(key, current);
}

function winner<T extends string>(
  scores: Map<string, Score>,
  fallback: T,
  minimum: number,
  rank: (key: string) => number,
): { key: T; evidence: DeviceEvidence[] } {
  let best: { key: string; score: number } | null = null;
  for (const [key, value] of scores) {
    if (value.score < minimum) continue;
    if (!best || value.score > best.score || (value.score === best.score && rank(key) < rank(best.key))) {
      best = { key, score: value.score };
    }
  }
  if (!best) return { key: fallback, evidence: [] };
  return { key: best.key as T, evidence: scores.get(best.key)?.evidence ?? [] };
}

/** Kinds that forward traffic between networks, or switch it inside one. */
export const NETWORK_KINDS: ReadonlySet<DeviceKind> = new Set<DeviceKind>([
  'router',
  'switch',
  'firewall',
  'wap',
  'bridge',
  'hub',
  'balancer',
]);

/**
 * A traceroute reaches the devices *in front of* a host by passing packets
 * through them, which only a device that forwards can do. That is stronger
 * evidence than any banner: a Plex server whose address also fronts a subnet is
 * that network's router. The kind becomes network gear, the other evidence stays
 * in the list so the card can still say what else it serves.
 */
export function withHopEvidence(profile: DeviceProfile, detail = 'a hop on a traced path'): DeviceProfile {
  if (NETWORK_KINDS.has(profile.kind)) return profile;
  const evidence = [{ source: 'hop' as const, detail }, ...profile.kindEvidence];
  return {
    ...profile,
    kind: 'router',
    kindEvidence: evidence,
    strongKind: true,
    signatureKind: true,
  };
}

/** The icon for a card that other traces pass through: network gear, at least a router. */
export function routedIcon(host: NmapHost | undefined): string {
  const profile = classifyHost(host);
  const kind = NETWORK_KINDS.has(profile.kind) ? profile.kind : 'router';
  return DEVICE_KIND_ICONS[kind] ?? 'router';
}

const KIND_ORDER: DeviceKind[] = [
  'router',
  'switch',
  'firewall',
  'wap',
  'bridge',
  'hub',
  'balancer',
  'camera',
  'printer',
  'nas',
  'phone',
  'media',
  'hypervisor',
  'server',
  'desktop',
  'embedded',
  'unknown',
];

/** `<osclass>` values that describe no category at all. */
const GENERIC_CLASS = new Set(['general purpose', 'specialized']);

function osClasses(host: NmapHost): { type: string; accuracy: number; vendor?: string; osfamily?: string }[] {
  if (host.os.length === 0) return [];
  const best = host.os.reduce((max, match) => Math.max(max, match.accuracy), 0);
  const plausible = host.os.filter((match) => match.accuracy >= best - 3);
  // A role only counts when no generic class is tied with it: `-O` lists a router
  // guess for plenty of Linux VMs, and both come back at the same accuracy.
  const generic = plausible
    .flatMap((match) => match.classes ?? [])
    .filter((entry) => GENERIC_CLASS.has(entry.type.toLowerCase()))
    .reduce((max, entry) => Math.max(max, entry.accuracy), -1);
  return plausible
    .flatMap((match) => match.classes ?? [])
    .filter((entry) => !GENERIC_CLASS.has(entry.type.toLowerCase()) && entry.accuracy > generic);
}

/** The platform a name names, when it names one at all. */
function osFromText(value: string | undefined): OsFamily | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  for (const [pattern, family] of OS_TOKENS) {
    if (pattern.test(trimmed)) return family;
  }
  return undefined;
}

function scriptText(host: NmapHost): { id: string; output: string }[] {
  return [...host.scripts, ...host.ports.flatMap((port) => port.scripts)].filter((script) => script.output.length > 0);
}

function firstLine(output: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(output);
  return match?.[1]?.trim() || undefined;
}

export function classifyHost(host: NmapHost | undefined): DeviceProfile {
  if (!host) return UNKNOWN_PROFILE;

  const macs = macsOf(host);
  const kinds = new Map<string, Score>();
  const families = new Map<string, Score>();
  const kind = (value: DeviceKind | undefined, points: number, evidence: DeviceEvidence) => {
    if (value) add(kinds, value, points, evidence);
  };
  const family = (value: OsFamily | undefined, points: number, evidence: DeviceEvidence) => {
    if (value && value !== 'unknown') add(families, value, points, evidence);
  };

  // 1. nmap's own `<osclass>` categories, at their own accuracy.
  for (const entry of osClasses(host)) {
    const points = entry.accuracy >= 95 ? 10 : entry.accuracy >= 85 ? 8 : 6;
    const mapped = OS_CLASS_KIND[entry.type.toLowerCase()];
    kind(mapped, points, { source: 'osclass', detail: `osclass “${entry.type}” (${entry.accuracy}%)` });
    family(osFromText(entry.osfamily), points - 2, {
      source: 'osclass',
      detail: `osfamily “${entry.osfamily}”`,
    });
    if (mapped === 'router' || mapped === 'switch') family('network', points - 2, { source: 'osclass', detail: entry.type });
  }

  // 2. `-sV`'s category for each port.
  for (const port of host.ports) {
    if (port.devicetype) {
      const mapped = DEVICE_TYPE_KIND[port.devicetype.toLowerCase()];
      kind(mapped, 9, { source: 'devicetype', detail: `devicetype “${port.devicetype}”` });
    }
    if (port.ostype) {
      family(osFromText(port.ostype), 8, { source: 'os', detail: `ostype “${port.ostype}”` });
    }
    // 2b. A banner that names router firmware describes the whole box, not the
    //     service: `Asus wanduck WAN monitor httpd`, `MiniUPnP … AsusWRT 386`.
    const banner = [port.product, port.version, port.extrainfo].filter(Boolean).join(' ');
    if (banner && ROUTER_FIRMWARE.test(banner)) {
      kind('router', 9, { source: 'firmware', detail: `firmware: ${banner.slice(0, 60)}` });
    }
  }

  // 3. CPE identifiers: `/o:` is a platform, `/h:` a make and model.
  const cpes = host.ports.flatMap((port) => port.cpe ?? []);
  for (const cpe of cpes) {
    const familyGuess = osFromText(cpe);
    if (familyGuess) family(familyGuess, 8, { source: 'cpe', detail: cpe });
    if (cpe.startsWith('cpe:/h:')) {
      for (const [pattern, mapped] of KIND_TOKENS) {
        if (pattern.test(cpe)) {
          kind(mapped, 8, { source: 'cpe', detail: cpe });
          break;
        }
      }
    }
  }

  // 4. NSE output: the scripts that name a machine rather than a service.
  for (const script of scriptText(host)) {
    const text = script.output;
    if (script.id === 'smb-os-discovery') {
      const os = firstLine(text, /OS:\s*([^\n]+)/i);
      family(osFromText(os), 9, { source: 'nse', detail: `${script.id}: ${os ?? 'SMB'}` });
      kind('server', 6, { source: 'nse', detail: `${script.id}` });
      const name = firstLine(text, /(?:Computer name|NetBIOS computer name):\s*([^\r\n]+)/i);
      if (name) nameKind(name, kind);
    } else if (script.id === 'nbstat') {
      if (/<1c>|domain controller/i.test(text)) kind('server', 8, { source: 'nse', detail: 'nbstat: domain controller' });
      else if (/<20>|server service/i.test(text)) kind('server', 6, { source: 'nse', detail: 'nbstat: server service' });
      const name = firstLine(text, /NetBIOS name:\s*([^,\r\n]+)/i);
      if (name) nameKind(name, kind);
    } else if (script.id === 'rdp-ntlm-info') {
      family('windows', 8, { source: 'nse', detail: 'rdp-ntlm-info' });
      const name = firstLine(text, /NetBIOS_Computer_Name:\s*([^\r\n]+)/i);
      if (name) nameKind(name, kind);
    } else if (script.id.startsWith('snmp-') || script.id === 'snmp-info') {
      const description = firstLine(text, /(?:sysDescr|System description|Description):\s*([^\r\n]+)/i) ?? text.split('\n')[0];
      family(osFromText(description), 7, { source: 'nse', detail: `${script.id}: ${description.slice(0, 60)}` });
      kindFromText(description, kind, { source: 'nse', detail: `${script.id}: ${description.slice(0, 60)}` }, 8);
    } else if (script.id === 'http-title') {
      kindFromText(text, kind, { source: 'nse', detail: `http-title: ${text.slice(0, 60)}` }, 5);
    } else if (script.id === 'http-favicon') {
      kindFromText(text, kind, { source: 'nse', detail: `http-favicon: ${text.slice(0, 60)}` }, 6);
    } else if (script.id === 'ssl-cert') {
      // A self-signed certificate usually names its vendor: `organizationName=Sagemcom`.
      const issuer = firstLine(text, /organizationName=([^/\r\n]+)/i) ?? firstLine(text, /Subject:\s*commonName=([^,/\r\n]+)/i);
      if (issuer) {
        for (const [pattern, mapped] of VENDOR_KINDS) {
          if (pattern.test(issuer)) {
            kind(mapped, 7, { source: 'nse', detail: `ssl-cert: ${issuer.trim()}` });
            break;
          }
        }
        kindFromText(issuer, kind, { source: 'nse', detail: `ssl-cert: ${issuer.trim()}` }, 6);
      }
    }
  }

  // 5. The NIC vendor, the name it answers to, the products it serves.
  if (host.vendor) {
    for (const [pattern, mapped] of VENDOR_KINDS) {
      if (pattern.test(host.vendor)) {
        kind(mapped, 5, { source: 'vendor', detail: host.vendor });
        break;
      }
    }
  }
  for (const hostname of host.hostnames) nameKind(hostname, kind);

  for (const port of host.ports) {
    const product = [port.product, port.version, port.extrainfo].filter(Boolean).join(' ');
    if (product) kindFromText(product, kind, { source: 'service', detail: `${port.port}/${port.service ?? 'tcp'} ${product}`.slice(0, 80) }, 4);
    if (port.service === 'http' || port.service === 'www' || port.service === 'ssl/http') {
      kind('server', 1, { source: 'service', detail: `${port.port}/http` });
    }
  }

  // 6. Platform guesses from `-O`, only when one family is ahead of the others.
  const plausible = host.os.length > 0
    ? host.os.filter((match) => match.accuracy >= host.os.reduce((max, entry) => Math.max(max, entry.accuracy), 0) - 3)
    : [];
  for (const [pattern, guess] of OS_TOKENS) {
    const hit = plausible.find((match) => pattern.test(match.name));
    if (hit) {
      family(guess, hit.accuracy >= 95 ? 5 : 4, { source: 'os', detail: hit.name });
    }
  }

  // 6b. A model guess that is not tied with a plain kernel, e.g. "MikroTik
  //     RouterOS 7.x" on its own. That names a box; a tie with Linux does not.
  for (const name of modelOsNames(host)) {
    kindFromText(name, kind, { source: 'os-model', detail: name }, 7);
  }

  // 7. Port shape, when nothing said anything categorical.
  const open = new Set(openPorts(host).map((port) => port.port));
  const has = (...ports: number[]) => ports.some((port) => open.has(port));
  if (has(554, 8554, 37777)) kind('camera', 3, { source: 'port', detail: 'RTSP / camera port' });
  if (has(9100, 515, 631)) kind('printer', 4, { source: 'port', detail: 'print service port' });
  if (has(2049) && has(139, 445)) kind('nas', 3, { source: 'port', detail: 'NFS + SMB' });
  if (has(5060, 5061)) kind('phone', 3, { source: 'port', detail: 'SIP' });
  if (has(8006, 902) || has(8006, 903)) kind('hypervisor', 3, { source: 'port', detail: 'hypervisor management' });
  if (has(2179)) kind('hypervisor', 4, { source: 'port', detail: '2179/vmrdp (Hyper-V console)' });
  if (has(32400)) kind('media', 4, { source: 'port', detail: '32400/plex' });
  if (has(3389)) {
    family('windows', 4, { source: 'port', detail: '3389/rdp' });
    kind('desktop', 2, { source: 'port', detail: '3389/rdp' });
  }
  if (has(445, 139, 135)) family('windows', 2, { source: 'port', detail: 'SMB / RPC' });
  if (has(3306, 5432, 1433, 1521, 27017, 6379, 9200, 2049)) kind('server', 2, { source: 'port', detail: 'database / storage port' });

  const chosenKind = winner<DeviceKind>(kinds, 'unknown', 4, (key) => KIND_ORDER.indexOf(key as DeviceKind));
  const chosenOs = winner<OsFamily>(families, 'unknown', 3, (key) => (key === 'network' ? 1 : 0));
  return {
    kind: chosenKind.key,
    kindEvidence: chosenKind.evidence,
    os: chosenOs.key,
    osEvidence: chosenOs.evidence,
    strongKind: chosenKind.evidence.some((entry) => CATEGORICAL.has(entry.source)),
    signatureKind: chosenKind.evidence.some((entry) => SIGNATURE.has(entry.source)),
    virtual: virtualPlatform(macs),
  };
}

function nameKind(
  name: string,
  kind: (value: DeviceKind | undefined, points: number, evidence: DeviceEvidence) => void,
): void {
  for (const [pattern, mapped] of NAME_KINDS) {
    if (pattern.test(name)) {
      kind(mapped, 6, { source: 'name', detail: `named “${name}”` });
      return;
    }
  }
}

/** OS guesses that name a model, when no plain kernel is tied with them. */
function modelOsNames(host: NmapHost): string[] {
  if (host.os.length === 0) return [];
  const best = host.os.reduce((max, match) => Math.max(max, match.accuracy), 0);
  const plausible = host.os.filter((match) => match.accuracy >= best - 3);
  const genericBest = plausible
    .filter((match) => osFromText(match.name) === 'linux' || osFromText(match.name) === 'windows' || osFromText(match.name) === 'macos' || osFromText(match.name) === 'bsd' || osFromText(match.name) === 'android' || osFromText(match.name) === 'ios')
    .reduce((max, match) => Math.max(max, match.accuracy), -1);
  return plausible.filter((match) => match.accuracy > genericBest).map((match) => match.name);
}

function kindFromText(
  text: string,
  kind: (value: DeviceKind | undefined, points: number, evidence: DeviceEvidence) => void,
  evidence: DeviceEvidence,
  points: number,
): void {
  for (const [pattern, mapped] of KIND_TOKENS) {
    if (pattern.test(text)) {
      kind(mapped, points, evidence);
      return;
    }
  }
}

/** The icon that best says what the box is; `undefined` leaves the choice to the card. */
export const DEVICE_KIND_ICONS: Partial<Record<DeviceKind, string>> = {
  router: 'router',
  switch: 'switch',
  firewall: 'firewall',
  wap: 'ap',
  bridge: 'bridge',
  hub: 'hub',
  balancer: 'balancer',
  camera: 'camera',
  printer: 'printer',
  nas: 'nas',
  phone: 'phone',
  media: 'media',
  hypervisor: 'hypervisor',
  embedded: 'iot',
  server: 'server',
};

/** Readable label for the preview and the inspector. */
export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  router: 'router',
  switch: 'switch',
  firewall: 'firewall',
  wap: 'wireless AP',
  bridge: 'bridge',
  hub: 'hub',
  balancer: 'load balancer',
  server: 'server',
  desktop: 'workstation',
  camera: 'camera',
  printer: 'printer',
  nas: 'NAS',
  phone: 'phone',
  media: 'media device',
  hypervisor: 'hypervisor',
  embedded: 'embedded device',
  unknown: 'device',
};

export const OS_FAMILY_LABELS: Record<OsFamily, string> = {
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS',
  bsd: 'BSD',
  android: 'Android',
  ios: 'iOS',
  network: 'network OS',
  unknown: 'unknown OS',
};
