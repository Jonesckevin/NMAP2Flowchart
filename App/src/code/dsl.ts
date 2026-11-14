import type { EdgeArrow, EdgeKind, EdgeLine, EdgePath, EdgeSide, NodeKind } from '../doc/types';
import { stripControl } from '../export/text';

/**
 * The code side of a diagram: a Mermaid-shaped text format that carries the fields
 * this app actually draws. It is parsed here and nowhere else, so the canvas, the
 * panel and the tests all read one model.
 *
 * Nothing in this file touches the DOM or React – it runs in a worker and in the
 * Node test suite.
 */

export type FlowDirection = 'LR' | 'RL' | 'TB' | 'BT';

export const FLOW_DIRECTIONS: FlowDirection[] = ['LR', 'RL', 'TB', 'BT'];

export type CodeRiskLevel = {
  label: string;
  /** Port spec, in the same syntax the risk dialog accepts. */
  ports: string;
  color?: string;
  /** Defaults to true; `off` in the code turns a level off without dropping it. */
  enabled?: boolean;
};

export type CodeAttrs = Record<string, string>;

export type CodeItem = {
  /** How other statements refer to this node. */
  ref: string;
  kind: NodeKind;
  label?: string;
  attrs: CodeAttrs;
  /** The enclosing `subgraph`, or null at the top level. */
  parent: string | null;
  line: number;
};

export type CodeEdge = {
  from: string;
  to: string;
  label?: string;
  arrow: EdgeArrow;
  line: EdgeLine;
  path?: EdgePath;
  fromSide?: EdgeSide;
  toSide?: EdgeSide;
  kind: EdgeKind;
  lineNo: number;
};

export type CodeModel = {
  direction: FlowDirection;
  items: CodeItem[];
  edges: CodeEdge[];
  layerName?: string;
  layerColor?: string;
  /** `undefined` means the code said nothing about risk levels. */
  risk?: CodeRiskLevel[] | null;
};

export type CodeParseOk = { ok: true; model: CodeModel };
export type CodeParseError = { ok: false; error: string; line: number };
export type CodeParseResult = CodeParseOk | CodeParseError;

/** Longest operators first, so `-.->` is never read as `-.-` plus `>`. */
export const EDGE_OPERATORS = [
  '<-.->',
  '<-->',
  '<==>',
  '<-.-',
  '<---',
  '<==',
  '<--',
  '-.->',
  '==>',
  '---',
  '-.-',
  '===',
  '-->',
  '--',
  '==',
];

const REF = /^[A-Za-z_][\w.:-]*/;
const ATTR_KEY = /^[A-Za-z_][\w-]*/;
/** A line that starts with `key:` continues the statement above it. */
const CONTINUATION = /^[A-Za-z_][\w-]*\s*:/;
/** …except these, which are statements of their own. */
const LINE_DIRECTIVE = /^(layer|risk)\s*:/i;

const DIRECTIONS = new Set<string>(FLOW_DIRECTIONS);
const SHAPE_OPENERS = '[({>';

/** Reading a quoted value: `"…"` with `\"` and `\\` escapes. */
function readQuoted(text: string, start: number): { value: string; end: number } | null {
  if (text[start] !== '"') return null;
  let value = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    if (ch === '"') return { value, end: i + 1 };
    value += ch;
    i += 1;
  }
  return null;
}

function readUntil(text: string, start: number, stop: string): { value: string; end: number } | null {
  const index = text.indexOf(stop, start);
  if (index < 0) return null;
  return { value: text.slice(start, index), end: index + stop.length };
}

/** `key: value` pairs to the end of the statement. */
function readAttrs(text: string): { attrs: CodeAttrs; rest: string } {
  const attrs: CodeAttrs = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s;]/.test(text[i])) i += 1;
    if (i >= text.length) break;
    const keyMatch = ATTR_KEY.exec(text.slice(i));
    if (!keyMatch) break;
    let j = i + keyMatch[0].length;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (text[j] !== ':') break;
    j += 1;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    let value: string;
    if (text[j] === '"') {
      const quoted = readQuoted(text, j);
      if (!quoted) break;
      value = quoted.value;
      j = quoted.end;
    } else {
      const start = j;
      while (j < text.length && !/[\s;]/.test(text[j])) j += 1;
      value = text.slice(start, j);
    }
    attrs[keyMatch[0].toLowerCase()] = value;
    i = j;
  }
  return { attrs, rest: text.slice(i) };
}

type ShapeResult = { label?: string; kind: NodeKind | null; end: number };

/**
 * The shape after a reference decides what the node is unless `kind:` says
 * otherwise: `>…]` is a note, everything else is a card.
 */
