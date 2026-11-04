import type { NmapHost, NmapOsMatch } from '../model/types';
import { OS_LOGOS } from './osLogos';

const svg = (children: React.ReactNode) => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export type IconDef = {
  id: string;
  label: string;
  group: 'device' | 'net' | 'flow' | 'os';
  color: string;
  glyph?: React.ReactNode;
  logo?: string;
  mark?: string;
  emoji: string;
};

export const ICONS: IconDef[] = [
  {
    id: 'desktop',
    label: 'Desktop',
    group: 'device',
    color: '#8aa4c0',
    emoji: '🖥️',
    glyph: svg(
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M9 20h6M12 16v4" />
      </>,
    ),
  },
  {
    id: 'laptop',
    label: 'Laptop',
    group: 'device',
    color: '#8aa4c0',
    emoji: '💻',
    glyph: svg(
      <>
        <rect x="4" y="5" width="16" height="10" rx="1.6" />
        <path d="M2 19h20" />
      </>,
    ),
  },
  {
    id: 'server',
    label: 'Server',
    group: 'device',
    color: '#7fd6c1',
    emoji: '🗄️',
    glyph: svg(
      <>
        <rect x="3" y="4" width="18" height="6" rx="1.6" />
        <rect x="3" y="14" width="18" height="6" rx="1.6" />
        <path d="M7 7h.01M7 17h.01" />
      </>,
    ),
  },
  {
    id: 'database',
    label: 'Database',
    group: 'device',
    color: '#f0a25c',
    emoji: '🗃️',
    glyph: svg(
      <>
        <ellipse cx="12" cy="6" rx="7" ry="2.8" />
        <path d="M5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6" />
        <path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8" />
      </>,
    ),
  },
  {
    id: 'router',
    label: 'Router',
    group: 'net',
    color: '#5fb0ff',
    emoji: '📡',
    glyph: svg(
      <>
        <rect x="3" y="12" width="18" height="7" rx="2" />
        <path d="M7 15.5h.01M11 15.5h.01" />
        <path d="M12 12V8M8.5 5.5 12 2l3.5 3.5" />
      </>,
    ),
  },
  {
    id: 'switch',
    label: 'Switch',
    group: 'net',
    color: '#5fb0ff',
    emoji: '🔀',
    glyph: svg(
      <>
        <rect x="3" y="8" width="18" height="8" rx="2" />
        <path d="M7 12h2M11 12h2M15 12h2" />
      </>,
    ),
  },
  {
    id: 'firewall',
    label: 'Firewall',
    group: 'net',
    color: '#ff8f6b',
    emoji: '🧱',
    glyph: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="1.6" />
        <path d="M3 9.6h18M3 14.4h18M9 5v4.6M15 9.6v4.8M9 14.4V19" />
      </>,
    ),
  },
  {
    id: 'printer',
    label: 'Printer',
    group: 'device',
    color: '#b9a3ff',
    emoji: '🖨️',
    glyph: svg(
      <>
        <path d="M7 8V4h10v4" />
        <rect x="4" y="8" width="16" height="7" rx="2" />
        <path d="M7 15h10v5H7z" />
      </>,
    ),
  },
  {
    id: 'camera',
    label: 'IP camera',
    group: 'device',
    color: '#ff7a9c',
    emoji: '📹',
    glyph: svg(
      <>
        <path d="M4 8l12-3 2 6-12 3z" />
        <path d="M6 14v3a3 3 0 0 0 3 3h1" />
        <circle cx="18.5" cy="6.5" r="1" />
      </>,
    ),
  },
  {
    id: 'nas',
    label: 'NAS / storage',
    group: 'device',
    color: '#7fd6c1',
    emoji: '💾',
    glyph: svg(
      <>
        <rect x="4" y="4" width="16" height="16" rx="2.5" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 12h.01" />
      </>,
    ),
  },
  {
    id: 'container',
    label: 'Container',
    group: 'device',
    color: '#4aa8ff',
    emoji: '📦',
    glyph: svg(
      <>
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </>,
    ),
  },
  {
    id: 'hypervisor',
    label: 'Hypervisor',
    group: 'device',
    color: '#e57000',
    emoji: '🧩',
    // Stacked slabs: a machine running other machines, rather than one container box.
    glyph: svg(
      <>
        <rect x="3.5" y="4" width="17" height="5" rx="1.6" />
        <rect x="5.5" y="9.5" width="13" height="5" rx="1.6" />
        <rect x="7.5" y="15" width="9" height="5" rx="1.6" />
        <path d="M7 6.5h.01M9.5 12h.01M10 17.5h.01" />
      </>,
    ),
  },
  {
    id: 'media',
    label: 'Media server',
    group: 'device',
    color: '#e5a00d',
    emoji: '🎬',
    glyph: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.4" />
        <path d="M10 9.2l5 2.8-5 2.8z" />
      </>,
    ),
  },
  {
    id: 'git',
    label: 'Git server',
    group: 'device',
    color: '#f05033',
    emoji: '🌿',
    glyph: svg(
      <>
        <circle cx="7" cy="6" r="2.2" />
        <circle cx="7" cy="18" r="2.2" />
        <circle cx="17" cy="12" r="2.2" />
        <path d="M7 8.2v7.6" />
        <path d="M9.2 6h3.4a2.2 2.2 0 0 1 2.2 2.2v1.6" />
      </>,
    ),
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    group: 'device',
    color: '#f46800',
    emoji: '📈',
    glyph: svg(
      <>
        <rect x="2.5" y="4" width="19" height="16" rx="2.4" />
        <path d="M2.5 12h4l2-3.6 3 7.2 2.2-4.4 1.6 2.6h6.2" />
      </>,
    ),
  },
  {
    id: 'cloud',
    label: 'Cloud service',
    group: 'device',
    color: '#8fb6ff',
    emoji: '☁️',
    glyph: svg(<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.6 1.6A3.2 3.2 0 0 0 7 18Z" />),
  },
  {
    id: 'web',
    label: 'Web app',
    group: 'device',
    color: '#5fd0a8',
    emoji: '🌐',
    glyph: svg(
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16" />
        <path d="M12 4c2.4 2.6 2.4 13.4 0 16M12 4c-2.4 2.6-2.4 13.4 0 16" />
      </>,
    ),
  },
  {
    id: 'mail',
    label: 'Mail server',
    group: 'device',
    color: '#ffcf6b',
    emoji: '✉️',
    glyph: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3.6 7.2 8.4 5.8 8.4-5.8" />
      </>,
    ),
  },
  {
    id: 'dns',
    label: 'DNS resolver',
    group: 'device',
    color: '#9bb7ff',
    emoji: '🔎',
    // A resolution tree: one name fanning out to records. The old magnifier read
    // as "search", which is how firewall distros ended up looking like a search box.
    glyph: svg(
      <>
        <circle cx="12" cy="5" r="2.2" />
        <path d="M12 7.2v4.2M12 11.4H6.2M12 11.4h5.8M6.2 11.4v3.4M17.8 11.4v3.4" />
        <circle cx="6.2" cy="17" r="2" />
        <circle cx="17.8" cy="17" r="2" />
      </>,
    ),
  },
  {
    id: 'vpn',
    label: 'VPN / gateway',
    group: 'device',
    color: '#6ee7b7',
    emoji: '🛡️',
    glyph: svg(
      <>
        <path d="M12 3l7 3v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6l7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>,
    ),
  },
  {
    id: 'phone',
    label: 'Phone / VoIP',
    group: 'device',
    color: '#a3e635',
    emoji: '📱',
    glyph: svg(
      <>
        <rect x="7" y="3" width="10" height="18" rx="2.4" />
        <path d="M11 18.5h2" />
      </>,
    ),
  },
  {
    id: 'iot',
    label: 'IoT device',
    group: 'device',
    color: '#c4b5fd',
    emoji: '🔌',
    glyph: svg(
      <>
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
      </>,
    ),
  },
  {
    id: 'unknown',
    label: 'Unknown',
    group: 'device',
    color: '#6f8098',
    emoji: '❓',
    glyph: svg(
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.7 9.6a2.5 2.5 0 1 1 3.4 2.3c-.65.28-1.1.9-1.1 1.6v.3" />
        <path d="M12 17h.01" />
      </>,
    ),
  },

  {
    id: 'hub',
    label: 'Hub',
    group: 'net',
    color: '#5fb0ff',
    emoji: '🔘',
    glyph: svg(
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 8.8V4.6M12 15.2v4.2M8.8 12H4.6M15.2 12h4.2" />
        <circle cx="12" cy="3" r="1.4" />
        <circle cx="12" cy="21" r="1.4" />
        <circle cx="3" cy="12" r="1.4" />
        <circle cx="21" cy="12" r="1.4" />
      </>,
    ),
  },
  {
    id: 'bridge',
    label: 'Bridge',
    group: 'net',
    color: '#5fb0ff',
    emoji: '🌉',
    glyph: svg(
      <>
        <path d="M2 17h20" />
        <path d="M6 17v-4a6 6 0 0 1 12 0v4" />
        <path d="M12 17V9.2" />
        <path d="M6 13.4h12" />
      </>,
    ),
  },
  {
    id: 'wrouter',
    label: 'Wireless router',
    group: 'net',
    color: '#5fb0ff',
    emoji: '📶',
    glyph: svg(
      <>
        <rect x="2.5" y="13" width="15" height="7.5" rx="2" />
        <path d="M6 16.8h.01M9.5 16.8h.01" />
        <path d="M17.5 13V6.5" />
        <path d="M14.8 9.2a4 4 0 0 1 5.4 0" />
        <path d="M13 6.4a7 7 0 0 1 9 0" />
      </>,
    ),
  },
  {
    id: 'ap',
    label: 'Access point',
    group: 'net',
    color: '#5fb0ff',
    emoji: '🛜',
    glyph: svg(
      <>
        <circle cx="12" cy="17.6" r="1.6" />
        <path d="M8.4 14.2a5.2 5.2 0 0 1 7.2 0" />
        <path d="M5.6 11.2a9.2 9.2 0 0 1 12.8 0" />
        <path d="M2.8 8.2a13.2 13.2 0 0 1 18.4 0" />
      </>,
    ),
  },
  {
    id: 'repeater',
    label: 'Repeater',
    group: 'net',
    color: '#5fb0ff',
    emoji: '🔁',
    glyph: svg(
      <>
        <path d="M4 12h16" />
        <path d="M8 8l-4 4 4 4" />
        <path d="M16 8l4 4-4 4" />
        <path d="M9.5 6.5v11M14.5 6.5v11" />
      </>,
    ),
  },
  {
    id: 'modem',
    label: 'Modem / ONT',
    group: 'net',
    color: '#5fb0ff',
    emoji: '📞',
    glyph: svg(
      <>
        <rect x="2.5" y="11" width="19" height="8" rx="2" />
        <path d="M6 15.5h.01M9.5 15.5h.01M13 15.5h.01" />
        <path d="M12 11V7.5" />
        <path d="M9.6 5a3.6 3.6 0 0 1 4.8 0" />
      </>,
    ),
  },
  {
    id: 'gateway',
    label: 'Gateway',
    group: 'net',
    color: '#7fd6c1',
    emoji: '🚪',
    glyph: svg(
      <>
        <path d="M3.5 5v14M20.5 5v14" />
        <path d="M6 12h12" />
        <path d="M14.5 8.5 18 12l-3.5 3.5" />
      </>,
    ),
  },
  {
    id: 'balancer',
    label: 'Load balancer',
    group: 'net',
    color: '#7fd6c1',
    emoji: '⚖️',
    glyph: svg(
      <>
        <circle cx="3.5" cy="12" r="1.6" />
        <circle cx="20.5" cy="5" r="1.6" />
        <circle cx="20.5" cy="12" r="1.6" />
        <circle cx="20.5" cy="19" r="1.6" />
        <path d="M5.1 12h5.4M10.5 12l8.4-7M10.5 12h8.4M10.5 12l8.4 7" />
      </>,
    ),
  },
  {
    id: 'ids',
    label: 'IDS / tap',
    group: 'net',
    color: '#ff8f6b',
    emoji: '🛡️',
    glyph: svg(
      <>
        <path d="M2 12h4.5l2.5-5 4 10 2.5-5H22" />
        <circle cx="17" cy="12" r="1.2" />
      </>,
    ),
  },
  {
    id: 'panel',
    label: 'Patch panel',
    group: 'net',
    color: '#8aa4c0',
    emoji: '🧰',
    glyph: svg(
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <path d="M6.5 10.5h.01M10 10.5h.01M13.5 10.5h.01M17 10.5h.01M6.5 14h.01M10 14h.01M13.5 14h.01M17 14h.01" />
      </>,
    ),
  },
  {
    id: 'topo-ring',
    label: 'Ring / token ring',
    group: 'net',
    color: '#2fd6a5',
    emoji: '🔄',
    glyph: svg(
      <>
        <circle cx="12" cy="12" r="6.4" />
        <circle cx="12" cy="5.4" r="2" />
        <circle cx="17.7" cy="15.2" r="2" />
        <circle cx="6.3" cy="15.2" r="2" />
      </>,
    ),
  },
  {
    id: 'topo-star',
    label: 'Star topology',
    group: 'net',
    color: '#2fd6a5',
    emoji: '⭐',
    glyph: svg(
      <>
        <circle cx="12" cy="12" r="2.2" />
        <circle cx="12" cy="3.6" r="1.7" />
        <circle cx="19.4" cy="16.4" r="1.7" />
        <circle cx="4.6" cy="16.4" r="1.7" />
        <path d="M12 9.8V5.3M13.9 13 17.8 15.6M10.1 13 6.2 15.6" />
      </>,
    ),
  },
  {
    id: 'topo-mesh',
    label: 'Mesh topology',
    group: 'net',
    color: '#2fd6a5',
    emoji: '🕸️',
    glyph: svg(
      <>
        <path d="M6 6h12M6 18h12M6 6v12M18 6v12M6 6l12 12M18 6 6 18" />
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>,
    ),
  },
  {
    id: 'topo-bus',
    label: 'Bus topology',
    group: 'net',
    color: '#2fd6a5',
    emoji: '🚌',
    glyph: svg(
      <>
        <path d="M2.5 8.5h19" />
        <path d="M7 8.5V15M12 8.5V15M17 8.5V15" />
        <circle cx="7" cy="17" r="1.8" />
        <circle cx="12" cy="17" r="1.8" />
        <circle cx="17" cy="17" r="1.8" />
      </>,
    ),
  },

  {
    id: 'flow-start',
    label: 'Start / end',
    group: 'flow',
    color: '#a78bfa',
    emoji: '⏺️',
    glyph: svg(<rect x="2.5" y="8" width="19" height="8" rx="4" />),
  },
  {
    id: 'flow-process',
    label: 'Process',
    group: 'flow',
    color: '#a78bfa',
    emoji: '⬛',
    glyph: svg(<rect x="4" y="6.5" width="16" height="11" rx="1.5" />),
  },
  {
    id: 'flow-decision',
    label: 'Decision',
    group: 'flow',
    color: '#c084fc',
    emoji: '🔷',
    glyph: svg(<path d="M12 2.8 21.2 12 12 21.2 2.8 12z" />),
  },
  {
    id: 'flow-data',
    label: 'Input / output',
    group: 'flow',
    color: '#a78bfa',
    emoji: '🔶',
    glyph: svg(<path d="M6.5 6.5h15l-4 11h-15z" />),
  },
  {
    id: 'flow-document',
    label: 'Document',
    group: 'flow',
    color: '#a78bfa',
    emoji: '📄',
    glyph: svg(
      <path d="M4 5h16v10c-2.7 1.7-5.3-1.2-8 0s-5.3 1.7-8 0z" />,
    ),
  },
  {
    id: 'flow-subroutine',
    label: 'Subroutine',
    group: 'flow',
    color: '#a78bfa',
    emoji: '📦',
    glyph: svg(
      <>
        <rect x="3" y="6.5" width="18" height="11" rx="1.5" />
        <path d="M7 6.5v11M17 6.5v11" />
      </>,
    ),
  },
  {
    id: 'flow-prep',
    label: 'Preparation',
    group: 'flow',
    color: '#a78bfa',
    emoji: '⬡',
    glyph: svg(<path d="M7 5.5h10L21 12l-4 6.5H7L3 12z" />),
  },
  {
    id: 'flow-manual-input',
    label: 'Manual input',
    group: 'flow',
    color: '#a78bfa',
    emoji: '⌨️',
    glyph: svg(<path d="M4 9.5 20 5v14H4z" />),
  },
  {
    id: 'flow-manual-op',
    label: 'Manual operation',
    group: 'flow',
    color: '#a78bfa',
    emoji: '🛠️',
    glyph: svg(<path d="M2.5 6.5h19l-3 11h-13z" />),
  },
  {
    id: 'flow-connector',
    label: 'Connector',
    group: 'flow',
    color: '#a78bfa',
    emoji: '⭕',
    glyph: svg(<circle cx="12" cy="12" r="7" />),
  },
  {
    id: 'flow-delay',
    label: 'Delay',
    group: 'flow',
    color: '#a78bfa',
    emoji: '⏳',
    glyph: svg(<path d="M5 5.5h7a6.5 6.5 0 0 1 0 13H5z" />),
  },
  {
    id: 'flow-display',
    label: 'Display',
    group: 'flow',
    color: '#a78bfa',
    emoji: '🖥️',
    glyph: svg(<path d="M7.5 5.5H17l4.5 6.5L17 18.5H7.5A3 3 0 0 1 4.5 15.5v-7a3 3 0 0 1 3-3z" />),
  },
  {
    id: 'flow-merge',
    label: 'Merge / junction',
    group: 'flow',
    color: '#a78bfa',
    emoji: '🔀',
    glyph: svg(
      <>
        <path d="M3 6.5 11 12 3 17.5" />
        <path d="M11 12h9" />
        <path d="M16.5 8.5 21 12l-4.5 3.5" />
      </>,
    ),
  },

  {
    id: 'windows',
    label: 'Windows',
    group: 'os',
    color: '#58a6ff',
    emoji: '🪟',
    glyph: svg(
      <>
        <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1" />
        <rect x="13" y="3.5" width="7.5" height="7.5" rx="1" />
        <rect x="3.5" y="13" width="7.5" height="7.5" rx="1" />
        <rect x="13" y="13" width="7.5" height="7.5" rx="1" />
      </>,
    ),
  },
  { id: 'linux', label: 'Linux (Tux)', group: 'os', color: '#f7c531', logo: OS_LOGOS.linux, emoji: '🐧' },
  { id: 'ubuntu', label: 'Ubuntu', group: 'os', color: '#e95420', logo: OS_LOGOS.ubuntu, emoji: '🟠' },
  { id: 'debian', label: 'Debian', group: 'os', color: '#d70a53', logo: OS_LOGOS.debian, emoji: '🌀' },
  { id: 'mint', label: 'Linux Mint', group: 'os', color: '#86be43', logo: OS_LOGOS.mint, emoji: '🌿' },
  { id: 'fedora', label: 'Fedora', group: 'os', color: '#51a2da', logo: OS_LOGOS.fedora, emoji: '🎩' },
  { id: 'arch', label: 'Arch Linux', group: 'os', color: '#1793d1', logo: OS_LOGOS.arch, emoji: '🔷' },
  { id: 'alpine', label: 'Alpine Linux', group: 'os', color: '#4aa8d8', logo: OS_LOGOS.alpine, emoji: '🏔️' },
  { id: 'rhel', label: 'Red Hat / RHEL', group: 'os', color: '#ee0000', logo: OS_LOGOS.rhel, emoji: '🎯' },
  { id: 'centos', label: 'CentOS', group: 'os', color: '#a48bfa', logo: OS_LOGOS.centos, emoji: '🟣' },
  { id: 'rocky', label: 'Rocky Linux', group: 'os', color: '#10b981', logo: OS_LOGOS.rocky, emoji: '🪨' },
  { id: 'alma', label: 'AlmaLinux', group: 'os', color: '#f0a25c', logo: OS_LOGOS.alma, emoji: '🌾' },
  { id: 'suse', label: 'openSUSE / SUSE', group: 'os', color: '#73ba25', logo: OS_LOGOS.suse, emoji: '🦎' },
  { id: 'kali', label: 'Kali Linux', group: 'os', color: '#4aa8d8', logo: OS_LOGOS.kali, emoji: '🐉' },
  { id: 'gentoo', label: 'Gentoo', group: 'os', color: '#a794cf', logo: OS_LOGOS.gentoo, emoji: '🧬' },
  { id: 'nixos', label: 'NixOS', group: 'os', color: '#6f9de0', logo: OS_LOGOS.nixos, emoji: '❄️' },
  { id: 'raspberrypi', label: 'Raspberry Pi OS', group: 'os', color: '#c4556e', logo: OS_LOGOS.raspberrypi, emoji: '🍓' },
  { id: 'macos', label: 'macOS / iOS', group: 'os', color: '#b9c3cf', logo: OS_LOGOS.macos, emoji: '🍎' },
  { id: 'freebsd', label: 'FreeBSD', group: 'os', color: '#d9534f', logo: OS_LOGOS.freebsd, emoji: '😈' },
  { id: 'openbsd', label: 'OpenBSD', group: 'os', color: '#f2ca30', logo: OS_LOGOS.openbsd, emoji: '🐡' },
  { id: 'android', label: 'Android', group: 'os', color: '#3ddc84', logo: OS_LOGOS.android, emoji: '🤖' },
  { id: 'openwrt', label: 'OpenWrt', group: 'os', color: '#35c2e8', logo: OS_LOGOS.openwrt, emoji: '📶' },
  { id: 'pfsense', label: 'pfSense', group: 'os', color: '#c9d3de', logo: OS_LOGOS.pfsense, emoji: '🧱' },
  {
    id: 'opnsense',
    label: 'OPNsense',
    group: 'os',
    color: '#d94f00',
    emoji: '🧱',
    glyph: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="1.6" />
        <path d="M3 9.6h18M3 14.4h18M9 5v4.6M15 9.6v4.8M9 14.4V19" />
      </>,
    ),
  },
  { id: 'proxmox', label: 'Proxmox VE', group: 'os', color: '#e57000', logo: OS_LOGOS.proxmox, emoji: '📦' },
  { id: 'synology', label: 'Synology DSM', group: 'os', color: '#b5b5b6', logo: OS_LOGOS.synology, emoji: '🗄️' },
  { id: 'truenas', label: 'TrueNAS', group: 'os', color: '#0095d5', logo: OS_LOGOS.truenas, emoji: '🧊' },
  { id: 'vmware', label: 'VMware ESXi', group: 'os', color: '#8a97a3', logo: OS_LOGOS.vmware, emoji: '🖧' },
  { id: 'docker', label: 'Docker host', group: 'os', color: '#2496ed', logo: OS_LOGOS.docker, emoji: '🐳' },
  { id: 'kubernetes', label: 'Kubernetes', group: 'os', color: '#326ce5', logo: OS_LOGOS.kubernetes, emoji: '☸️' },
];

