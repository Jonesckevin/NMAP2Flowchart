import { useCallback, useMemo, useRef, useState } from 'react';

import type { DiagramDoc } from '../doc/types';
import type { NmapScan } from '../model/types';
import type { ImportEffect, ImportMode } from '../doc/docFromScan';
import type { DesignFile, DesignRepair } from '../doc/designFile';
import { looksLikeJson, readDesignFile } from '../doc/designFile';
import { LARGE_SCAN_BYTES, MAX_SCAN_BYTES, importScan } from '../nmap/importScan';
import type { ImportSuccess } from '../nmap/runImport';

/** What the import preview dialog needs to know about the file it is showing. */
export type ImportPreview = {
  fileName: string;
  scan: NmapScan;
  mode: ImportMode;
  /** Effect counts for every mode, computed once in the import worker. */
  effects: Record<ImportMode, ImportEffect>;
  /** The document built for `previewedMode`; reused when the mode is not changed. */
  doc: DiagramDoc;
  previewedMode: ImportMode;
  /** Kept so picking another mode re-runs the import in the worker. */
  text: string;
};

export type DesignPreviewRequest = {
  fileName: string;
  design: DesignFile;
  doc: DiagramDoc;
  repair: DesignRepair;
};

export type LayerBatch = {
  doc: DiagramDoc;
  layerId: string | null;
  added: number;
  ok: number;
  failed: number;
  designFile: boolean;
};

/**
 * Reading files is the one job that must not run on the canvas thread: a big
 * scan would freeze the drop, the dialog and every drag in flight. This hook owns
 * the file → worker → preview → apply path and the state the dialog renders.
 */
export function useImportFlow({
  doc,
  apply,
  applyLayerBatch,
  onDesign,
  notify,
}: {
  doc: DiagramDoc | null;
  /** Commits one imported document (the caller owns history and selection). */
  apply: (result: ImportSuccess) => void;
  /** Commits several scans that were added as layers in one go. */
  applyLayerBatch: (batch: LayerBatch) => void;
  /** A design file is opened through its own preview dialog. */
  onDesign: (preview: DesignPreviewRequest) => void;
  notify: (message: string) => void;
}) {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  /** The import in flight, so the dialog's Cancel can actually stop the worker. */
  const inFlight = useRef<AbortController | null>(null);

  const closePreview = useCallback(() => setPreview(null), []);

  const cancelImport = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setImporting(false);
  }, []);

  const chooseMode = useCallback((mode: ImportMode) => {
    setPreview((current) => (current ? { ...current, mode } : current));
  }, []);

  const tooLarge = useCallback(
    (file: File) => {
      if (file.size <= MAX_SCAN_BYTES) return false;
      notify(
        `“${file.name}” is ${Math.round(file.size / 1024 / 1024)} MB – the editor draws at most ` +
          `${MAX_SCAN_BYTES / 1024 / 1024} MB of scan in one tab. Split the target range and import it in parts.`,
      );
      return true;
    },
    [notify],
  );

  const importText = useCallback(
    async (text: string, fileName: string, mode: ImportMode = 'merge') => {
      if (looksLikeJson(text)) {
        const result = readDesignFile(text);
        if (!result.ok) {
          notify(result.reason);
          return false;
        }
        onDesign({ fileName, design: result.design, doc: result.doc, repair: result.repair });
        return true;
      }
      const result = await importScan({ text, fileName, mode, doc });
      if (!result.ok) {
        notify(result.error);
        return false;
      }
      apply(result);
      return true;
    },
    [apply, doc, notify, onDesign],
  );

  const importFiles = useCallback(
    async (files: FileList | File[], mode: ImportMode) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const controller = new AbortController();
      inFlight.current = controller;
      const { signal } = controller;
      const aborted = () => signal.aborted;
      setImporting(true);

      try {
        if (mode === 'layer' && doc) {
          let next = doc;
          let layerId: string | null = null;
          let added = 0;
          let failed = 0;
          let designFile = false;
          for (const file of list) {
            if (aborted()) break;
            if (tooLarge(file)) {
              failed += 1;
              continue;
            }
            try {
              const text = await file.text();
              designFile = looksLikeJson(text);
              if (designFile) break;
              const result = await importScan({ text, fileName: file.name, mode: 'layer', doc: next }, { signal });
              if (!result.ok) {
                failed += 1;
                continue;
              }
              next = result.doc;
              layerId = result.layerId;
              added += result.added;
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') return;
              failed += 1;
            }
          }
          applyLayerBatch({
            doc: next,
            layerId,
            added,
            ok: list.length - failed,
            failed,
            designFile,
          });
          return;
        }

        const file = list[0];
        if (tooLarge(file)) return;
        if (list.length > 1) {
          notify(`Importing ${file.name} only – choose “Add scan as new layer” for a batch`);
        }
        const text = await file.text();
        if (looksLikeJson(text)) {
          await importText(text, file.name, mode);
          return;
        }
        if (text.length > LARGE_SCAN_BYTES) {
          notify(`“${file.name}” is large – laying it out in the background…`);
        }
        const result = await importScan({ text, fileName: file.name, mode, doc }, { signal });
        if (aborted()) return;
        if (!result.ok) {
          notify(result.error);
          return;
        }
        setPreview({
          fileName: file.name,
          scan: result.scan,
          mode,
          effects: result.effects,
          doc: result.doc,
          previewedMode: mode,
          text,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        notify(`Could not read a file: ${(error as Error).message}`);
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
        setImporting(false);
      }
    },
    [applyLayerBatch, doc, importText, notify, tooLarge],
  );

  const confirmPreview = useCallback(() => {
    if (!preview) return;
    const current = preview;
    setPreview(null);

    if (current.mode === current.previewedMode) {
      // The worker already built this document for the mode that was previewed.
      apply({
        ok: true,
        fileName: current.fileName,
        mode: current.mode,
        scan: current.scan,
        effects: current.effects,
        doc: current.doc,
        added: current.effects[current.mode].added,
        gone: current.effects[current.mode].stale,
        layerId: null,
      });
      return;
    }

    void (async () => {
      const result = await importScan({
        text: current.text,
        fileName: current.fileName,
        mode: current.mode,
        doc,
      });
      if (!result.ok) notify(result.error);
      else apply(result);
    })();
  }, [apply, doc, notify, preview]);

  const previewEffect = useMemo(
    () => (preview ? preview.effects[preview.mode] : null),
    [preview],
  );

  return {
    importing,
    preview,
    previewEffect,
    importFiles,
    importText,
    chooseMode,
    closePreview,
    confirmPreview,
    cancelImport,
  };
}
