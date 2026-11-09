import { nodeTitle, type DiagramDoc, type DiagramNode } from '../doc/types';
import { iconEmoji } from '../icons/registry';
import { portSummaryOr } from '../model/types';
import { nodeRisk, type RiskPolicy } from '../doc/risk';
import { buildScene } from '../graph/scene';
import { HOP_H, HOP_W, HOST_H, HOST_W, NOTE_H, NOTE_W, ORIGIN_H, ORIGIN_W } from '../graph/layout';
import { escapeXml } from './text';

const esc = escapeXml;

const cellId = (id: string) => `c_${id.replace(/[^0-9a-zA-Z]+/g, '_')}`;

/** A hand-picked accent replaces the style's own stroke colour. */
const withAccent = (style: string, accent?: string) =>
  accent ? style.replace(/strokeColor=[^;]*;/, `strokeColor=${accent};`) : style;

const SECTION_STYLE =
  'rounded=0;html=1;dashed=1;dashPattern=6 6;fillColor=#f6f8fb;strokeColor=#b6c1d1;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontColor=#5a6a7d;fontStyle=1;fontSize=12;';
const HOST_STYLE =
  'rounded=1;html=1;whiteSpace=wrap;fillColor=#ffffff;strokeColor=#c3ccd9;align=left;verticalAlign=top;spacingLeft=10;spacingTop=8;spacingRight=8;fontSize=11;fontColor=#111827;arcSize=8;';
const NOTE_STYLE =
  'rounded=1;html=1;whiteSpace=wrap;fillColor=#fffbe6;strokeColor=#e6d9a2;align=left;verticalAlign=top;spacingLeft=10;spacingTop=8;fontSize=11;fontColor=#3b3a2f;arcSize=6;';
const HOP_STYLE =
  'rounded=1;html=1;whiteSpace=wrap;fillColor=#eef2f7;strokeColor=#b6c1d1;fontSize=11;fontColor=#334155;arcSize=40;';
const ORIGIN_STYLE =
  'rounded=1;html=1;whiteSpace=wrap;fillColor=#1f2937;strokeColor=#0f172a;fontColor=#f8fafc;fontSize=11;align=left;spacingLeft=12;verticalAlign=middle;arcSize=12;';

function vertex(id: string, value: string, style: string, x: number, y: number, w: number, h: number) {
  return `        <mxCell id="${id}" value="${esc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${Math.round(
    x,
  )}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/></mxCell>`;
}

/** Child vertex: geometry is relative to the parent cell's origin. */
function vertexChild(id: string, parent: string, style: string, x: number, y: number, w: number, h: number) {
  return `        <mxCell id="${id}" value="" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${Math.round(
    x,
  )}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/></mxCell>`;
}

