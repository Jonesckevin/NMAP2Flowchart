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

const DRAWIO = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" version="24.7.8" type="device">
  <diagram id="smoke" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="lan" value="&lt;b&gt;10.20.0.0/24&lt;/b&gt;" style="rounded=0;verticalAlign=top;align=left;fillColor=#f6f8fb;strokeColor=#b6c1d1;" vertex="1" parent="1">
          <mxGeometry x="40" y="120" width="520" height="300" as="geometry"/>
        </mxCell>
        <mxCell id="gw" value="&lt;b&gt;📡 10.20.0.1&lt;/b&gt;&lt;br&gt;gw.smoke.internal" style="rounded=1;fillColor=#ffffff;strokeColor=#c3ccd9;" vertex="1" parent="1">
          <mxGeometry x="40" y="20" width="200" height="70" as="geometry"/>
        </mxCell>
        <mxCell id="pc" value="&lt;b&gt;🖥️ workstation&lt;/b&gt;&lt;br&gt;10.20.0.5&lt;br&gt;445/microsoft-ds" style="rounded=1;fillColor=#ffffff;strokeColor=#c3ccd9;" vertex="1" parent="lan">
          <mxGeometry x="24" y="60" width="200" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="wire" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=1;strokeColor=#8ba1b8;dashed=1;dashPattern=9 5;" edge="1" parent="1" source="gw" target="pc">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