const ICON_BY_ID = new Map(ICONS.map((icon) => [icon.id, icon]));
const FALLBACK_ICON = ICON_BY_ID.get('unknown')!;

export function iconById(id: string | undefined): IconDef {
  return (id ? ICON_BY_ID.get(id) : undefined) ?? FALLBACK_ICON;
}

export function iconEmoji(id: string | undefined): string {
  return iconById(id).emoji;
}

/**
 * What the scan calls the device, by model or vendor string. Consumer and prosumer
 * routers answer "OpenWrt" or "Linux" to OS fingerprinting, so the model name is a
 * better signal for what the box *is* than the firmware it happens to run.
 */
const APPLIANCE_PATTERNS: [RegExp, string][] = [
  // ASUS: RT-AX55, RT-AC68U, ZenWiFi, plus the ASUSWRT firmware name.
  [/rt-ax\d|rt-ac\d|rt-n\d|gt-ax\d|zenwifi|asuswrt|\basus\b/i, 'wrouter'],
  // Ubiquiti/UniFi and EdgeMAX model names. The bare "ubiquiti" vendor string is
  // left to the vendor table, which maps it to a plain router.
  [/unifi|\budm\b|\busg\b|\buxg\b|edgerouter|edgemax|airmax/i, 'wrouter'],
  // TP-Link, Deco, Omada; Netgear Nighthawk/Orbi; Linksys Velop; AVM Fritz!Box.
  [/\barcher\b|\bdeco\b|\btl-(wr|er)\d|omada|tp-?link/i, 'wrouter'],
  [/nighthawk|\borbi\b|\b(r|rax|mr|mx)\d{3,4}\b|netgear/i, 'wrouter'],
  [/velop|\beero\b|linksys/i, 'wrouter'],
  [/fritz|\bavm\b/i, 'wrouter'],
  // Model families only. A bare "MikroTik RouterOS" in an OS *guess* is not a
  // device: nmap reports it for plenty of Linux VMs, so the vendor table handles it.
  [/routerboard|\bhap\b|\brb\d{3,4}\b|\bccr\d+\b/i, 'wrouter'],
];

