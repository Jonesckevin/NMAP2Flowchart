import { edgeLine, isLayerVisible, layerMap, nodeTitle, type DiagramDoc, type DiagramNode } from '../doc/types';
import { iconEmoji } from '../icons/registry';
import { openPorts, portSummaryOr, riskyPorts } from '../model/types';

const mid = (id: string) => `n_${id.replace(/[^0-9a-zA-Z]+/g, '_')}`;
const esc = (value: string) => value.replace(/"/g, "'").replace(/\s+/g, ' ').trim();

function labelFor(node: DiagramNode): string {
  const icon = iconEmoji(node.icon);
  const title = esc(nodeTitle(node));
  if (node.kind === 'section') return `${title}`;
  if (node.host) {
    const subtitle = node.subtitle ? `<br/>${esc(node.subtitle)}` : '';
    const ports = portSummaryOr(node.host, 'discovered, no port scan');
    return `${icon} ${title}${subtitle}<br/>${esc(ports)}`;
  }
  if (node.kind === 'note') {
    const body = node.notes ? `<br/>${esc(node.notes.slice(0, 120))}` : '';
    return `${icon} ${title}${body}`;
  }
  if (node.subtitle) return `${icon} ${title}<br/>${esc(node.subtitle)}`;
  return `${icon} ${title}`;
}

export function toMermaid(doc: DiagramDoc): string {
  const layers = layerMap(doc.layers);
  const visible = doc.nodes.filter((node) => isLayerVisible(layers, node.layerId, doc.focusedLayerId));
  const visibleIds = new Set(visible.map((node) => node.id));
  const sections = visible.filter((node) => node.kind === 'section');
  const lines: string[] = ['flowchart LR'];

  if (doc.args) lines.push(`  %% ${esc(doc.args)}`);

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
    const arrow = line === 'solid' && edge.kind !== 'route' ? '-->' : '-.->';
    const label = edge.label ? `|${esc(edge.label)}|` : '';
    lines.push(`  ${mid(edge.source)} ${arrow}${label} ${mid(edge.target)}`);
  }

  const risky = visible.filter((node) => node.host && riskyPorts(node.host).length > 0);
  if (risky.length > 0) {
    lines.push('  classDef risky fill:#3a1c1c,stroke:#e06c6c,color:#ffdcdc;');
    lines.push(`  class ${risky.map((node) => mid(node.id)).join(',')} risky;`);
  }
  const idle = visible.filter((node) => node.host && openPorts(node.host).length === 0);
  if (idle.length > 0) {
    lines.push('  classDef bare fill:#1b2029,stroke:#3b4657,color:#8b97a8;');
    lines.push(`  class ${idle.map((node) => mid(node.id)).join(',')} bare;`);
  }

  return `${lines.join('\n')}\n`;
}
