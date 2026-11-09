#!/usr/bin/env node
/**
 * Runs the pure-core test suite in `App/test` with Node's built-in runner.
 *
 * The app's modules use extensionless imports (a bundler convention), which Node's
 * own resolver does not follow, so each test file is bundled with esbuild first –
 * no new dependency, and no test-only change to the shipped source.
 *
 *   npm run test:doc                 # bundle + run every test
 *   npm run test:doc -- parse        # forward a name filter to `node --test`
 *   $env:N2F_GOLDEN='1'; npm run test:doc   # rewrite the exporter goldens
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');
// Inside node_modules so the bundles never reach git.
const OUT_DIR = path.join(ROOT, 'node_modules', '.tmp-doc-tests');

const extra = process.argv.slice(2);

async function main() {
  // A checkout without the suite is a repository mistake, not a test failure: say
  // so instead of failing on a bare ENOENT from readdir.
  if (!existsSync(TEST_DIR)) {
    throw new Error(
      `${path.relative(process.cwd(), TEST_DIR)} is missing – the pure-core suite ` +
        '(tests, fixtures and helpers) is not in this checkout. It is versioned: make sure ' +
        '`App/test` is committed and not ignored (`.gitignore`).',
    );
  }

  const entries = (await readdir(TEST_DIR))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(TEST_DIR, name));

  if (entries.length === 0) throw new Error(`No *.test.mjs files in ${TEST_DIR}`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  await esbuild.build({
    entryPoints: entries,
    outdir: OUT_DIR,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    logLevel: 'warning',
    sourcemap: 'inline',
    // Bundling the test keeps `import.meta.url` pointing at the bundle, so the
    // tests locate fixtures through N2F_APP_ROOT instead.
    define: { 'process.env.N2F_APP_ROOT': JSON.stringify(ROOT) },
  });

  const bundles = (await readdir(OUT_DIR))
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => path.join(OUT_DIR, name));

  const child = spawn(process.execPath, ['--test', ...extra, ...bundles], {
    stdio: 'inherit',
    env: { ...process.env, N2F_APP_ROOT: ROOT },
  });
  const code = await new Promise((resolve) => child.on('close', resolve));
  return code ?? 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
