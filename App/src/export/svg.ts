import {
  edgeLine,
  edgePath,
  isLayerVisible,
  layerMap,
  nodeTitle,
  type DiagramDoc,
  type DiagramNode,
  type EdgePath,
} from '../doc/types';
import { absolutePosition, measureSection, nodeSize } from '../doc/measure';
import { HOP_H } from '../graph/layout';
import { iconById } from '../icons/registry';
import { openPorts } from '../model/types';
import { hexToRgba, levelForPort, nodeRisk, type RiskPolicy } from '../doc/risk';


export type SvgExport = { svg: string; width: number; height: number };

const MARGIN = 36;
const MAX_BADGES = 2;

const INK = {
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
  hopFill: '#eef2f7',
  hopStroke: '#b6c1d1',
  hopText: '#334155',
  originFill: '#1f2937',
  originStroke: '#0f172a',
  originText: '#f8fafc',
  noteFill: '#fffbe6',
  noteStroke: '#e6d9a2',
  noteText: '#3b3a2f',
  route: '#8ba1b8',
  link: '#22b98c',
};

const SANS = "'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace";

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round = (value: number) => Math.round(value * 100) / 100;

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

function tint(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value.padEnd(6, '0');
  const mix = (channel: string) => {
    const n = Number.parseInt(channel, 16);
    return Math.round(n + (255 - n) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(full.slice(0, 2))}${mix(full.slice(2, 4))}${mix(full.slice(4, 6))}`;
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

function iconMarkup(id: string | undefined, x: number, y: number, size: number): string {
  const def = iconById(id);
  if (def.logo) {
    const scale = size / 24;
    return `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})"><path d="${def.logo}" fill="${def.color}"/></g>`;
  }
  const mark = def.mark ?? def.label.slice(0, 2).toUpperCase();
  return [
    rect(x, y, size, size, { fill: tint(def.color, 0.86), stroke: tint(def.color, 0.55), rx: size * 0.24 }),
    text({
      x: x + size / 2,
      y: y + size * 0.68,
      text: mark,
      size: size * 0.44,
      color: tint(def.color, 0.35),
      mono: true,
      bold: true,
      anchor: 'middle',
    }),
  ].join('');
}

function visibleNodes(doc: DiagramDoc): DiagramNode[] {
  const layers = layerMap(doc.layers);
  const drawable = (node: DiagramNode) => isLayerVisible(layers, node.layerId, doc.focusedLayerId);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));

  const shown = new Set<string>();
  for (const node of doc.nodes) {
    if (node.kind === 'section' && drawable(node)) shown.add(node.id);
  }
  for (const node of doc.nodes) {
    if (node.kind === 'section') continue;
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (parent?.kind === 'section' && (parent.collapsed || !shown.has(parent.id))) continue;
    }
    if (drawable(node)) shown.add(node.id);
  }
  return doc.nodes.filter((node) => shown.has(node.id));
}

