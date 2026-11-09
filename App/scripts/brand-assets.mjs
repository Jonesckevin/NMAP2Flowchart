#!/usr/bin/env node
/**
 * Regenerates the raster brand assets from the SVG mark, so changing the accent
 * colour means re-running this rather than hand-editing PNGs.
 *
 *   npm run brand:assets     writes n2f/public/og-image.png and apple-touch-icon.png
 *
 * The card mirrors the app: the same dark backdrop, the same logo (which paints
 * with `currentColor`, so it carries the orange accent) and the formats the editor
 * exports. Run it after changing `--accent` or the favicon.
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(APP_ROOT, '..', 'n2f', 'public');

const ACCENT = '#2fd6a5';

const card = (size, icon) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: ${size.w}px; height: ${size.h}px; overflow: hidden;
    background: radial-gradient(circle at 78% 8%, #1b2531 0%, #080b10 58%);
    color: #dbe3ec; font-family: 'Segoe UI', system-ui, sans-serif; }
  .wrap { padding: ${size.pad}px; height: 100%; box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: center; align-items: ${size.align}; gap: ${size.gap}px; }
  .logo svg { width: ${size.icon}px; height: ${size.icon}px; display: block; }
  h1 { margin: 0; font-size: ${size.title}px; letter-spacing: -0.02em; line-height: 1.05; color: #f4f8fc; }
  p { margin: 0; font-size: ${size.body}px; line-height: 1.45; color: #a9b9c9; max-width: ${size.text}px; }
  .chips { display: flex; gap: 12px; margin-top: 26px; flex-wrap: wrap; }
  .chip { padding: 8px 16px; border: 1px solid #2a3646; border-radius: 999px; font-size: ${size.chip}px;
    color: #d7a262; background: #171d26; }
  .accent { color: ${ACCENT}; }
</style></head><body><div class="wrap">
  <div class="logo">${icon}</div>
  ${size.title ? '<h1>NMAP2Flowchart</h1>' : ''}
  ${size.body ? '<p>Drop in <span class="accent">nmap -oX</span> XML and get an editable diagram of subnets, hosts, open ports and hops. Export to draw.io, Mermaid, SVG, PNG or PDF – all in your browser.</p>' : ''}
  ${size.body ? '<div class="chips"><span class="chip">draw.io</span><span class="chip">Mermaid</span><span class="chip">SVG · PNG · PDF</span><span class="chip">Risk levels</span></div>' : ''}
</div></body></html>`;

async function main() {
  const icon = await readFile(path.join(APP_ROOT, 'public', 'favicon.svg'), 'utf8');
  await mkdir(OUT_DIR, { recursive: true });

  const jobs = [
    [
      card(
        { w: 1200, h: 630, pad: 76, gap: 20, icon: 96, title: 68, body: 27, text: 900, chip: 19, align: 'flex-start' },
        icon,
      ),
      'og-image.png',
      1200,
      630,
    ],
    [
      card({ w: 180, h: 180, pad: 22, gap: 0, icon: 104, title: 0, body: 0, text: 0, chip: 0, align: 'center' }, icon),
      'apple-touch-icon.png',
      180,
      180,
    ],
  ];

  const browser = await chromium.launch();
  for (const [html, file, width, height] of jobs) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(OUT_DIR, file) });
    await page.close();
    console.log(`wrote ${path.relative(APP_ROOT, path.join(OUT_DIR, file))}`);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
