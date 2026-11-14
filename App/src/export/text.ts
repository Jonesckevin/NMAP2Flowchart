/**
 * Text hygiene for every exporter.
 *
 * A label is user input: it can come from a scan's NSE output, a pasted note or an
 * imported design file. Two things break once it leaves the canvas – control
 * characters, which make an XML parser reject the whole file, and characters a
 * spreadsheet or a Mermaid parser reads as syntax instead of text.
 */

/** C0/C1 control characters, minus tab, newline and carriage return. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const stripControl = (value: string) => value.replace(CONTROL, '');

/** XML text or attribute value. */
export const escapeXml = (value: string) =>
  stripControl(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Inside a Mermaid label. `#` starts an entity and `|` closes the `|label|` form of
 * an edge label, so both are written as character codes; quotes are swapped because
 * every label is emitted inside `["…"]`.
 */
export const escapeMermaid = (value: string) =>
  stripControl(value)
    .replace(/#/g, '#35;')
    .replace(/\|/g, '#124;')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A value inside a `"…"` in the code panel's own DSL. That reader understands
 * exactly two escapes, so a backslash, a quote and a newline are the whole job;
 * everything else may appear literally.
 */
export const escapeDslString = (value: string) =>
  stripControl(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?|\n/g, '\\n')
    .replace(/\t/g, '\\t');

/** Text meant for a spreadsheet: quoted when needed, never evaluated as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
export function csvCell(value: string | number) {
  let text = String(value ?? '');
  // Excel and Sheets run a cell that starts with =, +, - or @. A scan can put any
  // of those in a hostname, service banner or note, so the cell is marked as text.
  if (typeof value !== 'number' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