export function toSvg(doc: DiagramDoc, riskPolicy: RiskPolicy): SvgExport {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const visible = visibleNodes(doc);
  const shown = new Set(visible.map((node) => node.id));

  const box = (node: DiagramNode) => {
    const pos = absolutePosition(node, byId);
    const children = node.kind === 'section' ? visible.filter((child) => child.parentId === node.id) : [];
    const size = node.kind === 'section' ? measureSection(node, children) : nodeSize(node);
    return { x: pos.x, y: pos.y, w: size.w, h: size.h };
  };

  let maxX = 0;
  let maxY = 0;
  for (const node of visible) {
    const b = box(node);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const width = Math.max(320, maxX + MARGIN * 2);
  const height = Math.max(200, maxY + MARGIN * 2);

  const body: string[] = [];

  for (const section of visible.filter((node) => node.kind === 'section')) {
    const b = box(section);
    const count = visible.filter((child) => child.parentId === section.id).length;
    const accent = section.accent ?? INK.sectionStroke;
    body.push(rect(b.x, b.y, b.w, b.h, { fill: INK.sectionFill, stroke: accent, sw: 1.4, rx: 16, dash: '7 6' }));
    body.push(iconMarkup(section.icon ?? 'server', b.x + 14, b.y + 13, 16));
    body.push(
      text({
        x: b.x + 38,
        y: b.y + 27,
        text: fit(nodeTitle(section), b.w - 140, 12, false),
        size: 12,
        color: INK.sectionText,
        mono: true,
        bold: true,
      }),
    );
    body.push(
      text({
        x: b.x + 38 + textWidth(fit(nodeTitle(section), b.w - 140, 12, true), 12, true) + 10,
        y: b.y + 27,
        text: `${count} nodes`,
        size: 9.5,
        color: INK.sectionMuted,
      }),
    );
  }

  for (const edge of doc.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || !shown.has(source.id) || !shown.has(target.id)) continue;
    const a = box(source);
    const b = box(target);
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const bend = Math.max(40, Math.abs(x2 - x1) * 0.45);
    const style = edgeLine(edge);
    const path = edgePath(edge);
    const dash = style === 'solid' ? '' : style === 'dashed' ? '9 5' : '1.8 4.6';
    const stroke = edge.kind === 'route' ? INK.route : INK.link;
    const sw = edge.kind === 'route' ? 1.4 : 2;
    body.push(
      `<path d="${edgeDraw(path, x1, y1, x2, y2, bend)}" fill="none" stroke="${stroke}" stroke-width="${sw}"${
        dash ? ` stroke-dasharray="${dash}"` : ''
      }/>`,
    );
    if (edge.label) {
      body.push(
        text({
          x: (x1 + x2) / 2,
          y: (y1 + y2) / 2 - 6,
          text: edge.label,
          size: 9.5,
          color: INK.meta,
          anchor: 'middle',
        }),
      );
    }
  }

  for (const node of visible) {
    if (node.kind === 'section') continue;
    const b = box(node);

    if (node.kind === 'host') {
      const host = node.host;
      const open = host ? openPorts(host) : [];
      const risk = nodeRisk(host, riskPolicy);
      const stroke = risk?.color ?? node.accent ?? INK.cardStroke;
      body.push(
        rect(b.x, b.y, b.w, b.h, { fill: INK.card, stroke, sw: risk ? 1.6 : 1, rx: 11 }),
      );
      // A risk level owns the stroke, so keep the hand-picked accent visible as a stripe.
      if (risk && node.accent) {
        const inset = b.h * 0.18;
        body.push(
          rect(b.x + 3, b.y + inset, 4, b.h - inset * 2, { fill: node.accent, rx: 3 }),
        );
      }
      body.push(iconMarkup(node.icon, b.x + 11, b.y + 10, 20));

      const title = fit(nodeTitle(node), b.w - 70, 11.5, true);
      body.push(text({ x: b.x + 39, y: b.y + 23, text: title, size: 11.5, color: INK.title, mono: true, bold: true }));
      const subtitle = node.subtitle ?? host?.hostnames.find((name) => name.trim()) ?? host?.mac ?? '';
      if (subtitle) {
        body.push(
          text({ x: b.x + 39, y: b.y + 34, text: fit(subtitle, b.w - 60, 9, false), size: 9, color: INK.sub }),
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
      body.push(text({ x: b.x + 11, y: b.y + 51, text: fit(meta, b.w - 22, 9.5, false), size: 9.5, color: INK.meta }));

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
            fill: color ? hexToRgba(color, 0.16) : INK.badgeFill,
            stroke: color ? hexToRgba(color, 0.45) : '#dde5ee',
            rx: 5,
          }),
        );
        body.push(
          text({
            x: cursor + 6,
            y: chipY + 12,
            text: label,
            size: 8.5,
            color: color ?? INK.badgeText,
            mono: true,
          }),
        );
        cursor += w + 6;
      };
      for (const port of shownPorts) {
        chip(`${port.port}${port.service ? ` ${port.service}` : ''}`, levelForPort(port.port, riskPolicy)?.color);
      }
      if (overflow > 0) chip(`+${overflow}`, undefined);
      continue;
    }

    if (node.kind === 'note') {
      body.push(rect(b.x, b.y, b.w, b.h, { fill: INK.noteFill, stroke: node.accent ?? INK.noteStroke, sw: 1, rx: 10 }));
      body.push(iconMarkup(node.icon ?? 'iot', b.x + 10, b.y + 10, 14));
      body.push(
        text({ x: b.x + 30, y: b.y + 21, text: fit(nodeTitle(node), b.w - 44, 10.5, false), size: 10.5, color: INK.noteText, bold: true }),
      );
      const lines = wrap(node.notes ?? '', b.w - 22, 9.5, Math.max(1, Math.floor((b.h - 40) / 13)));
      lines.forEach((line, index) => {
        body.push(text({ x: b.x + 11, y: b.y + 40 + index * 13, text: line, size: 9.5, color: INK.noteText }));
      });
      continue;
    }

    if (node.kind === 'hop') {
      body.push(rect(b.x, b.y, b.w, b.h, { fill: INK.hopFill, stroke: node.accent ?? INK.hopStroke, sw: 1, rx: HOP_H / 2 }));
      body.push(iconMarkup(node.icon ?? 'router', b.x + 12, b.y + (HOP_H - 15) / 2, 15));
      body.push(text({ x: b.x + 33, y: b.y + 20, text: `hop ${node.depth ?? 1}`, size: 8, color: INK.sectionMuted }));
      body.push(
        text({ x: b.x + 33, y: b.y + 33, text: fit(nodeTitle(node), b.w - 44, 10, true), size: 10, color: INK.hopText, mono: true }),
      );
      if (node.subtitle) {
        body.push(text({ x: b.x + 33, y: b.y + 44, text: fit(node.subtitle, b.w - 44, 7.5, false), size: 7.5, color: INK.sectionMuted }));
      }
      continue;
    }

    body.push(rect(b.x, b.y, b.w, b.h, { fill: INK.originFill, stroke: node.accent ?? INK.originStroke, sw: 1.2, rx: 12 }));
    body.push(iconMarkup(node.icon ?? 'cloud', b.x + 12, b.y + 12, 16));
    body.push(
      text({
        x: b.x + 34,
        y: b.y + 22,
        text: nodeTitle(node).toUpperCase(),
        size: 8.5,
        color: '#7fe6c4',
        bold: true,
      }),
    );
    body.push(
      text({
        x: b.x + 12,
        y: b.y + 40,
        text: fit(node.address ?? node.notes ?? 'imported scan', b.w - 24, 9.5, true),
        size: 9.5,
        color: INK.originText,
        mono: true,
      }),
    );
    body.push(text({ x: b.x + 12, y: b.y + 56, text: node.subtitle ?? '', size: 9, color: '#9fb0c4' }));
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(
      height,
    )}" viewBox="0 0 ${round(width)} ${round(height)}">`,
    `<title>${esc(doc.fileName)}</title>`,
    rect(0, 0, width, height, { fill: INK.page }),
    `<g transform="translate(${MARGIN} ${MARGIN})">`,
    ...body,
    '</g>',
    '</svg>',
  ].join('\n');

  return { svg, width, height };
}
