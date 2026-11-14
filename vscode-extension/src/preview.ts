import { escapeXml } from './core/app/export/text';
import type { SvgTheme } from './core/app/export/svg';
import type { RenderPicture, RenderResult } from './render';

/**
 * The preview page. It is one self-contained HTML document – inline SVG, inline
 * style, no script – so the webview needs no resource roots and nothing from the
 * extension host can be reached from it.
 *
 * The chrome and the picture share one theme, which is why the page carries
 * `data-theme` rather than borrowing the editor's colours: a dark diagram under a
 * forced-light preview has to sit on a light page, and vice versa.
 */

export type PreviewOptions = {
  cspSource: string;
  fileName: string;
  /** The palette the picture was drawn with; the rest of the page follows it. */
  theme: SvgTheme;
  /** The last diagram that parsed, so a typo dims the picture instead of blanking it. */
  lastGood?: RenderPicture;
};

const STYLE = `
  :root {
    --pv-bg: #ffffff;
    --pv-fg: #1f2328;
    --pv-dim: #5b6675;
    --pv-border: #e2e6ec;
    --pv-sheet: #ffffff;
    --pv-code: #f2f4f7;
    --pv-error: #c32222;
    --pv-shadow: rgba(15, 23, 42, .18);
    color-scheme: light;
  }
  :root[data-theme='dark'] {
    --pv-bg: #1e1e1e;
    --pv-fg: #d4d4d4;
    --pv-dim: #9aa4b2;
    --pv-border: #2b3440;
    --pv-sheet: #0b1118;
    --pv-code: #262626;
    --pv-error: #f48771;
    --pv-shadow: rgba(0, 0, 0, .55);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--pv-fg);
    background: var(--pv-bg);
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--pv-border);
    background: var(--pv-bg);
    font-size: 12px;
  }
  .bar .name { font-weight: 600; }
  .bar .meta { color: var(--pv-dim); margin-left: auto; white-space: nowrap; }
  .bar .theme { color: var(--pv-dim); white-space: nowrap; cursor: default; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
  .dot.ok { background: #2fd6a5; }
  .dot.bad { background: var(--pv-error); }
  .dot.empty { background: var(--pv-dim); opacity: .5; }
  .stage { padding: 18px; }
  .sheet {
    display: inline-block;
    max-width: 100%;
    padding: 6px;
    border-radius: 8px;
    background: var(--pv-sheet);
    box-shadow: 0 6px 24px var(--pv-shadow);
  }
  .sheet svg { display: block; max-width: 100%; height: auto; }
  .sheet.is-stale { opacity: .45; }
  .notice {
    margin: 0 0 16px;
    padding: 10px 12px;
    border-left: 3px solid var(--pv-error);
    border-radius: 4px;
    background: color-mix(in srgb, var(--pv-fg) 8%, transparent);
    font-size: 12.5px;
    line-height: 1.5;
    max-width: 72ch;
  }
  .notice b { color: var(--pv-error); }
  .notice code {
    font-family: var(--vscode-editor-font-family);
    background: var(--pv-code);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .hint { color: var(--pv-dim); }
  .empty {
    padding: 24px;
    max-width: 60ch;
    color: var(--pv-dim);
    line-height: 1.6;
  }
  .empty code {
    font-family: var(--vscode-editor-font-family);
    background: var(--pv-code);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--pv-fg);
  }
`;

function summary(picture: RenderPicture): string {
  const bits = [`${picture.nodes} node${picture.nodes === 1 ? '' : 's'}`];
  bits.push(`${picture.edges} connection${picture.edges === 1 ? '' : 's'}`);
  if (picture.sections > 0) bits.push(`${picture.sections} section${picture.sections === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function sheet(picture: RenderPicture, stale: boolean): string {
  return `<div class="sheet${stale ? ' is-stale' : ''}">${picture.svg}</div>`;
}

export function previewHtml(result: RenderResult, options: PreviewOptions): string {
  const name = escapeXml(options.fileName);

  let state = 'empty';
  let meta = 'nothing to draw';
  let body = `<div class="empty">Nothing to draw yet. Add a line such as
      <code>web["Web server"] host: "10.0.0.10" ports: "80/http"</code>
      and the diagram appears here.</div>`;

  if (!result.ok) {
    state = 'bad';
    meta = 'not a valid diagram';
    const where = result.line > 0 ? `<b>Line ${result.line}</b> · ` : '';
    const last = options.lastGood
      ? `<p class="hint">Showing the last diagram that parsed.</p>${sheet(options.lastGood, true)}`
      : '';
    body = `<div class="notice">${where}${escapeXml(result.error)}</div>${last}`;
  } else if (!result.empty) {
    state = 'ok';
    meta = summary(result);
    body = sheet(result, false);
  }

  return `<!DOCTYPE html>
<html lang="en" data-theme="${options.theme}">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'unsafe-inline'; img-src ${options.cspSource} data:;" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name || 'Flowchart'}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="bar"><span class="dot ${state}"></span><span class="name">${name || 'Flowchart'}</span><span class="theme" title="Preview theme: ${options.theme} · NMAP2Flowchart: Toggle Dark Preview">${
    options.theme === 'dark' ? '&#9789; dark' : '&#9788; light'
  }</span><span class="meta">${meta}</span></div>
<div class="stage">${body}</div>
</body>
</html>`;
}