const failures = [];
const step = async (name, run) => {  try {
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

  await step('the code panel rebuilds a layer from text', async () => {
    await page.getByRole('button', { name: 'Show code panel' }).click();
    const area = page.locator('.code-panel__area');
    await area.waitFor({ timeout: 5000 });
    const text = await area.inputValue();
    assert(/^flowchart /m.test(text), 'the panel shows the layer as code');
    assert(/subgraph /.test(text), 'sections are written as subgraphs');

    // The highlighted copy sits under the real textarea, so it has to be identical.
    const overlay = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.code-panel__highlight .code-line'))
        .map((line) => (line.textContent ?? '').replace(/\u200b/g, ''))
        .join('\n'),
    );
    assert(overlay === text, 'the syntax layer matches the text character for character');

    // The gutter numbers every logical line.
    const numbered = await page.locator('.code-panel__highlight .code-line[data-line]').count();
    assert(numbered === text.split('\n').length, `the gutter numbers every line (${numbered})`);

    // Expand wraps attributes onto indented continuation lines; Compact puts them back.
    const compactText = await area.inputValue();
    await page.locator('.code-panel__toolbar button[aria-label="Expand the code"]').click();
    await page.waitForTimeout(350);
    const expandedText = await area.inputValue();
    assert(
      expandedText.split('\n').length > compactText.split('\n').length,
      'Expand adds continuation lines',
    );
    assert(/^ +\w+: /m.test(expandedText), 'continuations are indented under their statement');
    assert((await page.locator('.code-panel__error').count()) === 0, 'the wrapped code still parses');
    await page.locator('.code-panel__toolbar button[aria-label="Compact the code"]').click();
    await page.waitForTimeout(350);
    assert(
      (await area.inputValue()).trim() === compactText.trim(),
      'Compact restores one line per statement',
    );

    // Typing is undoable on its own, without touching the document history.
    await area.fill('a["A"]\nb["B"]');
    await page.waitForTimeout(150);
    await area.press('Control+z');
    await page.waitForTimeout(250);
    assert(
      (await area.inputValue()).includes('flowchart'),
      'Ctrl+Z restores the text that was there before the edit',
    );
    await area.press('Control+Shift+z');
    await page.waitForTimeout(250);
    assert(
      (await area.inputValue()).trim() === 'a["A"]\nb["B"]',
      'Ctrl+Shift+Z redoes it',
    );

    // Back to the canvas text for the checks that follow.
    await page.getByRole('button', { name: 'Revert' }).click();
    await page.waitForTimeout(300);
    assert((await area.inputValue()).includes('flowchart'), 'Revert follows the canvas again');

    // Find, its own text size, and the colour under the caret.
    await page.locator('.code-panel__toolbar button[title^="Find"]').click();
    await page.locator('input[aria-label="Find in code"]').fill('subgraph');
    await page.waitForTimeout(250);
    const count = await page.locator('.code-panel__find-count').textContent();
    assert(/^1\/\d+$/.test((count ?? '').trim()), `find reports the match it is on (${count})`);
    await page.locator('button[aria-label="Close find"]').click();

    const before = await area.evaluate((element) => getComputedStyle(element).fontSize);
    await page.locator('button[aria-label="Larger text"]').click();
    const after = await area.evaluate((element) => getComputedStyle(element).fontSize);
    assert(Number.parseFloat(after) > Number.parseFloat(before), `Larger text resizes only the editor (${before} → ${after})`);

    const swatch = await page.evaluate(async () => {
      const input = document.querySelector('.code-panel__area');
      const at = input.value.indexOf('#4b9fff');
      if (at < 0) return 'no colour in the sample';
      input.focus();
      input.setSelectionRange(at + 2, at + 2);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return document.querySelector('.code-panel__swatch-text')?.textContent ?? '';
    });
    assert(/#4b9fff/.test(swatch), `the swatch reads the colour under the caret (${swatch})`);

    // A syntax error is reported, and the diagram keeps its cards.
    await area.fill('subgraph s["S"]\n  a["A"]');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(300);
    assert(
      /never closed/.test((await page.locator('.code-panel__error').textContent()) ?? ''),
      'the panel names the problem',
    );
    assert((await countNodes()) > 5, 'a failed apply leaves the canvas alone');

    await area.fill('web["Web"] host: "10.9.9.9" ports: "80/http"\ndb["Db"]\nweb -->|SQL| db');
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(700);

    const header = await page.locator('.code-panel__head').textContent();
    assert(/2 nodes/.test(header ?? ''), `the header counts the rebuilt layer (${header ?? ''})`);
    assert((await countNodes()) <= 3, 'the rest of the layer went away');
    assert(
      /following the canvas/.test((await page.locator('.code-panel__state').textContent()) ?? ''),
      'the code follows the new document',
    );

    // Put the sample back for the steps that follow, then close the panel.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForTimeout(600);
    assert((await countNodes()) > 5, 'one undo restored the layer');
    await page.getByRole('button', { name: 'Hide code panel' }).click();
    await page.waitForTimeout(200);
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

  await step('the diagram filter shows how many cards match', async () => {
    const field = page.getByRole('textbox', { name: 'Filter diagram' });
    await field.fill('22');
    await page.waitForTimeout(450);
    const text = (await page.locator('.search__count').textContent())?.trim() ?? '';
    assert(/^\d+\/\d+$/.test(text), `the count reads matches of total, saw “${text}”`);

    // The count and the clear button are laid out beside the text, never on top of it.
    const laidOut = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const input = box('.search__field input');
      const count = box('.search__count');
      const clear = box('.search__clear');
      const pill = box('.search__field');
      if (!input || !count || !clear || !pill) return 'missing';
      return input.right <= count.left && count.right <= clear.left && clear.right <= pill.right + 1;
    });
    assert(laidOut === true, 'the count and the clear button sit beside the text inside the field');
    await field.fill('');
    await page.waitForTimeout(300);

    // Below 1000px the field gives way to the full-width search bar.
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(450);
    assert(!(await page.locator('.search').isVisible()), 'the inline field is hidden on a narrow window');
    await page.keyboard.press('/');
    await page.waitForTimeout(400);
    assert(await page.locator('.mobile-search').isVisible(), 'the search shortcut opens the full-width bar');
    await field.fill('10.0.0');
    await page.waitForTimeout(350);
    const overlay = (await page.locator('.mobile-search__count').textContent())?.trim() ?? '';
    assert(/\d+ of \d+ match/.test(overlay), `the full-width bar counts too, saw “${overlay}”`);
    await field.fill('');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
  });

  await step('Try to connect builds a map layer that undo removes', async () => {
    await page.locator('button[aria-label="More actions"]').click();
    await page.getByRole('menuitem', { name: /Try to connect/ }).click();
    const dialog = page.locator('[aria-modal="true"]').first();
    await dialog.waitFor({ timeout: 10_000 });
    const preview = await dialog.textContent();
    assert(/routers/.test(preview ?? ''), 'the preview counts the routers it found');
    await page.getByRole('button', { name: 'Create map layer' }).click();
    await page.waitForTimeout(900);
    const mapLayers = page.locator('[data-layer-id]', { hasText: 'Network map' });
    assert((await mapLayers.count()) > 0, 'the map lands on its own layer');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(700);
    assert(
      (await page.locator('[data-layer-id]', { hasText: 'Network map' }).count()) === 0,
      'undo removes the map layer again',
    );
  });

  await step('a card stays on the canvas while it is dragged to the edge', async () => {
    // The canvas culls nodes outside the viewport; a card dropped at the edge used
    // to vanish until a reload. Dragging one out there is the regression check.
    const card = page.locator('.react-flow__node[data-id^="host:"]').first();
    const box = await card.boundingBox();
    const canvas = await page.locator('.react-flow').boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const target = { x: canvas.x + canvas.width - 60, y: canvas.y + canvas.height - 60 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let move = 1; move <= 6; move += 1) {
      await page.mouse.move(
        start.x + ((target.x - start.x) * move) / 6,
        start.y + ((target.y - start.y) * move) / 6,
      );
    }
    await page.waitForTimeout(150);
    const duringDrag = await card.count();
    await page.mouse.up();
    await page.waitForTimeout(350);

    assert(duringDrag === 1, 'the dragged card is still mounted at the edge of the viewport');
    assert((await card.count()) === 1, 'the card is still on the canvas after the drop');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);
  });

  await step('a connection offers four sides and four arrowheads', async () => {
    // Dragging near the edge auto-pans the canvas, so put the diagram back in view.
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(600);

    const card = page.locator('.react-flow__node[data-id^="host:"]').first();
    await card.hover();
    const handles = await card.locator('.react-flow__handle').count();
    assert(handles === 4, `expected four connector points on a card, saw ${handles}`);

    const middle = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__edge .react-flow__edge-path')).map((path) => {
        const point = path.getPointAtLength(path.getTotalLength() / 2);
        const ct = path.getScreenCTM();
        return { x: point.x * ct.a + point.y * ct.c + ct.e, y: point.x * ct.b + point.y * ct.d + ct.f };
      }),
    );
    assert(middle.length > 0, 'the sample draws at least one connection');

    let selected = 0;
    for (const point of middle) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(150);
      selected = await page.locator('.react-flow__edge.selected').count();
      if (selected > 0) break;
    }
    assert(selected === 1, 'clicking a connection selects it');

    await page.getByRole('button', { name: 'Point both ways' }).click();
    await page.waitForTimeout(350);
    const markers = await page.evaluate(() => {
      const path = document.querySelector('.react-flow__edge.selected .react-flow__edge-path');
      return path
        ? { start: path.getAttribute('marker-start'), end: path.getAttribute('marker-end') }
        : null;
    });
    assert(markers?.start && markers?.end, 'both ends of the edge draw an arrowhead');

    await page.getByRole('button', { name: 'Leave bottom' }).click();
    await page.waitForTimeout(300);
    const active = await page.getByRole('button', { name: 'Leave bottom' }).getAttribute('class');
    assert(/is-active/.test(active ?? ''), 'the side picker remembers the side the line leaves');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  await step('a MAC address can be typed onto a card', async () => {
    // A card with no MAC used to swallow + Add MAC: the blank row was dropped from
    // the document before it could be drawn, so no text box ever appeared.
    const cards = page.locator('.react-flow__node[data-id^="host:"]');
    let picked = false;
    for (let index = 0; index < (await cards.count()); index += 1) {
      await cards.nth(index).click({ force: true, position: { x: 30, y: 12 } });
      await page.waitForTimeout(150);
      if ((await page.locator('input[aria-label^="MAC "]').count()) === 0) {
        picked = true;
        break;
      }
    }
    assert(picked, 'a card without a MAC is selected');

    await page.getByRole('button', { name: '+ Add MAC' }).click();
    await page.waitForTimeout(250);
    const box = page.locator('input[aria-label="MAC 1"]');
    assert((await box.count()) === 1, 'adding a MAC opens a text box for it');
    await box.fill('AA:BB:CC:DD:EE:FF');
    await page.waitForTimeout(300);
    assert((await box.inputValue()) === 'AA:BB:CC:DD:EE:FF', 'the address can be typed into it');
    await box.fill('');
    await page.waitForTimeout(300);
    assert((await box.count()) === 1, 'the row stays while it is empty');
  });

  await step('an address can be added to a card with none', async () => {
    // A card whose address rows were removed used to swallow + Add address: the
    // blank row collapsed back to no rows, so no text box ever appeared.
    const removeRow = page.getByRole('button', { name: 'Remove Address 1' });
    for (let guard = 0; guard < 5 && (await removeRow.count()) > 0; guard += 1) {
      await removeRow.first().click();
      await page.waitForTimeout(200);
    }
    assert((await page.locator('input[aria-label^="Address "]').count()) === 0, 'the address list is empty');

    await page.getByRole('button', { name: '+ Add address' }).click();
    await page.waitForTimeout(250);
    const address = page.locator('input[aria-label="Address 1"]');
    assert((await address.count()) === 1, 'adding an address opens a text box for it');
    await address.fill('10.9.9.9');
    await page.waitForTimeout(300);
    assert((await address.inputValue()) === '10.9.9.9', 'the address can be typed into it');
    const card = await page.locator('.react-flow__node.selected').first().innerText();
    assert(card.includes('10.9.9.9'), 'the card shows the address');
  });

  await step('a draw.io diagram opens as cards and sections', async () => {
    const drawioPath = path.join(workDir, 'smoke.drawio');
    await writeFile(drawioPath, DRAWIO, 'utf8');

    // Dropping the file works the same as picking it: the content decides.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate((xml) => {
      const data = new DataTransfer();
      data.items.add(new File([xml], 'dropped.drawio', { type: 'application/xml' }));
      const target = document.querySelector('.react-flow') ?? document.body;
      for (const type of ['dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
      }
    }, DRAWIO);
    await page.locator('.design-open').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(400);

    await clickButton('Import / Export');
    await page.waitForTimeout(400);
    await page.getByRole('tab', { name: 'Import / Open' }).click();
    await page.waitForTimeout(300);

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: /draw\.io diagram \(\.drawio\)/ }).click(),
    ]);
    await chooser.setFiles(drawioPath);

    const dialog = page.locator('.design-open');
    await dialog.waitFor({ timeout: 10_000 });
    const text = await dialog.textContent();
    assert(/draw\.io diagram/.test(text ?? ''), 'the preview names the format it read');
    assert(/2 hosts/.test(text ?? '') && /1 section/.test(text ?? ''), 'the preview counts the cards it found');
    await page.getByRole('button', { name: 'Replace diagram' }).click();
    await page.waitForTimeout(900);

    assert(
      (await page.locator('.react-flow__node', { hasText: 'workstation' }).count()) > 0,
      'the imported card is on the canvas',
    );
    assert(
      (await page.locator('.react-flow__node', { hasText: '10.20.0.0/24' }).count()) > 0,
      'the frame the drawing held is a section',
    );
    assert(
      (await page.locator('.react-flow__node', { hasText: '10.0.0.40' }).count()) === 0,
      'the diagram it replaced is gone',
    );
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