const OS_PATTERNS: [RegExp, string][] = [
  [/linux mint|\bmint\b/i, 'mint'],
  [/ubuntu/i, 'ubuntu'],
  [/raspbian|raspberry pi/i, 'raspberrypi'],
  [/debian/i, 'debian'],
  [/kali/i, 'kali'],
  [/alma\s*linux|almalinux/i, 'alma'],
  [/rocky\s*linux|rockylinux/i, 'rocky'],
  [/centos/i, 'centos'],
  [/red hat|rhel/i, 'rhel'],
  [/fedora/i, 'fedora'],
  [/arch linux|\barch\b/i, 'arch'],
  [/alpine/i, 'alpine'],
  [/gentoo/i, 'gentoo'],
  [/nixos/i, 'nixos'],
  [/opensuse|suse/i, 'suse'],
  [/openwrt|lede\b|dd-wrt/i, 'openwrt'],
  [/opnsense/i, 'opnsense'],
  [/pfsense/i, 'pfsense'],
  [/proxmox|\bpve\b/i, 'proxmox'],
  [/xcp-?ng|citrix hypervisor/i, 'hypervisor'],
  [/diskstation|synology|\bdsm\b/i, 'synology'],
  [/truenas|freenas/i, 'truenas'],
  [/esxi|vmkernel|vmware/i, 'vmware'],
  [/android/i, 'android'],
  [/mac os|macos|darwin|apple|ios/i, 'macos'],
  [/openbsd/i, 'openbsd'],
  [/freebsd/i, 'freebsd'],
  [/microsoft windows|windows/i, 'windows'],
  [/linux|unix/i, 'linux'],
];

