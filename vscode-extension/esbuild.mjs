#!/usr/bin/env node
/**
 * Bundle the extension. `vscode` is the only thing left external – it exists in
 * the extension host and nowhere else. React comes along because the icon table
 * that the SVG writer reads is defined next to the JSX glyphs; the bundle is small
 * enough that one file beats a second copy of the renderer.
 *
 *   node esbuild.mjs            one build
 *   node esbuild.mjs --watch    rebuild on change
 */
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(HERE, 'src', 'extension.ts')],
  outfile: path.join(HERE, 'out', 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: false,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching src/ …');
} else {
  await build(options);
}
