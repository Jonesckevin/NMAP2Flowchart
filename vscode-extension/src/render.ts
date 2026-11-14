import { applyLayerCode } from './core/app/code/codeToDoc';
import { parseCode } from './core/app/code/dsl';
import { emptyDoc } from './core/app/doc/docFromScan';
import { defaultRiskPolicy, normalizeDiagramRisk } from './core/app/doc/risk';
import { MAIN_LAYER } from './core/app/doc/types';
import { toSvg, type SvgTheme } from './core/app/export/svg';

/**
 * Code in, picture out. This is the whole preview pipeline and it is deliberately
 * free of `vscode`: the tests import it directly, and the extension host only has
 * to turn the answer into a webview.
 *
 * It reuses the web app's parser, layout and SVG writer, so the preview shows the
 * same diagram the app would export for the same text.
 */

export type RenderPicture = {
  ok: true;
  /** Nothing to draw yet – a new file, or only comments. */
  empty: boolean;
  svg: string;
  width: number;
  height: number;
  nodes: number;
  edges: number;
  sections: number;
  /** The layer name from a `layer:` directive, if the code set one. */
  layerName?: string;
};

export type RenderFailure = { ok: false; error: string; line: number };

export type RenderResult = RenderPicture | RenderFailure;

export function renderCode(text: string, theme: SvgTheme = 'light'): RenderResult {
  const parsed = parseCode(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, line: parsed.line };

  if (parsed.model.items.length === 0) {
    return { ok: true, empty: true, svg: '', width: 0, height: 0, nodes: 0, edges: 0, sections: 0 };
  }

  const result = applyLayerCode(emptyDoc(), MAIN_LAYER, text);
  if (!result.ok) return { ok: false, error: result.error, line: result.line };

  const policy = normalizeDiagramRisk(result.doc.risk) ?? defaultRiskPolicy();
  const picture = toSvg(result.doc, policy, theme);

  return {
    ok: true,
    empty: false,
    svg: picture.svg,
    width: picture.width,
    height: picture.height,
    nodes: result.doc.nodes.length,
    edges: result.doc.edges.length,
    sections: result.doc.nodes.filter((node) => node.kind === 'section').length,
    ...(parsed.model.layerName ? { layerName: parsed.model.layerName } : {}),
  };
}
