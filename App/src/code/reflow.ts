import { EDGE_OPERATORS } from './dsl';

/**
 * Two ways to write the same layer: one statement per line (`compact`, what the
 * exporter used to emit) and attribute groups wrapped onto indented continuation
 * lines (`expanded`). The parser joins continuations, so both parse to the same
 * document and the toggle is a pure reformat of the text in front of the user.
 *
 * Everything here is textual on purpose: it works on a draft that does not parse
 * yet, and it never drops a comment or an attribute it does not recognise.
 */

export type CodeLayout = 'compact' | 'expanded';

export const CODE_LAYOUTS: CodeLayout[] = ['compact', 'expanded'];

/** A line that starts with `key:` continues the statement above it. */
const CONTINUATION = /^[A-Za-z_][\w-]*\s*:/;
/** …except these, which are statements of their own. */
const LINE_DIRECTIVE = /^(layer|risk)\s*:/i;
const ATTR_START = /^([A-Za-z_][\w-]*)\s*:/;

/** Attribute order inside a group follows the source, so a toggle never shuffles it. */
const NODE_GROUPS: string[][] = [
  ['kind', 'cidr'],
  ['host', 'hostname', 'hostnames', 'ip'],
  ['ports'],
  ['mac', 'vendor', 'os'],
  ['icon', 'accent'],
  ['notes', 'subtitle', 'label'],
  ['size', 'manual-size', 'collapsed', 'z', 'stale', 'depth', 'address'],
];

const EDGE_GROUPS: string[][] = [
  ['style', 'line', 'path'],
  ['from', 'to'],
  ['arrow', 'kind'],
  ['label'],
];

type Attribute = { key: string; raw: string };

const isBlank = (line: string) => line.trim() === '';
const isComment = (line: string) => {
  const trimmed = line.trim();
  return trimmed.startsWith('#') || trimmed.startsWith('%%');
};
const isDirective = (line: string) => LINE_DIRECTIVE.test(line.trim());

/** True when an edge operator appears outside quotes – what tells a link from a node. */
function hasArrow(text: string): boolean {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (EDGE_OPERATORS.some((operator) => text.startsWith(operator, i))) return true;
  }
  return false;
}

function scanStringEnd(line: string, start: number): number {
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === '\\' && i + 1 < line.length) {
      i += 2;
      continue;
    }
    if (line[i] === '"') return i + 1;
    i += 1;
  }
  return line.length;
}

/**
 * Split `web["Web"] host: "…" ports: "…"` into the part that has to stay on the
 * first line and the attribute spans after it. Null when the line has no attributes.
 */
function splitAttributes(line: string): { core: string; attrs: Attribute[]; tail: string } | null {
  let quoted = false;
  let first = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (i > 0 && /[\w-]/.test(line[i - 1])) continue;
    if (ATTR_START.test(line.slice(i))) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;

  const attrs: Attribute[] = [];
  let i = first;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i += 1;
    if (i >= line.length) break;
    const match = ATTR_START.exec(line.slice(i));
    if (!match) break;
    let end = i + match[0].length;
    while (end < line.length && /\s/.test(line[end])) end += 1;
    if (line[end] === '"') {
      end = scanStringEnd(line, end);
    } else {
      while (end < line.length && !/\s/.test(line[end])) end += 1;
    }
    attrs.push({ key: match[1].toLowerCase(), raw: line.slice(i, end) });
    i = end;
  }
  return { core: line.slice(0, first).trimEnd(), attrs, tail: line.slice(i).trim() };
}

function groupOf(key: string, groups: string[][]): number {
  const index = groups.findIndex((group) => group.includes(key));
  if (index >= 0) return index;
  // An unknown key keeps its own line rather than being glued to a neighbour.
  return 1000 + [...key].reduce((hash, ch) => hash * 31 + ch.charCodeAt(0), 7) % 90000;
}

function expandLine(line: string): string {
  if (isBlank(line) || isComment(line) || isDirective(line)) return line;
  const split = splitAttributes(line);
  if (!split || split.attrs.length === 0 || split.core === '') return line;

  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  const groups = hasArrow(split.core) ? EDGE_GROUPS : NODE_GROUPS;
  const pieces: string[] = [];
  let current = -1;
  for (const attr of split.attrs) {
    const group = groupOf(attr.key, groups);
    if (pieces.length === 0 || group !== current) {
      pieces.push(attr.raw);
      current = group;
    } else {
      pieces[pieces.length - 1] += ` ${attr.raw}`;
    }
  }

  const out = [`${split.core} ${pieces[0]}`];
  for (const piece of pieces.slice(1)) out.push(`${indent}  ${piece}`);
  if (split.tail) out[out.length - 1] += ` ${split.tail}`;
  return out.join('\n');
}

/** One statement per line: every indented `key:` continuation joins the one above. */
export function compactCode(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const continues =
      trimmed !== '' && !isComment(line) && !isDirective(line) && CONTINUATION.test(trimmed);
    if (!continues) {
      out.push(line);
      continue;
    }
    // Join past blank and comment lines: they never separate a statement from
    // its own attributes.
    let at = out.length - 1;
    while (at >= 0 && (isBlank(out[at]) || isComment(out[at]))) at -= 1;
    if (at < 0) {
      out.push(line);
      continue;
    }
    out[at] = `${out[at].trimEnd()} ${trimmed}`;
  }
  return out.join('\n');
}

export function expandCode(text: string): string {
  return text.split('\n').map((line) => expandLine(line)).join('\n');
}

/** Normalise through the compact form so either direction starts from one shape. */
export function reflowCode(text: string, layout: CodeLayout): string {
  const compact = compactCode(text);
  return layout === 'expanded' ? expandCode(compact) : compact;
}

/** Counts the statements, for the panel's header and the tests. */
export function countStatements(text: string): number {
  return compactCode(text)
    .split('\n')
    .filter((line) => line.trim() !== '' && !isComment(line)).length;
}
