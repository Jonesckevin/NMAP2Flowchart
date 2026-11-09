import type { DiagramDoc } from '../doc/types';
import type { NmapScan } from '../model/types';
import {
  createDocFromScan,
  importScanAsLayer,
  mergeScanIntoDoc,
  scanEffects,
  type ImportEffect,
  type ImportMode,
} from '../doc/docFromScan';
import { parseNmapXml } from './parseNmapXml';

/**
 * The whole nmap import – parse, lay out, merge – with no DOM and no React, so it
 * can run in a worker (see import.worker.ts) or inline where a worker is not
 * available. Everything the caller needs to update the app comes back in one
 * structured-cloneable object.
 */

export type ImportRequest = {
  text: string;
  fileName: string;
  mode: ImportMode;
  /** The document the import lands in; `null` starts a new one. */
  doc: DiagramDoc | null;
};

export type ImportSuccess = {
  ok: true;
  fileName: string;
  mode: ImportMode;
  /** Parsed scan, kept for the preview dialog's statistics. */
  scan: NmapScan;
  /** Effect counts for every mode, so switching modes needs no second pass. */
  effects: Record<ImportMode, ImportEffect>;
  /** The document this import produces. */
  doc: DiagramDoc;
  added: number;
  gone: number;
  layerId: string | null;
};

export type ImportFailure = { ok: false; error: string };

export type ImportResponse = ImportSuccess | ImportFailure;

export function runImport({ text, fileName, mode, doc }: ImportRequest): ImportResponse {
  let scan: NmapScan;
  try {
    scan = parseNmapXml(text, fileName);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'That file could not be read.' };
  }

  try {
    const effects = scanEffects(doc, scan);

    if (!doc) {
      const next = createDocFromScan(scan);
      return { ok: true, fileName, mode: 'replace', scan, effects, doc: next, added: next.nodes.length, gone: 0, layerId: null };
    }

    if (mode === 'layer') {
      const { doc: next, layerId, added } = importScanAsLayer(doc, scan);
      return { ok: true, fileName, mode, scan, effects, doc: next, added, gone: 0, layerId };
    }

    if (mode === 'replace') {
      const next = createDocFromScan(scan);
      return { ok: true, fileName, mode, scan, effects, doc: next, added: next.nodes.length, gone: 0, layerId: null };
    }

    const { doc: next, added, gone } = mergeScanIntoDoc(doc, scan);
    return { ok: true, fileName, mode, scan, effects, doc: next, added, gone, layerId: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The scan could not be laid out.' };
  }
}