function readShape(text: string, start: number): ShapeResult | null {
  const open = text[start];
  if (open === '[') {
    let i = start + 1;
    let label: string | undefined;
    if (text[i] === '"') {
      const quoted = readQuoted(text, i);
      if (!quoted) return null;
      label = quoted.value;
      i = quoted.end;
      while (i < text.length && /\s/.test(text[i])) i += 1;
      if (text[i] !== ']') return null;
      i += 1;
    } else {
      const plain = readUntil(text, i, ']');
      if (!plain) return null;
      label = plain.value;
      i = plain.end;
    }
    return { label, kind: null, end: i };
  }
  if (open === '(') {
    const double = text[start + 1] === '(';
    const close = double ? '))' : ')';
    let i = start + (double ? 2 : 1);
    let label: string | undefined;
    if (text[i] === '"') {
      const quoted = readQuoted(text, i);
      if (!quoted) return null;
      label = quoted.value;
      i = quoted.end;
      while (i < text.length && /\s/.test(text[i])) i += 1;
      if (!text.startsWith(close, i)) return null;
      i += close.length;
    } else {
      const plain = readUntil(text, i, close);
      if (!plain) return null;
      label = plain.value;
      i = plain.end;
    }
    return { label, kind: null, end: i };
  }
  if (open === '>') {
    const plain = readUntil(text, start + 1, ']');
    if (!plain) return null;
    return { label: plain.value, kind: 'note', end: plain.end };
  }
  if (open === '{') {
    const plain = readUntil(text, start + 1, '}');
    if (!plain) return null;
    return { label: plain.value, kind: null, end: plain.end };
  }
  return null;
}

type ItemResult = { item: CodeItem } | { error: string };

function parseItem(text: string, line: number, parent: string | null): ItemResult {
  const source = text.trim();
  const refMatch = REF.exec(source);
  if (!refMatch) return { error: `“${source}” does not start with a node id.` };
  const ref = refMatch[0];
  let i = ref.length;
  while (i < source.length && /\s/.test(source[i])) i += 1;

  let shape: ShapeResult | null = null;
  if (i < source.length && SHAPE_OPENERS.includes(source[i])) {
    shape = readShape(source, i);
    if (!shape) return { error: `The block after “${ref}” is not closed.` };
    i = shape.end;
  }

  const { attrs } = readAttrs(source.slice(i));
  const kind = normalizeKind(attrs.kind?.toLowerCase(), shape?.kind ?? null);

  return {
    item: {
      ref,
      kind,
      label: attrs.label ?? shape?.label,
      attrs,
      parent,
      line,
    },
  };
}

function normalizeKind(declared: string | undefined, inferred: NodeKind | null): NodeKind {
  if (declared === 'host' || declared === 'hop' || declared === 'section' || declared === 'note' || declared === 'origin') {
    return declared;
  }
  return inferred ?? 'host';
}

type FoundOperator = { index: number; operator: string };

/** The first edge operator outside quotes. */
function findOperator(text: string, from: number): FoundOperator | null {
  let quoted = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    for (const operator of EDGE_OPERATORS) {
      if (text.startsWith(operator, i)) return { index: i, operator };
    }
  }
  return null;
}

function arrowOf(operator: string): { arrow: EdgeArrow; line: EdgeLine } {
  const source = operator.startsWith('<');
  const target = operator.endsWith('>');
  const arrow: EdgeArrow = source && target ? 'both' : target ? 'target' : source ? 'source' : 'none';
  const line: EdgeLine = operator.includes('.') ? 'dotted' : 'solid';
  return { arrow, line };
}

type EdgeParseResult = { edges: CodeEdge[] } | { error: string };

