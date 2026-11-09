import type { ReactNode } from 'react';

/**
 * The little marks in front of every file choice.
 *
 * Most of them are drawn to the app's own stroke style – the shape says "XML",
 * "vector", "page" at a glance and the tint tells them apart. The Mermaid and
 * draw.io entries are the projects' own marks instead, used only to say which
 * format a row writes:
 *
 * - Mermaid: mermaid-js/mermaid, MIT (docs/public/mermaid-logo.svg).
 * - draw.io: JGraph Ltd, jgraph/drawio, Apache-2.0
 *   (src/main/webapp/images/drawlogo.svg). "draw.io" is a trademark of JGraph Ltd.
 *
 * Both are recoloured with `currentColor` and keep their own coordinate system.
 */
export type FileGlyphName =
  | 'xml'
  | 'json'
  | 'mermaid'
  | 'drawio'
  | 'svg'
  | 'png'
  | 'pdf'
  | 'csv'
  | 'layers'
  | 'blank'
  | 'sample';

const TONES: Record<FileGlyphName, string> = {
  xml: '#f0a25c',
  json: '#c084fc',
  mermaid: '#ff3670',
  drawio: '#f59e0b',
  svg: '#2fd6a5',
  png: '#4b9fff',
  pdf: '#ff6b5b',
  csv: '#34d399',
  layers: '#4b9fff',
  blank: '#91a1b6',
  sample: '#2fd6a5',
};

const GLYPHS: Record<FileGlyphName, ReactNode> = {
  // </> for a scan file
  xml: <path d="M9 7 4 12l5 5M15 7l5 5-5 5M13.4 5 10.6 19" />,
  // { } for a document
  json: (
    <path d="M9.5 4C7.6 4 7 5.4 7 7.2v1.4c0 1.2-.8 2-2 2v2.8c1.2 0 2 .8 2 2v1.4c0 1.8.6 3.2 2.5 3.2M14.5 4c1.9 0 2.5 1.4 2.5 3.2v1.4c0 1.2.8 2 2 2v2.8c-1.2 0-2 .8-2 2v1.4c0 1.8-.6 3.2-2.5 3.2" />
  ),
  // The official Mermaid mark (a filled shape, not a stroke).
  mermaid: (
    <path
      d="M407.48,111.18C335.587,108.103 269.573,152.338 245.08,220C220.587,152.338 154.573,108.103 82.68,111.18C80.285,168.229 107.577,222.632 154.74,254.82C178.908,271.419 193.35,298.951 193.27,328.27L193.27,379.13L296.9,379.13L296.9,328.27C296.816,298.953 311.255,271.42 335.42,254.82C382.596,222.644 409.892,168.233 407.48,111.18Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // The official draw.io mark: a rounded frame around the three-node graph.
  drawio: (
    <>
      <path
        d="M237.5,227.9c0,5.3-4.3,9.6-9.5,9.6c0,0,0,0,0,0H22.1c-5.3,0-9.6-4.3-9.6-9.5c0,0,0,0,0,0V22.1c0-5.3,4.3-9.6,9.5-9.6c0,0,0,0,0,0h205.9c5.3,0,9.6,4.3,9.6,9.5c0,0,0,0,0,0V227.9z"
        strokeWidth="13"
      />
      <path
        d="M197.1,138.3h-23.7l-25-42.7c5.7-1.2,9.8-6.2,9.7-12V51.5c0-6.8-5.4-12.3-12.2-12.3c0,0-0.1,0-0.1,0h-41.7c-6.8,0-12.3,5.4-12.3,12.2c0,0,0,0.1,0,0.1v32.1c0,5.8,4,10.8,9.7,12l-25,42.7H52.9c-6.8,0-12.3,5.4-12.3,12.2c0,0,0,0.1,0,0.1v32.1c0,6.8,5.4,12.3,12.2,12.3c0,0,0.1,0,0.1,0h41.7c6.8,0,12.3-5.4,12.3-12.2c0,0,0-0.1,0-0.1v-32.1c0-6.8-5.4-12.3-12.2-12.3c0,0-0.1,0-0.1,0h-4l24.8-42.4h19.3l24.9,42.4h-4.1c-6.8,0-12.3,5.4-12.3,12.2c0,0,0,0.1,0,0.1v32.1c0,6.8,5.4,12.3,12.2,12.3c0,0,0.1,0,0.1,0h41.7c6.8,0,12.3-5.4,12.3-12.2c0,0,0-0.1,0-0.1v-32.1c0-6.8-5.4-12.3-12.2-12.3C197.2,138.3,197.2,138.3,197.1,138.3z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  // A bezier with its handles: vector art
  svg: (
    <>
      <path d="M5.5 17.5C8 8.5 16 8.5 18.5 17.5" />
      <circle cx="4.6" cy="18.4" r="1.9" />
      <circle cx="19.4" cy="18.4" r="1.9" />
    </>
  ),
  // A framed picture with a horizon
  png: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.2" />
      <circle cx="8.4" cy="9.8" r="1.5" />
      <path d="M4 17.2 8.8 12l3.4 4 2.9-3 4.9 4.2" />
    </>
  ),
  // A page with a folded corner
  pdf: (
    <>
      <path d="M6 3h7.6L18 7.4V21H6z" />
      <path d="M13.6 3v4.4H18" />
      <path d="M9 13h6M9 16.4h6" />
    </>
  ),
  // A grid of cells
  csv: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="M3 9.5h18M9.5 9.5v10M15 9.5v10" />
    </>
  ),
  // Stacked sheets: a new layer
  layers: (
    <>
      <path d="m12 3.5 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16.4 8 4 8-4" />
    </>
  ),
  // A plus in a frame: an empty canvas
  blank: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  // A flask: the bundled sample
  sample: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v4.6L5.6 17a2 2 0 0 0 1.8 3h9.2a2 2 0 0 0 1.8-3L13.5 8.1V3.5" />
      <path d="M8 13.6h8" />
    </>
  ),
};

/** The brand marks keep their own canvas instead of the 24-unit one. */
const VIEW_BOX: Partial<Record<FileGlyphName, string>> = {
  mermaid: '70 99 350 292',
  drawio: '0 0 250 250',
};

export function FileGlyph({ name, tone }: { name: FileGlyphName; tone?: string }) {
  const color = tone ?? TONES[name];
  return (
    <span
      className="file-glyph"
      aria-hidden="true"
      style={{ color, background: `${color}1f`, borderColor: `${color}4d` }}
    >
      <svg
        viewBox={VIEW_BOX[name] ?? '0 0 24 24'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[name]}
      </svg>
    </span>
  );
}
