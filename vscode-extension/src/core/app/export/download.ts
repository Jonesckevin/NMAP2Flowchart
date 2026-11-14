/** 300 dpi keeps a plotter-sized diagram sharp without a multi-megabyte PNG. */
export const EXPORT_DPI = 300;

/** `<scan>.xml` → `<scan>`, so every export sits beside its scan by the same name. */
export function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '') || 'nmap-diagram';
}

export function download(name: string, content: string, mime: string) {
  downloadBlob(name, new Blob([content], { type: `${mime};charset=utf-8` }));
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
