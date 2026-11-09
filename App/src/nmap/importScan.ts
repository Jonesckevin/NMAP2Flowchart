import { runImport, type ImportRequest, type ImportResponse } from './runImport';

/**
 * Runs an import in a worker so the canvas keeps painting while a big scan is
 * parsed and laid out. Falls back to the same code inline when workers are not
 * available (an old browser, a test runner), which keeps one implementation.
 */

/** Above this the tab would visibly hitch on a slow machine, so say so first. */
export const LARGE_SCAN_BYTES = 4 * 1024 * 1024;

/**
 * A scan bigger than this is refused instead of read. The whole file becomes one
 * string, the text nodes are built from it and the diagram is laid out in memory;
 * past this size the tab runs out of room before the user sees a preview, and a
 * message is more useful than a frozen page.
 */
export const MAX_SCAN_BYTES = 64 * 1024 * 1024;

export type ImportOptions = { signal?: AbortSignal };

const cancelled = () => {
  const error = new Error('Import cancelled');
  error.name = 'AbortError';
  return error;
};

let counter = 0;

function inline(request: ImportRequest, signal?: AbortSignal): Promise<ImportResponse> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return Promise.resolve().then(() => runImport(request));
}

function inWorker(request: ImportRequest, signal?: AbortSignal): Promise<ImportResponse> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./import.worker.ts', import.meta.url), {
        type: 'module',
        name: 'nmap-import',
      });
    } catch (error) {
      reject(error);
      return;
    }

    const id = (counter += 1);
    const onAbort = () => {
      worker.terminate();
      reject(cancelled());
    };
    const settle = () => signal?.removeEventListener('abort', onAbort);
    const finish = (response: ImportResponse) => {
      settle();
      worker.terminate();
      resolve(response);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<{ id: number; response: ImportResponse }>) => {
      if (event.data?.id !== id) return;
      finish(event.data.response);
    };
    worker.onerror = (event) => {
      settle();
      worker.terminate();
      reject(new Error(event.message || 'The import worker stopped.'));
    };

    try {
      worker.postMessage({ id, request });
    } catch (error) {
      settle();
      worker.terminate();
      reject(error);
    }
  });
}

/**
 * `options.signal` stops the work: the worker is terminated, so a scan the user
 * changed their mind about costs nothing. Cancellation rejects with an
 * `AbortError`; every other worker failure still degrades to the inline path.
 */
export async function importScan(
  request: ImportRequest,
  options: ImportOptions = {},
): Promise<ImportResponse> {
  const { signal } = options;
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === 'undefined') return inline(request, signal);
  try {
    return await inWorker(request, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    // A blocked worker (CSP, an exotic browser) must not cost the user the import.
    return inline(request, signal);
  }
}
