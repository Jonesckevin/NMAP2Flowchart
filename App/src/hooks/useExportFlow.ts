import { useCallback, useMemo } from 'react';

import type { DiagramDoc } from '../doc/types';
import { isLayerVisible, layerMap } from '../doc/types';
import { DESIGN_EXTENSION, buildDesignFile } from '../doc/designFile';
import { RISK_SCOPE_LABEL, type RiskPolicy, type RiskScope, type RiskSummary } from '../doc/risk';
import { toDrawio } from '../export/drawio';
import { toMermaid } from '../export/mermaid';
import { rasterize, svgToPdf, toBlob } from '../export/raster';
import {
  riskReportRows,
  toRiskCsv,
  toRiskJson,
  type RiskReportMeta,
  type RiskReportScope,
} from '../export/riskReport';
import { toSvg } from '../export/svg';
import { EXPORT_DPI, baseName, download, downloadBlob } from '../export/download';

/**
 * Everything the Export menu and the risk-report dialog do.
 *
 * The picture formats follow the canvas scope (focused layer, hidden nodes) and
 * the design file never does – that distinction lives here, next to the code that
 * implements it, instead of inside the canvas component.
 */
export function useExportFlow({
  doc,
  riskPolicy,
  riskScope,
  query,
  notify,
}: {
  doc: DiagramDoc | null;
  riskPolicy: RiskPolicy;
  riskScope: RiskScope;
  query: string;
  notify: (message: string) => void;
}) {
  const focusName = doc?.focusedLayerId ? layerMap(doc.layers).get(doc.focusedLayerId)?.name : null;

  const exportScope = useMemo(() => {
    if (!doc) return '';
    const layers = layerMap(doc.layers);
    const hidden = doc.nodes.filter((node) => !isLayerVisible(layers, node.layerId, doc.focusedLayerId)).length;
    const parts: string[] = [];
    if (focusName) parts.push(`focused layer “${focusName}”`);
    if (hidden > 0) parts.push(`${hidden} node${hidden === 1 ? '' : 's'} hidden`);
    if (query.trim()) parts.push('canvas filter is not applied');
    return parts.length > 0 ? `Export scope: ${parts.join(' · ')}` : 'Export scope: whole diagram';
  }, [doc, focusName, query]);

  const exportMermaid = useCallback(() => {
    if (!doc) return;
    download(
      `${baseName(doc.fileName)}.mermaid.md`,
      `\`\`\`mermaid\n${toMermaid(doc, riskPolicy)}\`\`\`\n`,
      'text/markdown',
    );
    notify('Mermaid flowchart exported');
  }, [doc, notify, riskPolicy]);

  const exportDrawio = useCallback(() => {
    if (!doc) return;
    download(`${baseName(doc.fileName)}.drawio`, toDrawio(doc, riskPolicy), 'application/xml');
    notify('draw.io diagram exported');
  }, [doc, notify, riskPolicy]);

  const exportSvgFile = useCallback(() => {
    if (!doc) return;
    const { svg } = toSvg(doc, riskPolicy);
    download(`${baseName(doc.fileName)}.svg`, svg, 'image/svg+xml');
    notify('Vector SVG exported');
  }, [doc, notify, riskPolicy]);

  const exportPngFile = useCallback(async () => {
    if (!doc) return;
    try {
      const { svg, width, height } = toSvg(doc, riskPolicy);
      const raster = await rasterize(svg, width, height, EXPORT_DPI);
      downloadBlob(`${baseName(doc.fileName)}.png`, await toBlob(raster.canvas, 'image/png'));
      notify(`PNG exported · ${raster.width}×${raster.height} px (${Math.round(raster.scale * 96)} dpi)`);
    } catch (error) {
      notify(`PNG export failed: ${(error as Error).message}`);
    }
  }, [doc, notify, riskPolicy]);

  const exportPdfFile = useCallback(async () => {
    if (!doc) return;
    try {
      const { svg, width, height } = toSvg(doc, riskPolicy);
      const pdf = await svgToPdf(svg, width, height, EXPORT_DPI);
      downloadBlob(`${baseName(doc.fileName)}.pdf`, pdf);
      notify(`PDF exported · ${Math.round((width * 72) / 96)}×${Math.round((height * 72) / 96)} pt page`);
    } catch (error) {
      notify(`PDF export failed: ${(error as Error).message}`);
    }
  }, [doc, notify, riskPolicy]);

  /**
   * The design file is the whole document, never the canvas scope: opening it
   * elsewhere has to reproduce the diagram, not what is visible right now.
   */
  const exportDesign = useCallback(() => {
    if (!doc) return;
    const file = buildDesignFile(doc, { policy: riskPolicy, scope: riskScope });
    download(`${baseName(doc.fileName)}${DESIGN_EXTENSION}`, JSON.stringify(file, null, 2), 'application/json');
    notify(
      file.risk
        ? `Design exported · ${file.risk.policy.levels.length} risk levels from ${RISK_SCOPE_LABEL[riskScope]} included`
        : 'Design exported – reopen it here or in another instance',
    );
  }, [doc, notify, riskPolicy, riskScope]);

  const exportRiskReport = useCallback(
    (format: 'csv' | 'json', summary: RiskSummary, scope: RiskReportScope, scopeNote: string) => {
      if (!doc) return;
      const meta: RiskReportMeta = {
        diagram: doc.fileName,
        scope,
        scopeLabel: scopeNote,
        policyScope: RISK_SCOPE_LABEL[riskScope],
        generated: new Date().toISOString(),
      };
      const name = `${baseName(doc.fileName)}.risk-${scope === 'view' ? 'view' : 'diagram'}.${format}`;
      if (format === 'json') {
        download(name, toRiskJson(summary, meta), 'application/json');
      } else {
        download(name, toRiskCsv(summary, meta), 'text/csv');
      }
      const rows = riskReportRows(summary).length;
      notify(
        rows === 0
          ? 'Risk report exported with no flagged rows'
          : `Risk report exported · ${rows} flagged port${rows === 1 ? '' : 's'}`,
      );
    },
    [doc, notify, riskScope],
  );

  return {
    focusName,
    exportScope,
    exportDesign,
    exportRiskReport,
    exportMermaid,
    exportDrawio,
    exportSvgFile,
    exportPngFile,
    exportPdfFile,
  };
}