/** OS ids that describe a *family* (a kernel) rather than a role. */
const GENERIC_OS_IDS = new Set(['linux', 'windows', 'freebsd', 'openbsd', 'macos', 'android']);

// Hypervisors and their management UIs come before the container rule: a Proxmox
// host usually runs docker too, and "this machine runs VMs" is the better label.
const SERVICE_PATTERNS: [RegExp, string][] = [
  [/proxmox|pveproxy|pve-manager|xcp-?ng|vmware|esxi|hyper-v|virtio/i, 'hypervisor'],
  [/gitlab|gitea|forgejo|gogs|bitbucket/i, 'git'],
  [/plex|jellyfin|emby|kodi|serviio|subsonic/i, 'media'],
  [/prometheus|grafana|zabbix|netdata|influxdb|librenms|checkmk/i, 'monitoring'],
  [/opnsense|pfsense|sophos|fortigate|palo alto/i, 'firewall'],
  [/docker|podman|containerd/i, 'docker'],
  [/kubernetes|k8s/i, 'kubernetes'],
  [/synology|qnap|freenas|truenas|diskstation/i, 'nas'],
  [/hikvision|dahua|axis|ipcam|rtsp|onvif/i, 'camera'],
  [/brother|hewlett|canon|epson|xerox|jetdirect|ipp/i, 'printer'],
  [/mysql|postgres|mssql|mongodb|mariadb|oracle|redis|elasticsearch/i, 'database'],
  [/openvpn|wireguard|ipsec|strongswan/i, 'vpn'],
  [/postfix|exim|dovecot|smtp|imap/i, 'mail'],
  // Word boundaries matter here: "rpcbind" on port 111 used to satisfy a bare
  // `bind`, which is how firewall and hypervisor boxes ended up with a DNS icon.
  [/\bbind\b|dnsmasq|\bnamed\b|unbound|\bdomain\b/i, 'dns'],
  [/nginx|openresty|apache|lighttpd|httpd|jenkins|tomcat/i, 'web'],
  [/routeros|cisco|juniper|mikrotik|ubiquiti|unifi|openwrt/i, 'router'],
  [/aws|azure|gcp|cloudflare|s3/i, 'cloud'],
];

