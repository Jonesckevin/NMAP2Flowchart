/**
 * Colours in the code panel. The format stores `#rgb` / `#rrggbb`, but people paste
 * `rgb(…)` too, so both are recognised wherever a colour is written and the picker
 * always writes hex back – the document model stays one shape.
 */

export type ColorMatch = { start: number; end: number; value: string };

const HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const RGB_COLOR = /rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*(?:[,/]\s*(?:\d+(?:\.\d+)?|\.\d+)%?\s*)?\)/g;

/** Every colour written on one line, in source order. */
export function colorsInLine(line: string): ColorMatch[] {
  const out: ColorMatch[] = [];
  for (const pattern of [HEX_COLOR, RGB_COLOR]) {
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null = pattern.exec(line);
    while (found) {
      out.push({ start: found.index, end: found.index + found[0].length, value: found[0] });
      found = pattern.exec(line);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The colour under a caret, if the caret is inside (or just after) one. */
export function colorAtOffset(text: string, offset: number): ColorMatch | null {
  const bounded = Math.max(0, Math.min(text.length, offset));
  const lineStart = text.lastIndexOf('\n', Math.max(0, bounded - 1)) + 1;
  const lineEnd = text.indexOf('\n', bounded);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const local = bounded - lineStart;
  const found = colorsInLine(line).find((color) => local >= color.start && local <= color.end);
  return found ? { start: lineStart + found.start, end: lineStart + found.end, value: found.value } : null;
}

/** `#abc` → `#aabbcc`, `rgb(47, 214, 165)` → `#2fd6a5`. Null when it is not a colour. */
export function toHex(value: string): string | null {
  const trimmed = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const digits = hex[1].toLowerCase();
    return digits.length === 3
      ? `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`
      : `#${digits}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(trimmed);
  if (!rgb) return null;
  const channel = (raw: string) => Math.max(0, Math.min(255, Number(raw))).toString(16).padStart(2, '0');
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

export function replaceColor(text: string, match: ColorMatch, value: string): string {
  return text.slice(0, match.start) + value + text.slice(match.end);
}
