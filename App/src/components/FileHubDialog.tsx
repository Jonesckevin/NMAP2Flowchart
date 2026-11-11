import { useEffect, useRef } from 'react';

import type { ImportEffect, ImportMode } from '../doc/docFromScan';
import type { ImportPreview } from '../hooks/useImportFlow';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { FileGlyph, type FileGlyphName } from './FileGlyph';
import { ImportPreviewBody } from './ImportPreview';

export type FileHubTab = 'import' | 'export';

export type ExportFormat = 'design' | 'mermaid' | 'drawio' | 'svg' | 'png' | 'pdf';

const FORMATS: { id: ExportFormat; glyph: FileGlyphName; label: string; hint: string }[] = [
  {
    id: 'design',
    glyph: 'json',
    label: 'Design file (.json)',
    hint: 'The whole diagram – layers, positions, notes, connections and its risk levels. Reopen it here or in another instance.',
  },
  {
    id: 'mermaid',
    glyph: 'mermaid',
    label: 'Mermaid diagram',
    hint: 'A text flowchart to paste into a wiki, README or ticket.',
  },
  {
    id: 'drawio',
    glyph: 'drawio',
    label: 'draw.io diagram',
    hint: 'An editable .drawio file for diagrams.net, Nextcloud or the draw.io plugin.',
  },
  {
    id: 'svg',
    glyph: 'svg',
    label: 'SVG · vector print',
    hint: 'Sharp at any size – the safest choice for a plotter or a large poster.',
  },
  {
    id: 'png',
    glyph: 'png',
    label: 'PNG · 300 dpi',
    hint: 'A flat picture for a slide, a ticket or a chat message.',
  },
  {
    id: 'pdf',
    glyph: 'pdf',
    label: 'PDF · plotter page',
    hint: 'A page sized to the diagram, ready to print or hand over.',
  },
];

/**
 * The one place for files: import, open and export.
 *
 * The same dialog serves a first visit (no diagram yet, so it opens on Import)
 * and an established diagram (it opens on Export). Everything that used to live in
 * two header menus is here, with room to explain what each choice does. The risk
 * report stays in the Risk panel: its filter belongs there.
 */
