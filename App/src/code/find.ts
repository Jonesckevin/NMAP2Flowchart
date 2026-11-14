/**
 * Find and replace over the code panel's text. Kept out of the component so the
 * tricky parts – empty matches, literal `$`, backreferences – are testable without
 * a browser.
 */

export type FindOptions = { caseSensitive: boolean; regex: boolean };
export type FindMatch = { start: number; end: number };

/** A run-away pattern should not lock the panel; the UI says when the cap hit. */
const MAX_MATCHES = 2000;

const escapeLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildPattern(query: string, options: FindOptions): RegExp | null {
  if (!query) return null;
  try {
    return new RegExp(options.regex ? query : escapeLiteral(query), options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function findMatches(text: string, query: string, options: FindOptions): FindMatch[] {
  const pattern = buildPattern(query, options);
  if (!pattern) return [];
  const out: FindMatch[] = [];
  let found: RegExpExecArray | null = pattern.exec(text);
  while (found && out.length < MAX_MATCHES) {
    if (found[0].length === 0) {
      // A pattern such as `^` matches without consuming anything; step past it.
      pattern.lastIndex += 1;
    } else {
      out.push({ start: found.index, end: found.index + found[0].length });
    }
    found = pattern.exec(text);
  }
  return out;
}

/** `$1`, `$&` and `$$` – only when the user asked for a regular expression. */
function expand(template: string, match: RegExpExecArray, regex: boolean): string {
  if (!regex) return template;
  return template.replace(/\$(\$|&|\d{1,2})/g, (whole, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return match[0];
    return match[Number(token)] ?? whole;
  });
}

export function replaceMatch(
  text: string,
  match: FindMatch,
  query: string,
  options: FindOptions,
  replacement: string,
): string {
  const pattern = buildPattern(query, options);
  let value = replacement;
  if (pattern) {
    const anchored = new RegExp(pattern.source, `${options.caseSensitive ? '' : 'i'}y`);
    anchored.lastIndex = match.start;
    const found = anchored.exec(text);
    if (found && found.index === match.start) value = expand(replacement, found, options.regex);
  }
  return text.slice(0, match.start) + value + text.slice(match.end);
}

export function replaceAllMatches(
  text: string,
  query: string,
  options: FindOptions,
  replacement: string,
): { text: string; count: number } {
  const pattern = buildPattern(query, options);
  if (!pattern) return { text, count: 0 };
  let out = '';
  let cursor = 0;
  let count = 0;
  let found: RegExpExecArray | null = pattern.exec(text);
  while (found && count < MAX_MATCHES) {
    if (found[0].length === 0) {
      pattern.lastIndex += 1;
    } else {
      out += text.slice(cursor, found.index);
      out += expand(replacement, found, options.regex);
      cursor = found.index + found[0].length;
      count += 1;
    }
    found = pattern.exec(text);
  }
  return { text: out + text.slice(cursor), count };
}

/** The first match at or after `cursor`, wrapping – what Find Next should pick. */
export function nextMatchIndex(matches: FindMatch[], cursor: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.start >= cursor);
  return index < 0 ? 0 : index;
}
