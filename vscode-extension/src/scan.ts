import { docToCode } from './core/app/code/docToCode';
import { createDocFromScan } from './core/app/doc/docFromScan';
import { MAIN_LAYER } from './core/app/doc/types';
import { parseNmapXml } from './core/app/nmap/parseNmapXml';
import { openPorts, type NmapScan } from './core/app/model/types';

/**
 * Nmap `-oX` output in, diagram code out. Like `render.ts` this has no `vscode`
 * import: the tests feed it XML directly, and the host only has to write the text
 * into an editor.
 *
 * The parser and the scan → document conversion are the web app's own, so an
 * imported scan becomes the same `.n2f` text the app's code panel would show.
 */

export type ScanCode = {
  ok: true;
  /** The layer in the format `dsl.ts` reads back. */
  code: string;
  hosts: number;
  openPorts: number;
};

export type ScanFailure = { ok: false; error: string };

export type ScanImport = ScanCode | ScanFailure;

/** The ceiling the web app applies before it reads a scan (`nmap/importScan.ts`). */
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;

export function scanToCode(xml: string, fileName: string): ScanImport {
  let scan: NmapScan;
  try {
    scan = parseNmapXml(xml, fileName);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const doc = createDocFromScan(scan);
  const hosts = doc.nodes.filter((node) => node.host).length;
  const ports = scan.hosts.reduce((total, host) => total + openPorts(host).length, 0);

  return { ok: true, code: docToCode(doc, MAIN_LAYER), hosts, openPorts: ports };
}
