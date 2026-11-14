import { EDGE_OPERATORS } from './dsl';

/**
 * Syntax colouring for the code panel. The tokenizer is deliberately small and
 * line-based, because that is what the format is: nothing spans a line except a
 * quoted string, and a `#` only starts a comment at the start of one.
 *
 * Pure and dependency-free, so the panel only has to map kinds to CSS classes and
 * the tests can pin the kinds without a browser.
 */

export type HighlightKind =
  | 'comment'
  | 'directive'
  | 'keyword'
  | 'id'
  | 'attr'
  | 'string'
  | 'number'
  | 'color'
  | 'arrow'
  | 'edgeLabel'
  | 'punct'
  | 'plain';

export type HighlightToken = { text: string; kind: HighlightKind };

const DIRECTIVES = new Set(['flowchart', 'graph', 'subgraph', 'end', 'layer', 'risk', 'direction']);
const DIRECTIONS = new Set(['LR', 'RL', 'TB', 'BT']);

/** Bare values that read as language, not as a name. */
const VALUES = new Set([
  'true',
  'false',
  'host',
  'hop',
  'origin',
  'note',
  'section',
  'link',
  'route',
  'solid',
  'dashed',
  'dotted',
  'curve',
  'straight',
  'step',
  'smoothstep',
  'target',
  'source',
  'both',
  'none',
  'off',
  'inherit',
  'clear',
  'l',
  'r',
  't',
  'b',
]);

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;
const RGB = /^rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*(?:[,/]\s*(?:\d+(?:\.\d+)?|\.\d+)%?\s*)?\)/;
const ATTR_KEY = /^[A-Za-z_][\w-]*/;
const WORD = /^[A-Za-z_][\w.:-]*/;
const NUMBER = /^\d+(?:\.\d+)?/;

function scanString(line: string, start: number): number {
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

export function highlightLine(line: string): HighlightToken[] {
  const firstText = line.search(/\S/);
  if (firstText >= 0 && (line.startsWith('#', firstText) || line.startsWith('%%', firstText))) {
    return line ? [{ text: line, kind: 'comment' }] : [];
  }

  const tokens: HighlightToken[] = [];
  const push = (text: string, kind: HighlightKind) => {
    if (text) tokens.push({ text, kind });
  };
  const previousKind = (): HighlightKind | null => {
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const kind = tokens[i].kind;
      if (kind !== 'plain' && kind !== 'punct') return kind;
    }
    return null;
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];

    if (ch === '"') {
      const end = scanString(line, i);
      push(line.slice(i, end), 'string');
      i = end;
      continue;
    }

    if (ch === '|') {
      const close = line.indexOf('|', i + 1);
      const end = close < 0 ? line.length : close + 1;
      push(line.slice(i, end), 'edgeLabel');
      i = end;
      continue;
    }

    const arrow = EDGE_OPERATORS.find((operator) => line.startsWith(operator, i));
    if (arrow) {
      push(arrow, 'arrow');
      i += arrow.length;
      continue;
    }

    if (ch === '#') {
      const hex = HEX.exec(line.slice(i));
      if (hex) {
        push(hex[0], 'color');
        i += hex[0].length;
        continue;
      }
    }

    if (ch === 'r' || ch === 'R') {
      const rgb = RGB.exec(line.slice(i));
      if (rgb) {
        push(rgb[0], 'color');
        i += rgb[0].length;
        continue;
      }
    }

    const number = NUMBER.exec(line.slice(i));
    if (number) {
      push(number[0], 'number');
      i += number[0].length;
      continue;
    }

    // A key ends at the colon, so `host:` is `attr` + `punct`, not one identifier.
    const key = ATTR_KEY.exec(line.slice(i));
    if (key) {
      let probe = i + key[0].length;
      while (probe < line.length && line[probe] === ' ') probe += 1;
      if (line[probe] === ':') {
        push(key[0], 'attr');
        i += key[0].length;
        continue;
      }
    }

    const word = WORD.exec(line.slice(i));
    if (word) {
      const text = word[0];
      // Every character has to be emitted: the highlighted copy is drawn under the
      // real textarea, so a swallowed space would shift the two apart.
      const lower = text.toLowerCase();
      if (DIRECTIVES.has(lower)) push(text, 'directive');
      else if (previousKind() === 'directive' && DIRECTIONS.has(text.toUpperCase())) push(text, 'keyword');
      else if (previousKind() === 'attr' && VALUES.has(lower)) push(text, 'keyword');
      else push(text, 'id');
      i += text.length;
      continue;
    }

    if ('[](){}>:=#'.includes(ch)) {
      push(ch, 'punct');
      i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      let end = i + 1;
      while (end < line.length && /\s/.test(line[end])) end += 1;
      push(line.slice(i, end), 'plain');
      i = end;
      continue;
    }

    push(ch, 'plain');
    i += 1;
  }

  return tokens;
}

/** One entry per line, so the renderer can rebuild the block without losing `\n`. */
export function highlightCode(text: string): HighlightToken[][] {
  return text.split('\n').map((line) => highlightLine(line));
}
