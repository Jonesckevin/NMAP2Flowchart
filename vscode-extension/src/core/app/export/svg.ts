import {
  nodeTitle,
  edgeArrow,
  edgeSides,
  type DiagramDoc,
  type EdgePath,
  type EdgeSide,
} from '../doc/types';
import { buildScene } from '../graph/scene';
import { HOP_H } from '../graph/layout';
import { iconById } from '../icons/registry';
import { openPorts } from '../model/types';
import { virtualPlatformOf } from '../model/device';
import { hexToRgba, levelForPort, type RiskPolicy } from '../doc/risk';
import { escapeXml } from './text';


export type SvgExport = { svg: string; width: number; height: number };

const MARGIN = 36;
const MAX_BADGES = 2;

/** The printed palette, and the one a dark surface needs. */
export type SvgTheme = 'light' | 'dark';

const LIGHT = {
  page: '#ffffff',
  sectionFill: '#f6f8fb',
  sectionStroke: '#b6c1d1',
  sectionText: '#334155',
  sectionMuted: '#6b7a8f',
  card: '#ffffff',
  cardStroke: '#c3ccd9',
  title: '#111827',
  sub: '#5a6a7d',
  meta: '#6b7a8f',
  badgeFill: '#eef2f7',
  badgeText: '#334155',
  chipStroke: '#dde5ee',
  hopFill: '#eef2f7',
  hopStroke: '#b6c1d1',
  hopText: '#334155',
  originFill: '#1f2937',
  originStroke: '#0f172a',
  originText: '#f8fafc',
  originLabel: '#7fe6c4',
  originSub: '#9fb0c4',
  noteFill: '#fffbe6',
  noteStroke: '#e6d9a2',
  noteText: '#3b3a2f',
  route: '#8ba1b8',
  link: '#22b98c',
};

type Palette = typeof LIGHT;

/**
 * The dark set mirrors the app's own dark canvas, so a diagram looks the same in a
 * dark editor as it does there. Every colour a shape needs lives in both sets: the
 * icon tiles mix toward `page`, which is what keeps a hue built for white cards
 * from glowing on a dark one.
 */
const DARK: Palette = {
  page: '#0b1118',
  sectionFill: '#141c26',
  sectionStroke: '#2b3746',
  sectionText: '#c7d4e3',
  sectionMuted: '#8698ad',
  card: '#161f2a',
  cardStroke: '#33404f',
  title: '#e9f0f7',
  sub: '#a9b8c9',
  meta: '#8b9cb0',
  badgeFill: '#212c3a',
  badgeText: '#c7d4e3',
  chipStroke: '#33404f',
  hopFill: '#1a2432',
  hopStroke: '#33404f',
  hopText: '#c7d4e3',
  originFill: '#243040',
  originStroke: '#3c4d63',
  originText: '#f2f7fc',
  originLabel: '#7fe6c4',
  originSub: '#a2b6cc',
  noteFill: '#2a2618',
  noteStroke: '#4b4229',
  noteText: '#eee5c7',
  route: '#5d7691',
  link: '#2fd6a5',
};

const SANS = "'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace";

const esc = escapeXml;

const round = (value: number) => Math.round(value * 100) / 100;

/** Where a line attaches to a card, given the side it was drawn to. */
function edgePoint(box: { x: number; y: number; w: number; h: number }, side: EdgeSide): { x: number; y: number } {
  if (side === 'l') return { x: box.x, y: box.y + box.h / 2 };
  if (side === 'r') return { x: box.x + box.w, y: box.y + box.h / 2 };
  if (side === 't') return { x: box.x + box.w / 2, y: box.y };
  return { x: box.x + box.w / 2, y: box.y + box.h };
}

/** A filled triangle at (x, y), pointing away from (fromX, fromY). */
function arrowHead(x: number, y: number, fromX: number, fromY: number, color: string): string {
  const angle = (Math.atan2(y - fromY, x - fromX) * 180) / Math.PI;
  const size = 7.5;
  return `<path d="M 0 0 L ${-size} ${-size * 0.52} L ${-size} ${size * 0.52} Z" fill="${color}" transform="translate(${round(
    x,
  )} ${round(y)}) rotate(${round(angle)})"/>`;
}

