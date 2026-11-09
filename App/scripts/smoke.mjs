#!/usr/bin/env node
/**
 * Browser smoke test: the flow a user takes from an empty tab to an exported
 * report, driven in a real Chromium so the wiring between the panels is exercised
 * – props, focus, the import worker, the risk filter, the download path.
 *
 *   npm run smoke                                   the app in ./dist
 *   npm run smoke -- --dist ../n2f/dist --base /n2f/  the static edition
 *
 * Any assertion failure, page error or console error exits 1. Debug logs are
 * expected to be noisy about `/api` in the static build, so those are ignored.
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};

const DIST = path.resolve(APP_ROOT, flag('--dist', 'dist'));
const BASE = flag('--base', '/');
const PORT = Number(flag('--port', 0)) || 0;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const SCAN = `<?xml version="1.0" encoding="UTF-8"?>
<nmaprun scanner="nmap" args="nmap -sV -oX smoke.xml 192.168.60.0/29" start="1700000000" version="7.94">
  <host><status state="up" reason="echo-reply"/><address addr="192.168.60.1" addrtype="ipv4"/>
    <ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh"/></port></ports></host>
  <host><status state="up" reason="echo-reply"/><address addr="192.168.60.2" addrtype="ipv4"/>
    <ports><port protocol="tcp" portid="3389"><state state="open"/><service name="ms-wbt-server"/></port></ports></host>
  <runstats><finished time="1700000020"/><hosts up="2" down="0" total="2"/></runstats>
</nmaprun>
`;

const failures = [];
const step = async (name, run) => {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function serve(root, base) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (base !== '/' && !url.pathname.startsWith(base)) {
      response.writeHead(404).end('outside base');
      return;
    }
    const rel = decodeURIComponent(url.pathname.slice(base === '/' ? 1 : base.length)) || 'index.html';
    const file = path.join(root, rel.endsWith('/') ? `${rel}index.html` : rel);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('missing');
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

async function main() {
  const { server, port } = await serve(DIST, BASE);
  const origin = `http://127.0.0.1:${port}${BASE}`;
  const workDir = await mkdtemp(path.join(tmpdir(), 'n2f-smoke-'));
  const scanPath = path.join(workDir, 'smoke-scan.xml');
  await writeFile(scanPath, SCAN, 'utf8');

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() !== 'error') return;
    // The static build refuses `/api` on purpose; the app treats that as offline.
    if (/\/api|\b502\b|Failed to load resource/.test(text)) return;
    errors.push(text);
  });

  const clickButton = (label) =>
    page.evaluate((name) => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (element) => element.textContent.trim() === name,
      );
      if (!button) throw new Error(`no button labelled “${name}”`);
      button.click();
    }, label);

  const countNodes = () => page.locator('.react-flow__node').count();

  console.log(`smoke: ${DIST} at ${origin}`);

  await page.goto(origin);
  await step('the editor loads', async () => {
    await page.locator('#root button', { hasText: 'Sample scan' }).first().waitFor({ timeout: 10_000 });
    assert(await page.title() !== '', 'the page has a title');
  });

  await step('the bundled sample renders a diagram', async () => {
    await page.getByRole('button', { name: 'Sample scan' }).click({ force: true });
    await page.waitForTimeout(1200);
    const nodes = await countNodes();
    assert(nodes > 5, `expected a populated canvas, saw ${nodes} nodes`);
  });

  await step('an XML import is reviewed before it lands', async () => {
    const before = await countNodes();
    await page.locator('input[type="file"]').first().setInputFiles(scanPath);
    await page.locator('[aria-modal="true"]').first().waitFor({ timeout: 10_000 });
    const preview = await page.locator('[aria-modal="true"]').first().textContent();
    assert(/2\s*hosts/.test(preview ?? ''), 'the preview counts the hosts in the scan');
    await page.getByRole('button', { name: /Merge scan/ }).click();
    await page.waitForTimeout(900);
    const after = await countNodes();
    assert(after > before, `the merge added cards (${before} → ${after})`);
  });

  await step('Import / Export offers the six file choices', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await clickButton('Import / Export');
    await page.waitForTimeout(400);
    const labels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.file-hub .file-format__body strong')).map((node) => node.textContent),
    );
    assert(labels.length === 6, `expected 6 export rows, saw ${labels.length}`);
    assert(
      labels.some((label) => label.includes('draw.io')) && labels.some((label) => label.includes('Mermaid')),
      'the diagram formats are offered',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await step('the risk panel exports the filtered view as CSV', async () => {
    await clickButton('Risk');
    await page.waitForTimeout(400);
    await page.getByRole('searchbox', { name: 'Filter risk summary' }).fill('22');
    await page.waitForTimeout(250);
    const note = await page.locator('.risk-summary__footnote').textContent();
    assert(/22/.test(note ?? ''), 'the footer says which filter the export follows');

    await page.evaluate(() => {
      window.__smokeBlobs = [];
      URL.createObjectURL = (blob) => {
        window.__smokeBlobs.push(blob);
        return 'blob:smoke';
      };
      HTMLAnchorElement.prototype.click = function capture() {};
    });
    await page.getByRole('button', { name: 'Export current view' }).click();
    await page.waitForTimeout(400);
    const csv = await page.evaluate(async () => {
      const blob = window.__smokeBlobs?.at(-1);
      return blob ? await blob.text() : '';
    });
    assert(csv.includes('filter “22”'), 'the report records the filter it was built from');
    assert(/,\s*22,/.test(csv), 'only the filtered port is in the report');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await step('Ctrl-K opens the command palette', async () => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    const rows = await page.locator('.command-row').count();
    assert(rows > 5, `expected a list of commands, saw ${rows}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  await step('the console stays clean', async () => {
    assert(errors.length === 0, errors.join(' | '));
  });

  await browser.close();
  server.close();

  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed`);
    process.exit(1);
  }
  console.log('\nall smoke steps passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