const VENDOR_ICONS: [RegExp, string][] = [
  // Virtual NIC vendors (Proxmox, VMware) are deliberately absent: they mean "this
  // is a guest", not "this is the hypervisor", so they must not claim an icon.
  [/synology|qnap|seagate|western digital|drobo/i, 'nas'],
  [/hikvision|dahua|axis|reolink|amcrest|ezviz/i, 'camera'],
  [/brother|canon|epson|xerox|lexmark|ricoh/i, 'printer'],
  [/ubiquiti|cisco|juniper|mikrotik|tp-link|netgear|d-link|aruba|fortinet|palo alto/i, 'router'],
];

/**
 * nmap lists several OS guesses at the same accuracy, and its distro guesses are
 * unreliable: a Proxmox VM ties "Linux 4.15 - 5.19" with "OpenWrt 21.02" and
 * "MikroTik RouterOS" at 100 each. A distro may only pick an icon when no generic
 * family is tied with it – otherwise the role has to come from what the box serves.
 */
function plausibleMatches(host: NmapHost): NmapOsMatch[] {
  if (host.os.length === 0) return [];
  const best = host.os.reduce((max, match) => Math.max(max, match.accuracy), 0);
  return host.os.filter((match) => match.accuracy >= best - 3);
}

function unambiguousOs(host: NmapHost): string[] {
  const plausible = plausibleMatches(host);
  const genericBest = plausible
    .filter((match) => guessId(match.name) !== undefined)
    .reduce((max, match) => Math.max(max, match.accuracy), -1);
  return plausible
    .filter((match) => guessId(match.name) === undefined)
    .filter((match) => match.accuracy > genericBest)
    .map((match) => match.name);
}