function parseEdgeLine(text: string, lineNo: number): EdgeParseResult | null {
  if (!findOperator(text, 0)) return null;

  const segments: string[] = [];
  const operators: string[] = [];
  let cursor = 0;
  let guard = 0;
  let found: FoundOperator | null = findOperator(text, cursor);
  while (found && guard < 64) {
    segments.push(text.slice(cursor, found.index));
    operators.push(found.operator);
    cursor = found.index + found.operator.length;
    guard += 1;
    found = findOperator(text, cursor);
  }
  segments.push(text.slice(cursor));

  const refs: string[] = [];
  const labels: (string | undefined)[] = [];
  let lastAttrs: CodeAttrs = {};

  for (let i = 0; i < segments.length; i += 1) {
    let segment = segments[i].trim();
    if (i > 0 && segment.startsWith('|')) {
      const close = segment.indexOf('|', 1);
      if (close < 0) return { error: `Line ${lineNo}: the edge label is not closed with “|”.` };
      const raw = segment.slice(1, close).trim();
      labels[i - 1] = raw.startsWith('"') ? (readQuoted(raw, 0)?.value ?? raw) : raw;
      segment = segment.slice(close + 1).trim();
    }
    const refMatch = REF.exec(segment);
    if (!refMatch) return { error: `Line ${lineNo}: “${segment || 'missing node'}” is not a node id.` };
    refs.push(refMatch[0]);
    if (i === segments.length - 1) {
      lastAttrs = readAttrs(segment.slice(refMatch[0].length)).attrs;
    }
  }

  const edges: CodeEdge[] = [];
  for (let i = 0; i < operators.length; i += 1) {
    const base = arrowOf(operators[i]);
    const attrs = i === operators.length - 1 ? lastAttrs : {};
    const line = attrLine(attrs) ?? base.line;
    const arrow = attrArrow(attrs) ?? base.arrow;
    const kind: EdgeKind =
      attrs.kind === 'route' || attrs.kind === 'link' ? attrs.kind : arrow === 'none' ? 'route' : 'link';
    edges.push({
      from: refs[i],
      to: refs[i + 1],
      label: attrs.label ?? labels[i],
      arrow,
      line,
      path: attrPath(attrs),
      fromSide: attrSide(attrs.from),
      toSide: attrSide(attrs.to),
      kind,
      lineNo,
    });
  }
  return { edges };
}

function attrLine(attrs: CodeAttrs): EdgeLine | undefined {
  const value = (attrs.style ?? attrs.line ?? '').toLowerCase();
  return value === 'solid' || value === 'dashed' || value === 'dotted' ? value : undefined;
}

function attrArrow(attrs: CodeAttrs): EdgeArrow | undefined {
  const value = (attrs.arrow ?? '').toLowerCase();
  return value === 'target' || value === 'source' || value === 'both' || value === 'none' ? value : undefined;
}

function attrPath(attrs: CodeAttrs): EdgePath | undefined {
  const value = (attrs.path ?? '').toLowerCase();
  return value === 'curve' || value === 'straight' || value === 'step' || value === 'smoothstep' ? value : undefined;
}

function attrSide(value: string | undefined): EdgeSide | undefined {
  const side = (value ?? '').toLowerCase();
  return side === 'l' || side === 'r' || side === 't' || side === 'b' ? side : undefined;
}

/**
 * `risk: Critical = 21, 23 ; High = 445 #f08c2e ; Legacy = 23 off` – levels keep
 * their written order. `none` means "flag nothing"; `inherit` drops the diagram's
 * own levels so the account or server policy applies again.
 */
