#!/usr/bin/env node
/**
 * The extension renders the same diagram the web app does, so it compiles the
 * same pure core: the parser, layout, layer replacement, scene, SVG writer and the
 * nmap XML reader. Copying keeps the two from drifting (a change in App/src is a
 * change here after `npm run sync`), and `--check` fails the build when the copy is
 * stale.
 *
 *   node scripts/sync-core.mjs            rewrite src/core/app
 *   node scripts/sync-core.mjs --check    exit 1 when it has drifted
 */
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(HERE, '..');
const APP_SRC = path.resolve(EXT_ROOT, '..', 'App', 'src');
const TARGET = path.join(EXT_ROOT, 'src', 'core', 'app');

/** Only what the renderer reaches; the React editor is not part of the preview. */
const FOLDERS = ['code', 'doc', 'export', 'graph', 'icons', 'model', 'nmap'];

/**
 * `nmap` also holds the worker pipeline (`import.worker.ts`, `importScan.ts`), which
 * is a browser concern; the extension only needs the parser.
 */
const ONLY = { nmap: ['parseNmapXml.ts'] };

async function listFiles(root, dir = '') {
  const out = [];
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)));
    else if (/\.(ts|tsx)$/.test(entry.name) && !rel.includes(`${path.sep}data${path.sep}`)) out.push(rel);
  }
  return out;
}

const wanted = (folder, file) => !ONLY[folder] || ONLY[folder].includes(path.basename(file));

async function copyTree() {
  await rm(path.join(EXT_ROOT, 'src', 'core'), { recursive: true, force: true });
  for (const folder of FOLDERS) {
    for (const file of await listFiles(path.join(APP_SRC, folder))) {
      if (!wanted(folder, file)) continue;
      const target = path.join(TARGET, folder, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(APP_SRC, folder, file), target);
    }
  }
  await mkdir(TARGET, { recursive: true });
}

async function checkTree() {
  const drift = [];
  for (const folder of FOLDERS) {
    const files = await listFiles(path.join(APP_SRC, folder));
    for (const file of files) {
      if (!wanted(folder, file)) continue;
      const expected = await readFile(path.join(APP_SRC, folder, file), 'utf8');
      const copyPath = path.join(TARGET, folder, file);
      const actual = await readFile(copyPath, 'utf8').catch(() => null);
      if (actual !== expected) drift.push(path.join(folder, file));
    }
  }
  return drift;
}

const check = process.argv.includes('--check');
if (check) {
  const drift = await checkTree();
  if (drift.length > 0) {
    console.error(`src/core is out of date (${drift.length} file${drift.length === 1 ? '' : 's'}):`);
    for (const file of drift.slice(0, 12)) console.error(`  ${file}`);
    console.error('Run `npm run sync` in vscode-extension/.');
    process.exit(1);
  }
  console.log('src/core matches App/src');
} else {
  await copyTree();
  const count = (await listFiles(TARGET)).length;
  console.log(`synced ${count} core file(s) from App/src`);
}