/** The kernel family a guess names, but only when it *starts* with it: "OpenWrt 21.02
 *  (Linux 5.4)" is an OpenWrt guess, not a Linux one. */
function guessId(name: string): string | undefined {
  if (/^(microsoft\s+)?windows/i.test(name)) return 'windows';
  if (/^(mac ?os|macos|darwin|ios)\b/i.test(name)) return 'macos';
  if (/^(freebsd|openbsd|netbsd)\b/i.test(name)) return 'bsd';
  if (/^android\b/i.test(name)) return 'android';
  if (/^(linux|unix)\b/i.test(name)) return 'linux';
  return undefined;
}

/** Windows/macOS when every plausible guess agrees – those two say more about the
 *  machine than any single service banner does. */
function soleDesktopOs(host: NmapHost): string | undefined {
  const families = new Set(plausibleMatches(host).map((match) => guessId(match.name)));
  if (families.size !== 1) return undefined;
  const [family] = [...families];
  return family === 'windows' || family === 'macos' ? family : undefined;
}

export function detectIcon(host: NmapHost | undefined): string {
  if (!host) return 'unknown';

  // 1. What the device is, by model or vendor string: an ASUS RT-AX55 running
  //    OpenWrt is still a wireless router on the map.
  const identity = [host.hostnames.join(' '), host.vendor ?? '', host.os.map((match) => match.name).join(' ')].join(
    ' ',
  );
  for (const [pattern, id] of APPLIANCE_PATTERNS) {
    if (pattern.test(identity)) return id;
  }

  // 2. A fingerprinted platform naming a role – but only when the guess is not tied
  //    with a bare "Linux", which nmap offers for almost every x86 box.
  const roles = unambiguousOs(host);
  for (const [pattern, id] of OS_PATTERNS) {
    if (GENERIC_OS_IDS.has(id) || id === 'android') continue;
    if (roles.some((name) => pattern.test(name))) return id;
  }

  // 3. Windows/macOS, when the scan is sure. This beats a web banner: a Windows
  //    workstation that happens to answer on 80 is still a Windows workstation.
  const desktop = soleDesktopOs(host);
  if (desktop) return desktop;

  // 4. The NIC vendor: real hardware vendors (Ubiquiti, Synology, Brother…) say more
  //    than the software a box happens to run. Virtual NIC vendors are excluded.
  for (const [pattern, id] of VENDOR_ICONS) {
    if (host.vendor && pattern.test(host.vendor)) return id;
  }

  // 5. What the open ports actually serve.
  const serviceText = host.ports
    .map((port) => [port.service, port.product, port.extrainfo].filter(Boolean).join(' '))
    .join(' ');
  for (const [pattern, id] of SERVICE_PATTERNS) {
    if (pattern.test(serviceText)) return id;
  }

  // 6. Port shape, when the banners said nothing.
  const open = new Set(host.ports.filter((port) => port.state === 'open').map((port) => port.port));
  if (open.has(8006) || open.has(902) || open.has(903)) return 'hypervisor';
  if (open.has(3389)) return 'windows';
  if (open.has(9100) || open.has(515) || open.has(631)) return 'printer';
  if (open.has(554)) return 'camera';
  if (open.has(53) && open.size <= 2) return 'dns';

  // 7. "It runs Linux" is the least informative answer, so it comes last.
  for (const [pattern, id] of OS_PATTERNS) {
    if (!GENERIC_OS_IDS.has(id)) continue;
    if (host.os.some((match) => pattern.test(match.name))) return id;
  }
  if (open.has(22) || open.has(80) || open.has(443) || open.has(445)) return 'server';

  return 'desktop';
}