function parseRisk(text: string): CodeRiskLevel[] | null | { error: string } {
  const source = text.trim();
  if (!source || /^(none|clear|off)$/i.test(source)) return [];
  if (/^(inherit|default)$/i.test(source)) return null;

  const levels: CodeRiskLevel[] = [];
  for (const chunk of source.split(';')) {
    const entry = chunk.trim();
    if (!entry) continue;
    const equals = entry.indexOf('=');
    if (equals < 0) return { error: `“${entry}” needs a “=” between the level name and its ports.` };
    let label = entry.slice(0, equals).trim();
    let rest = entry.slice(equals + 1).trim();
    // The emitted form is `ports #colour off`, so read the flag first and the
    // colour second; `ports off` and `ports #colour` both keep working.
    let enabled = true;
    const offMatch = /\s(off|disabled)\s*$/i.exec(rest);
    if (offMatch) {
      enabled = false;
      rest = rest.slice(0, offMatch.index).trim();
    }
    let color: string | undefined;
    const colorMatch = /\s(#(?:[0-9a-f]{3}|[0-9a-f]{6}))\s*$/i.exec(rest);
    if (colorMatch) {
      color = colorMatch[1];
      rest = rest.slice(0, colorMatch.index).trim();
    }
    if (label.startsWith('"')) label = readQuoted(label, 0)?.value ?? label.slice(1);
    if (!label) return { error: 'A risk level needs a name.' };
    levels.push({
      label,
      ports: rest.replace(/"/g, ''),
      ...(color ? { color } : {}),
      ...(enabled ? {} : { enabled: false }),
    });
  }
  return levels;
}

/**
 * Parse a code block. Errors name the line so the panel can put the caret on it.
 */
export function parseCode(text: string): CodeParseResult {
  const model: CodeModel = { direction: 'LR', items: [], edges: [] };
  const sections: CodeItem[] = [];
  const seen = new Map<string, CodeItem>();

  const physical = stripControl(text).replace(/\r\n?/g, '\n').split('\n');
  const lines: { text: string; line: number }[] = [];
  for (let index = 0; index < physical.length; index += 1) {
    const raw = physical[index];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('%%')) continue;
    // An indented `key: value` belongs to the statement above it, which is what
    // lets a node spread its attributes over several lines.
    const continues = CONTINUATION.test(trimmed) && !LINE_DIRECTIVE.test(trimmed);
    if (continues) {
      if (lines.length === 0) {
        return {
          ok: false,
          error: `Line ${index + 1}: “${trimmed}” has no statement to continue.`,
          line: index + 1,
        };
      }
      lines[lines.length - 1].text += ` ${trimmed}`;
      continue;
    }
    lines.push({ text: raw, line: index + 1 });
  }

  for (const entry of lines) {
    const lineNo = entry.line;
    let line = entry.text.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('%%')) continue;
    line = line.replace(/;$/, '').trim();
    if (!line) continue;

    const header = /^(flowchart|graph)\b\s*(\w+)?/i.exec(line);
    if (header) {
      const direction = (header[2] ?? '').toUpperCase();
      if (DIRECTIONS.has(direction)) model.direction = direction as FlowDirection;
      continue;
    }

    const layerMatch = /^layer\s*:(.*)$/i.exec(line);
    if (layerMatch) {
      let rest = layerMatch[1].trim();
      if (rest.startsWith('"')) {
        const quoted = readQuoted(rest, 0);
        if (!quoted) return { ok: false, error: `Line ${lineNo}: the layer name is not closed.`, line: lineNo };
        model.layerName = quoted.value;
        rest = rest.slice(quoted.end).trim();
      } else if (rest && !/^[A-Za-z_][\w-]*\s*:/.test(rest)) {
        const [first, ...tail] = rest.split(/\s+/);
        model.layerName = first;
        rest = tail.join(' ');
      }
      const { attrs } = readAttrs(rest);
      if (attrs.name) model.layerName = attrs.name;
      if (attrs.color) model.layerColor = attrs.color;
      continue;
    }

    const riskMatch = /^risk\s*:(.*)$/i.exec(line);
    if (riskMatch) {
      const parsed = parseRisk(riskMatch[1]);
      if (parsed && 'error' in parsed) return { ok: false, error: `Line ${lineNo}: ${parsed.error}`, line: lineNo };
      model.risk = parsed;
      continue;
    }

    const subgraph = /^subgraph\s+(.*)$/i.exec(line);
    if (subgraph) {
      const parent = sections.length > 0 ? sections[sections.length - 1].ref : null;
      const result = parseItem(subgraph[1], lineNo, parent);
      if ('error' in result) return { ok: false, error: `Line ${lineNo}: ${result.error}`, line: lineNo };
      const item: CodeItem = { ...result.item, kind: 'section' };
      if (seen.has(item.ref)) {
        return {
          ok: false,
          error: `Line ${lineNo}: “${item.ref}” is already used on line ${seen.get(item.ref)!.line}.`,
          line: lineNo,
        };
      }
      seen.set(item.ref, item);
      model.items.push(item);
      sections.push(item);
      continue;
    }

    if (/^end$/i.test(line)) {
      if (sections.length === 0) {
        return { ok: false, error: `Line ${lineNo}: “end” without a matching subgraph.`, line: lineNo };
      }
      sections.pop();
      continue;
    }

    if (/^(direction|classDef|class|style|click|linkStyle)\b/i.test(line)) continue;

    const edgeResult = parseEdgeLine(line, lineNo);
    if (edgeResult && 'error' in edgeResult) return { ok: false, error: edgeResult.error, line: lineNo };
    if (edgeResult) {
      model.edges.push(...edgeResult.edges);
      continue;
    }

    const parent = sections.length > 0 ? sections[sections.length - 1].ref : null;
    const result = parseItem(line, lineNo, parent);
    if ('error' in result) return { ok: false, error: `Line ${lineNo}: ${result.error}`, line: lineNo };
    if (seen.has(result.item.ref)) {
      return {
        ok: false,
        error: `Line ${lineNo}: “${result.item.ref}” is already used on line ${seen.get(result.item.ref)!.line}.`,
        line: lineNo,
      };
    }
    seen.set(result.item.ref, result.item);
    model.items.push(result.item);
  }

  if (sections.length > 0) {
    const open = sections[sections.length - 1];
    return {
      ok: false,
      error: `“subgraph ${open.ref}” is never closed with “end”.`,
      line: open.line,
    };
  }

  // Mermaid creates a node the first time an edge names it, and so does this: an
  // author should be able to sketch the connections before labelling the boxes.
  for (const edge of model.edges) {
    for (const ref of [edge.from, edge.to]) {
      if (seen.has(ref)) continue;
      const item: CodeItem = { ref, kind: 'host', label: ref, attrs: {}, parent: null, line: edge.lineNo };
      seen.set(ref, item);
      model.items.push(item);
    }
  }

  return { ok: true, model };
}