export function FileHubDialog({
  open,
  tab,
  onTabChange,
  hasDiagram,
  canImport,
  preview,
  effect,
  importing,
  exportScope,
  onClose,
  onCancelReview,
  onChooseScan,
  onChooseLayers,
  onChooseDesign,
  onChooseDrawio,
  onBlank,
  onSample,
  onChooseMode,
  onConfirm,
  onExport,
  onCancelImport,
}: {
  open: boolean;
  tab: FileHubTab;
  onTabChange: (tab: FileHubTab) => void;
  hasDiagram: boolean;
  canImport: boolean;
  preview: ImportPreview | null;
  effect: ImportEffect | null;
  importing: boolean;
  exportScope: string;
  onClose: () => void;
  onCancelReview: () => void;
  onChooseScan: () => void;
  onChooseLayers: () => void;
  onChooseDesign: () => void;
  onChooseDrawio: () => void;
  onBlank: () => void;
  onSample: () => void;
  onChooseMode: (mode: ImportMode) => void;
  onConfirm: () => void;
  onExport: (format: ExportFormat) => void;
  /** Stops the import worker when the scan turns out to be the wrong file. */
  onCancelImport: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const review = preview !== null;

  useDialogFocus(sectionRef, open);

  useEffect(() => {
    if (!open) return;
    // Land on the recommended choice rather than on the close button.
    const timer = window.setTimeout(() => {
      if (tab === 'export' || review) closeRef.current?.focus();
      else primaryRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open, tab, review]);

  if (!open) return null;

  const title = review
    ? preview.fileName
    : tab === 'export'
      ? hasDiagram
        ? 'Export this diagram'
        : 'Nothing to export yet'
      : hasDiagram
        ? 'Bring in a scan or a saved design'
        : 'Where does this diagram come from?';

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={sectionRef}
        className="dialog import-guide file-hub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-hub-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="eyebrow">{review ? 'Import preview' : 'Import / Export'}</span>
            <h2 id="file-hub-title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Close the import and export panel"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {canImport && !review && (
          <div className="file-hub__tabs" role="tablist" aria-label="Import or export">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'import'}
              className={`file-hub__tab${tab === 'import' ? ' is-on' : ''}`}
              onClick={() => onTabChange('import')}
            >
              Import / Open
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'export'}
              className={`file-hub__tab${tab === 'export' ? ' is-on' : ''}`}
              onClick={() => onTabChange('export')}
            >
              Export
            </button>
          </div>
        )}

        {tab === 'export' && !review ? (
          hasDiagram ? (
            <>
              <p className="file-hub__scope">{exportScope}</p>

              <div className="file-hub__formats">
                {FORMATS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    className={`file-format${format.id === 'design' ? ' file-format--primary' : ''}`}
                    onClick={() => onExport(format.id)}
                  >
                    <FileGlyph name={format.glyph} />
                    <span className="file-format__body">
                      <strong>{format.label}</strong>
                      <span>{format.hint}</span>
                    </span>
                  </button>
                ))}
              </div>

              <p className="file-hub__footnote">
                The design file always carries the whole document.
              </p>
            </>
          ) : (
            <p className="file-hub__empty">
              Import a scan first – there is nothing on the canvas to export yet.
            </p>
          )
        ) : review ? (
          <ImportPreviewBody
            preview={preview}
            effect={effect}
            hasDiagram={hasDiagram}
            onChooseMode={onChooseMode}
            onCancel={onCancelReview}
            onConfirm={() => {
              onConfirm();
              onClose();
            }}
          />
        ) : (
          <>
            <ol className="import-guide__steps" aria-label="What happens next">
              <li className="is-on">
                <b>1</b> Choose a source
              </li>
              <li>
                <b>2</b> Review the scan
              </li>
              <li>
                <b>3</b> Arrange and export
              </li>
            </ol>

            <div className="import-guide__options">
              <button
                type="button"
                ref={primaryRef}
                className="import-option import-option--primary"
                onClick={onChooseScan}
                disabled={importing}
              >
                <FileGlyph name="xml" />
                <span className="import-option__body">
                  <strong>{importing ? 'Reading the scan…' : 'nmap scan (XML)'}</strong>
                  <span>
                    A file written by <code>nmap -oX</code> – a ping sweep, a port scan or a full
                    audit. Hosts, subnets and ports become the diagram.
                  </span>
                </span>
                <span className="import-option__tag">Recommended</span>
              </button>

              {hasDiagram && (
                <button type="button" className="import-option" onClick={onChooseLayers} disabled={importing}>
                  <FileGlyph name="layers" />
                  <span className="import-option__body">
                    <strong>Add scans as new layers (XML)</strong>
                    <span>Keep the open diagram and put one or more scans beside it, each on its own layer.</span>
                  </span>
                </button>
              )}

              <button type="button" className="import-option" onClick={onChooseDesign} disabled={importing}>
                <FileGlyph name="json" />
                <span className="import-option__body">
                  <strong>Design file (.json)</strong>
                  <span>
                    Reopen a diagram exported from NMAP2Flowchart, with its layers, notes, icons and
                    risk levels.
                  </span>
                </span>
              </button>

              <button type="button" className="import-option" onClick={onChooseDrawio} disabled={importing}>
                <FileGlyph name="drawio" />
                <span className="import-option__body">
                  <strong>draw.io diagram (.drawio)</strong>
                  <span>
                    A drawing from diagrams.net – or one exported from here. A shape with an address in
                    its label becomes a host card, a frame around other shapes a section, a line a
                    connection.
                  </span>
                </span>
              </button>

              <button type="button" className="import-option" onClick={onBlank} disabled={importing}>
                <FileGlyph name="blank" />
                <span className="import-option__body">
                  <strong>{hasDiagram ? 'Start a blank diagram' : 'Blank diagram'}</strong>
                  <span>
                    {hasDiagram
                      ? 'Replace the canvas with an empty one – undo brings the current diagram back.'
                      : 'Start from an empty canvas and add hosts, sections and notes by hand.'}
                  </span>
                </span>
              </button>
            </div>

            <p className="import-guide__footnote">
              No scan at hand?{' '}
              <button type="button" className="link-button" onClick={onSample}>
                Open the bundled sample scan
              </button>
              . Everything is read-only – no scan data leaves your machine.
            </p>

            {importing && (
              <div className="import-guide__working" role="status">
                <span className="import-guide__spinner" aria-hidden="true" />
                <span>Reading and laying out the scan…</span>
                <button type="button" className="btn btn--tiny" onClick={onCancelImport}>
                  Cancel import
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