function edge(id: string, source: string, target: string, style: string, label?: string) {
  return `        <mxCell id="${id}" value="${esc(label ?? '')}" style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

const ROUTE_EDGE = 'html=1;dashed=1;strokeColor=#8ba1b8;endArrow=block;endFill=1;';
const LINK_EDGE = 'html=1;strokeColor=#22b98c;strokeWidth=2;endArrow=block;endFill=1;';

const PATH_STYLE: Record<string, string> = {
  curve: 'edgeStyle=none;curved=1;',
  straight: 'edgeStyle=none;',
  step: 'edgeStyle=orthogonalEdgeStyle;rounded=0;',
  smoothstep: 'edgeStyle=orthogonalEdgeStyle;rounded=1;',
};

const DASH_STYLE: Record<string, string> = {
  solid: '',
  dashed: 'dashed=1;dashPattern=9 5;',
  dotted: 'dashed=1;dashPattern=1.5 4;',
};

function hostLabel(node: DiagramNode, riskPolicy: RiskPolicy): string {
  const icon = iconEmoji(node.icon);
  const lines = [`<b>${esc(icon)} ${esc(nodeTitle(node))}</b>`];
  if (node.subtitle) lines.push(`<font color="#5a6a7d">${esc(node.subtitle)}</font>`);
  const risk = nodeRisk(node.host, riskPolicy);
  const ports = node.host ? portSummaryOr(node.host, 'discovered, no port scan', 5) : '';
  if (ports && ports !== 'no open ports') {
    lines.push(`<font color="${risk?.color ?? '#2563eb'}">${esc(ports)}</font>`);
  } else if (node.host) lines.push('<font color="#8b97a8">no open ports</font>');
  return lines.join('<br>');
}

export function toDrawio(doc: DiagramDoc, riskPolicy: RiskPolicy): string {
  const scene = buildScene(doc, riskPolicy);
  const cells: string[] = [];
  let maxX = 0;
  let maxY = 0;

  for (const section of scene.sections) {
    const { w, h } = section.box;
    maxX = Math.max(maxX, section.box.x + w);
    maxY = Math.max(maxY, section.box.y + h);
    cells.push(
      vertex(
        cellId(section.node.id),
        `<b>${esc(iconEmoji(section.node.icon))} ${esc(nodeTitle(section.node))}</b>`,
        withAccent(SECTION_STYLE, section.node.accent),
        section.box.x,
        section.box.y,
        w,
        h,
      ),
    );
  }

  for (const item of scene.cards) {
    const node = item.node;
    const pos = item.box;
    if (node.kind === 'host') {
      const risk = item.risk;
      const base = withAccent(HOST_STYLE, node.accent);
      // The level colour outranks a hand-picked accent, matching the canvas.
      const style = risk ? `${withAccent(base, risk.color)}strokeWidth=2;` : base;
      maxX = Math.max(maxX, pos.x + HOST_W);
      maxY = Math.max(maxY, pos.y + HOST_H);
      cells.push(vertex(cellId(node.id), hostLabel(node, riskPolicy), style, pos.x, pos.y, HOST_W, HOST_H));
      // The risk stroke outranks the accent, so keep the accent visible as an inset stripe.
      if (risk && node.accent) {
        const inset = Math.round(HOST_H * 0.18);
        cells.push(
          vertexChild(
            `${cellId(node.id)}_accent`,
            cellId(node.id),
            `rounded=1;html=1;fillColor=${node.accent};strokeColor=none;`,
            3,
            inset,
            4,
            HOST_H - inset * 2,
          ),
        );
      }
    } else if (node.kind === 'note') {
      const w = node.size?.w ?? NOTE_W;
      const h = node.size?.h ?? NOTE_H;
      maxX = Math.max(maxX, pos.x + w);
      maxY = Math.max(maxY, pos.y + h);
      cells.push(
        vertex(
          cellId(node.id),
          `<b>${esc(iconEmoji(node.icon))} ${esc(nodeTitle(node))}</b><br><font color="#5b5a48">${esc(
            node.notes ?? '',
          )}</font>`,
          withAccent(NOTE_STYLE, node.accent),
          pos.x,
          pos.y,
          w,
          h,
        ),
      );
    } else if (node.kind === 'hop') {
      maxX = Math.max(maxX, pos.x + HOP_W);
      maxY = Math.max(maxY, pos.y + HOP_H);
      cells.push(
        vertex(
          cellId(node.id),
          `<b>hop ${node.depth ?? 1}</b><br>${esc(nodeTitle(node))}`,
          withAccent(HOP_STYLE, node.accent),
          pos.x,
          pos.y,
          HOP_W,
          HOP_H,
        ),
      );
    } else {
      maxX = Math.max(maxX, pos.x + ORIGIN_W);
      maxY = Math.max(maxY, pos.y + ORIGIN_H);
      cells.push(
        vertex(
          cellId(node.id),
          `<b>${esc(nodeTitle(node).toUpperCase())}</b><br><font color="#9fb3c8">${esc(
            node.address ?? node.notes ?? '',
          )}</font>`,
          withAccent(ORIGIN_STYLE, node.accent),
          pos.x,
          pos.y,
          ORIGIN_W,
          ORIGIN_H,
        ),
      );
    }
  }

  for (const { edge: link, line, path } of scene.edges) {
    const base = link.kind === 'route' ? ROUTE_EDGE : LINK_EDGE;
    const style = `${PATH_STYLE[path]}${base}${DASH_STYLE[line] ?? ''}`;
    cells.push(edge(cellId(link.id), cellId(link.source), cellId(link.target), style, link.label));
  }

  const pageWidth = Math.round(maxX + 80);
  const pageHeight = Math.round(maxY + 80);

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="nmap2flowchart" agent="nmap2flowchart" version="24.7.8" type="device">
  <diagram id="nmap2flowchart" name="${esc(doc.fileName)}">
    <mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}
