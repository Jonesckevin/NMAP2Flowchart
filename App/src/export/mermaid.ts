import { edgeArrow, edgeLine, nodeSubtitle, nodeTitle, type DiagramDoc, type DiagramNode } from '../doc/types';
import { buildScene } from '../graph/scene';
import { iconEmoji } from '../icons/registry';
import { virtualPlatformOf } from '../model/device';
import { openPorts, portSummaryOr } from '../model/types';
import { hexToRgba, nodeRisk, type RiskPolicy } from '../doc/risk';
import { escapeMermaid, stripControl } from './text';

const mid = (id: string) => `n_${id.replace(/[^0-9a-zA-Z]+/g, '_')}`;
const esc = escapeMermaid;

function labelFor(node: DiagramNode): string {
  const icon = iconEmoji(node.icon);
  const title = esc(nodeTitle(node));
  if (node.kind === 'section') return `${title}`;
  if (node.host) {
    const subtitle = nodeSubtitle(node) ? `<br/>${esc(nodeSubtitle(node))}` : '';
    const ports = portSummaryOr(node.host, 'discovered, no port scan');
    const vm = virtualPlatformOf(node.host) ? ' (VM)' : '';
    return `${icon} ${title}${vm}${subtitle}<br/>${esc(ports)}`;
  }
  if (node.kind === 'note') {
    const body = node.notes ? `<br/>${esc(node.notes.slice(0, 120))}` : '';
    return `${icon} ${title}${body}`;
  }
  if (nodeSubtitle(node)) return `${icon} ${title}<br/>${esc(nodeSubtitle(node))}`;
  return `${icon} ${title}`;
}

export function toMermaid(doc: DiagramDoc, riskPolicy: RiskPolicy): string {
  const scene = buildScene(doc, riskPolicy);
  // Document order keeps the generated flowchart reading like the scan it came from.
  const visible = doc.nodes.filter((node) => scene.ids.has(node.id));
  const visibleIds = scene.ids;
  const sections = visible.filter((node) => node.kind === 'section');
  const lines: string[] = ['flowchart LR'];

  if (doc.args) lines.push(`  %% ${stripControl(doc.args).replace(/\s+/g, ' ').trim()}`);

  if (sections.length === 0) {
    for (const node of visible) lines.push(`  ${mid(node.id)}["${labelFor(node)}"]`);
  } else {
    for (const section of sections) {
      const children = visible.filter((node) => node.parentId === section.id);
      lines.push(`  subgraph ${mid(section.id)}["${labelFor(section)}"]`);
      lines.push('    direction TB');
      for (const child of children) lines.push(`    ${mid(child.id)}["${labelFor(child)}"]`);
      lines.push('  end');
    }
    for (const node of visible) {
      if (node.kind === 'section' || node.parentId) continue;
      lines.push(`  ${mid(node.id)}["${labelFor(node)}"]`);
    }
  }

  for (const edge of doc.edges) {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    const line = edgeLine(edge);
    const style = edgeArrow(edge);
    const dotted = line === 'solid' && edge.kind !== 'route' ? false : true;
    // Mermaid reads the arrow from the operator: filled, open, both ways or none.
    const arrow = dotted
      ? style === 'none'
        ? '-.-'
        : style === 'both'
          ? '<-.->'
          : style === 'source'
            ? '<-.-'
            : '-.->'
      : style === 'none'
        ? '---'
        : style === 'both'
          ? '<-->'
          : style === 'source'
            ? '<--'
            : '-->';
    const label = edge.label ? `|${esc(edge.label)}|` : '';
    lines.push(`  ${mid(edge.source)} ${arrow}${label} ${mid(edge.target)}`);
  }

  // One class per risk level, each host in its highest-priority level only, so
  // the visual hierarchy matches the canvas.
  const flagged = new Map<string, { label: string; color: string; nodes: string[] }>();
  for (const node of visible) {
    const risk = nodeRisk(node.host, riskPolicy);
    if (!risk) continue;
    const bucket = flagged.get(risk.id);
    if (bucket) bucket.nodes.push(mid(node.id));
    else flagged.set(risk.id, { label: risk.label, color: risk.color, nodes: [mid(node.id)] });
  }
  for (const [id, entry] of flagged) {
    lines.push(
      `  classDef risk_${id} fill:${hexToRgba(entry.color, 0.14)},stroke:${entry.color},stroke-width:2px,color:${entry.color};`,
    );
    lines.push(`  class ${entry.nodes.join(',')} risk_${id};`);
  }

  const idle = visible.filter((node) => node.host && openPorts(node.host).length === 0);
  if (idle.length > 0) {
    lines.push('  classDef bare fill:#1b2029,stroke:#3b4657,color:#8b97a8;');
    lines.push(`  class ${idle.map((node) => mid(node.id)).join(',')} bare;`);
  }

  return `${lines.join('\n')}\n`;
}