function edgeDraw(path: EdgePath, x1: number, y1: number, x2: number, y2: number, bend: number): string {
  if (path === 'straight') return `M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)}`;
  if (path === 'curve') {
    return `M ${round(x1)} ${round(y1)} C ${round(x1 + bend)} ${round(y1)}, ${round(x2 - bend)} ${round(y2)}, ${round(
      x2,
    )} ${round(y2)}`;
  }
  const mid = (x1 + x2) / 2;
  if (path === 'step') return `M ${round(x1)} ${round(y1)} H ${round(mid)} V ${round(y2)} H ${round(x2)}`;
  const r = Math.min(14, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  const dir = y2 >= y1 ? 1 : -1;
  return [
    `M ${round(x1)} ${round(y1)}`,
    `H ${round(mid - r)}`,
    `Q ${round(mid)} ${round(y1)} ${round(mid)} ${round(y1 + dir * r)}`,
    `V ${round(y2 - dir * r)}`,
    `Q ${round(mid)} ${round(y2)} ${round(mid + r)} ${round(y2)}`,
    `H ${round(x2)}`,
  ].join(' ');
}

function tint(hex: string, amount: number, target = '#ffffff'): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value.padEnd(6, '0');
  const base = target.replace('#', '').padEnd(6, '0');
  const mix = (at: number) => {
    const n = Number.parseInt(full.slice(at, at + 2), 16);
    const t = Number.parseInt(base.slice(at, at + 2), 16);
    return Math.round(n + (t - n) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

function textWidth(text: string, size: number, mono: boolean): number {
  return text.length * size * (mono ? 0.6 : 0.53);
}

function fit(text: string, maxWidth: number, size: number, mono: boolean): string {
  if (textWidth(text, size, mono) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, size, mono) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function wrap(text: string, maxWidth: number, size: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, false) > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return lines;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

type TextOpts = {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  mono?: boolean;
  bold?: boolean;
  anchor?: 'start' | 'middle' | 'end';
};

function text({ x, y, text: value, size, color, mono, bold, anchor }: TextOpts): string {
  const family = mono ? MONO : SANS;
  const weight = bold ? ' font-weight="600"' : '';
  const align = anchor ? ` text-anchor="${anchor}"` : '';
  return `<text x="${round(x)}" y="${round(y)}" font-family="${family}" font-size="${size}"${weight}${align} fill="${color}">${esc(
    value,
  )}</text>`;
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  { fill, stroke, sw = 1, rx = 0, dash }: { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string },
): string {
  const paint = [
    fill ? `fill="${fill}"` : 'fill="none"',
    stroke ? `stroke="${stroke}" stroke-width="${sw}"` : '',
    rx ? `rx="${rx}"` : '',
    dash ? `stroke-dasharray="${dash}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" ${paint}/>`;
}

function iconMarkup(id: string | undefined, x: number, y: number, size: number, ink: Palette, dark: boolean): string {
  const def = iconById(id);
  if (def.logo) {
    const scale = size / 24;
    return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})"><path d="${def.logo}" fill="${def.color}"/></g>`;
  }
  const mark = def.mark ?? def.label.slice(0, 2).toUpperCase();
  return [
    rect(x, y, size, size, {
      fill: tint(def.color, 0.86, ink.page),
      stroke: tint(def.color, 0.55, ink.page),
      rx: size * 0.24,
    }),
    text({
      x: x + size / 2,
      y: y + size * 0.68,
      text: mark,
      size: size * 0.44,
      // On a dark tile the initials have to lift toward white, not sink toward it.
      color: dark ? tint(def.color, 0.5) : tint(def.color, 0.35),
      mono: true,
      bold: true,
      anchor: 'middle',
    }),
  ].join('');
}

/**
 * The picture. `theme` picks the palette: `light` is the printed export, `dark` the
 * same drawing on a dark page, which is what the VS Code preview asks for.
 */
export function toSvg(doc: DiagramDoc, riskPolicy: RiskPolicy, theme: SvgTheme = 'light'): SvgExport {
  const scene = buildScene(doc, riskPolicy);
  const ink = theme === 'dark' ? DARK : LIGHT;
  const dark = theme === 'dark';
  const icon = (id: string | undefined, x: number, y: number, size: number) => iconMarkup(id, x, y, size, ink, dark);
  const width = Math.max(320, scene.bounds.x + scene.bounds.w + MARGIN * 2);
  const height = Math.max(200, scene.bounds.y + scene.bounds.h + MARGIN * 2);

  const body: string[] = [];

  for (const section of scene.sections) {
    const b = section.box;
    const count = section.children.length;
    const accent = section.node.accent ?? ink.sectionStroke;
    body.push(rect(b.x, b.y, b.w, b.h, { fill: ink.sectionFill, stroke: accent, sw: 1.4, rx: 16, dash: '7 6' }));
    body.push(icon(section.node.icon ?? 'server', b.x + 14, b.y + 13, 16));
    body.push(
      text({
        x: b.x + 38,
        y: b.y + 27,
        text: fit(nodeTitle(section.node), b.w - 140, 12, false),
        size: 12,
        color: ink.sectionText,
        mono: true,
        bold: true,
      }),
    );
    body.push(
      text({
        x: b.x + 38 + textWidth(fit(nodeTitle(section.node), b.w - 140, 12, true), 12, true) + 10,
        y: b.y + 27,
        text: `${count} nodes`,
        size: 9.5,
        color: ink.sectionMuted,
      }),
    );
  }

  for (const { edge, source, target, line, path } of scene.edges) {
    const a = source.box;
    const b = target.box;
    const sides = edgeSides(edge);
    const start = edgePoint(a, sides.from);
    const end = edgePoint(b, sides.to);
    const x1 = start.x;
    const y1 = start.y;
    const x2 = end.x;
    const y2 = end.y;
    const vertical = sides.from === 't' || sides.from === 'b';
    const bend = Math.max(40, (vertical ? Math.abs(y2 - y1) : Math.abs(x2 - x1)) * 0.45);
    const dash = line === 'solid' ? '' : line === 'dashed' ? '9 5' : '1.8 4.6';
    const stroke = edge.kind === 'route' ? ink.route : ink.link;
    const sw = edge.kind === 'route' ? 1.4 : 2;
    body.push(
      `<path d="${edgeDraw(vertical ? (path === 'curve' ? 'straight' : path) : path, x1, y1, x2, y2, bend)}" fill="none" stroke="${stroke}" stroke-width="${sw}"${
        dash ? ` stroke-dasharray="${dash}"` : ''
      }/>`,
    );
    const arrow = edgeArrow(edge);
    if (arrow === 'target' || arrow === 'both') body.push(arrowHead(x2, y2, x1, y1, stroke));
    if (arrow === 'source' || arrow === 'both') body.push(arrowHead(x1, y1, x2, y2, stroke));
    if (edge.label) {
      body.push(
        text({
          x: (x1 + x2) / 2,
          y: (y1 + y2) / 2 - 6,
          text: edge.label,
          size: 9.5,
          color: ink.meta,
          anchor: 'middle',
        }),
      );
    }
  }

  for (const item of scene.cards) {
    const node = item.node;
    const b = item.box;

    if (node.kind === 'host') {
      const host = node.host;
      const open = host ? openPorts(host) : [];
      const risk = item.risk;
      const stroke = risk?.color ?? node.accent ?? ink.cardStroke;
      body.push(
        rect(b.x, b.y, b.w, b.h, { fill: ink.card, stroke, sw: risk ? 1.6 : 1, rx: 11 }),
      );
      // A risk level owns the stroke, so keep the hand-picked accent visible as a stripe.
      if (risk && node.accent) {
        const inset = b.h * 0.18;
        body.push(
          rect(b.x + 3, b.y + inset, 4, b.h - inset * 2, { fill: node.accent, rx: 3 }),
        );
      }
      body.push(icon(node.icon, b.x + 11, b.y + 10, 20));

      const title = fit(nodeTitle(node), b.w - 70, 11.5, true);
      body.push(text({ x: b.x + 39, y: b.y + 23, text: title, size: 11.5, color: ink.title, mono: true, bold: true }));
      const subtitle = node.subtitle ?? host?.hostnames.find((name) => name.trim()) ?? host?.mac ?? '';
      if (subtitle) {
        body.push(
          text({ x: b.x + 39, y: b.y + 34, text: fit(subtitle, b.w - 60, 9, false), size: 9, color: ink.sub }),
        );
      }
      if (risk) {
        body.push(`<circle cx="${round(b.x + b.w - 15)}" cy="${round(b.y + 15)}" r="3.4" fill="${risk.color}"/>`);
      }

      const meta = host
        ? `${open.length === 0 ? 'no open ports' : `${open.length} open`}${
            host.os[0] ? ` · ${host.os[0].name.split(' ').slice(0, 2).join(' ')}` : ''
          }`
        : (node.notes?.split('\n')[0] ?? 'custom node');
      body.push(text({ x: b.x + 11, y: b.y + 51, text: fit(meta, b.w - 22, 9.5, false), size: 9.5, color: ink.meta }));

      const shownPorts = open.slice(0, open.length > MAX_BADGES ? MAX_BADGES - 1 : MAX_BADGES);
      const overflow = open.length - shownPorts.length;
      let cursor = b.x + 11;
      const chipY = b.y + b.h - 26;
      const chip = (label: string, color?: string) => {
        const labelWidth = textWidth(label, 8.5, true);
        const w = labelWidth + 12;
        if (cursor + w > b.x + b.w - 10) return;
        body.push(
          rect(cursor, chipY, w, 17, {
            fill: color ? hexToRgba(color, 0.16) : ink.badgeFill,
            stroke: color ? hexToRgba(color, 0.45) : ink.chipStroke,
            rx: 5,
          }),
        );
        body.push(
          text({
            x: cursor + 6,
            y: chipY + 12,
            text: label,
            size: 8.5,
            color: color ?? ink.badgeText,
            mono: true,
          }),
        );
        cursor += w + 6;
      };
      for (const port of shownPorts) {
        chip(`${port.port}${port.service ? ` ${port.service}` : ''}`, levelForPort(port.port, riskPolicy)?.color);
      }
      if (overflow > 0) chip(`+${overflow}`, undefined);
      if (virtualPlatformOf(host)) chip('VM', undefined);
      continue;
    }

    if (node.kind === 'note') {
      body.push(rect(b.x, b.y, b.w, b.h, { fill: ink.noteFill, stroke: node.accent ?? ink.noteStroke, sw: 1, rx: 10 }));
      body.push(icon(node.icon ?? 'iot', b.x + 10, b.y + 10, 14));
      body.push(
        text({ x: b.x + 30, y: b.y + 21, text: fit(nodeTitle(node), b.w - 44, 10.5, false), size: 10.5, color: ink.noteText, bold: true }),
      );
      const lines = wrap(node.notes ?? '', b.w - 22, 9.5, Math.max(1, Math.floor((b.h - 40) / 13)));
      lines.forEach((line, index) => {
        body.push(text({ x: b.x + 11, y: b.y + 40 + index * 13, text: line, size: 9.5, color: ink.noteText }));
      });
      continue;
    }

    if (node.kind === 'hop') {
      body.push(rect(b.x, b.y, b.w, b.h, { fill: ink.hopFill, stroke: node.accent ?? ink.hopStroke, sw: 1, rx: HOP_H / 2 }));
      body.push(icon(node.icon ?? 'router', b.x + 12, b.y + (HOP_H - 15) / 2, 15));
      body.push(text({ x: b.x + 33, y: b.y + 20, text: `hop ${node.depth ?? 1}`, size: 8, color: ink.sectionMuted }));
      body.push(
        text({ x: b.x + 33, y: b.y + 33, text: fit(nodeTitle(node), b.w - 44, 10, true), size: 10, color: ink.hopText, mono: true }),
      );
      if (node.subtitle) {
        body.push(text({ x: b.x + 33, y: b.y + 44, text: fit(node.subtitle, b.w - 44, 7.5, false), size: 7.5, color: ink.sectionMuted }));
      }
      continue;
    }

    body.push(rect(b.x, b.y, b.w, b.h, { fill: ink.originFill, stroke: node.accent ?? ink.originStroke, sw: 1.2, rx: 12 }));
    body.push(icon(node.icon ?? 'cloud', b.x + 12, b.y + 12, 16));
    body.push(
      text({
        x: b.x + 34,
        y: b.y + 22,
        text: nodeTitle(node).toUpperCase(),
        size: 8.5,
        color: ink.originLabel,
        bold: true,
      }),
    );
    body.push(
      text({
        x: b.x + 12,
        y: b.y + 40,
        text: fit(node.address ?? node.notes ?? 'imported scan', b.w - 24, 9.5, true),
        size: 9.5,
        color: ink.originText,
        mono: true,
      }),
    );
    body.push(text({ x: b.x + 12, y: b.y + 56, text: node.subtitle ?? '', size: 9, color: ink.originSub }));
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(
      height,
    )}" viewBox="0 0 ${round(width)} ${round(height)}">`,
    `<title>${esc(doc.fileName)}</title>`,
    rect(0, 0, width, height, { fill: ink.page }),
    `<g transform="translate(${MARGIN} ${MARGIN})">`,
    ...body,
    '</g>',
    '</svg>',
  ].join('\n');

  return { svg, width, height };
}
