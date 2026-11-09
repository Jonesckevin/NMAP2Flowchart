/// <reference lib="webworker" />
import { runImport, type ImportRequest, type ImportResponse } from './runImport';

/**
 * Import worker: parsing and laying out a large nmap scan takes long enough to
 * drop frames and freeze the tab, so it happens here instead of on the main
 * thread. The worker is created per import (see importScan.ts) – there is no state
 * to keep between requests.
 */
self.onmessage = (event: MessageEvent<{ id: number; request: ImportRequest }>) => {
  const { id, request } = event.data;
  let response: ImportResponse;
  try {
    response = runImport(request);
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : 'The import failed.' };
  }
  postMessage({ id, response });
};
