import path from 'node:path';

/** Set by scripts/run-doc-tests.mjs: the App folder the bundles were built from. */
export const APP_ROOT = process.env.N2F_APP_ROOT ?? process.cwd();

export const fixture = (...parts) => path.join(APP_ROOT, 'test', 'fixtures', ...parts);

/** `$env:N2F_GOLDEN='1'` rewrites the exporter snapshots instead of comparing. */
export const updateGoldens = process.env.N2F_GOLDEN === '1';
