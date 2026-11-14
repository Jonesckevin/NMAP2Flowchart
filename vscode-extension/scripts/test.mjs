#!/usr/bin/env node
/**
 * What can be checked without VS Code: the renderer (parse → layout → SVG) and the
 * files the manifest points at. The webview itself is a plain HTML document, so
 * `previewHtml` is asserted as a string rather than driven in a browser.
 *
 *   npm test        (needs `npm run sync` once)
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Both are CommonJS with an `exports` map that hides their names from ESM.
const requireCjs = createRequire(import.meta.url);
const oniguruma = requireCjs('vscode-oniguruma');
const vsctm = requireCjs('vscode-textmate');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
const test = async (name, run) => {
  try {
    await run();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
};

/** The renderer is TypeScript with the app's extensionless imports: bundle it. */
const TMP = path.join(ROOT, 'node_modules', '.tmp-ext-tests');

async function loadRenderer() {
  const out = path.join(TMP, 'render.test.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src', 'render.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return import(`${pathToFileURL(out).href}?t=${Date.now()}`);
}

async function loadPreview() {
  const out = path.join(TMP, 'preview.test.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src', 'preview.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(out).href}?t=${Date.now()}`);
}

async function loadScan() {
  const out = path.join(TMP, 'scan.test.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src', 'scan.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(out).href}?t=${Date.now()}`);
}

const SAMPLE = `%% lab
flowchart LR
layer: "DMZ" color: #4b9fff
risk: Critical = 23, 3389 #e5484d

subgraph dmz["DMZ"] cidr: "10.0.0.0/24"
  web["Web server"] kind: host host: "10.0.0.10" hostname: "web.lab" ports: "80/http, 443/https"
  db["Database"] kind: host host: "10.0.0.11" ports: "5432/postgresql"
end
memo>Remember] notes: "rotate keys"
web -->|SQL| db
`;

console.log(`nmap2flowchart extension · ${ROOT}\n`);

const { renderCode } = await loadRenderer();
const { previewHtml } = await loadPreview();
const { scanToCode } = await loadScan();

await test('a diagram renders to an SVG with its labels', () => {
  const result = renderCode(SAMPLE);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.equal(result.empty, false);
  assert.match(result.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(result.width > 320 && result.height > 200, `unexpected size ${result.width}×${result.height}`);
  assert.equal(result.nodes, 4, 'two hosts, a section and a note');
  assert.equal(result.sections, 1);
  assert.equal(result.edges, 1);
  assert.ok(result.svg.includes('Web server'), 'the card carries its title');
  assert.ok(result.svg.includes('web.lab'), 'and its hostname');
  assert.ok(result.svg.includes('>DMZ<'), 'the section draws its title');
  assert.ok(result.svg.includes('2 nodes'), 'and counts the cards inside it');
  assert.ok(result.svg.includes('SQL'), 'the connection keeps its label');
  assert.equal(result.layerName, 'DMZ');
});

await test('the wrapped (expanded) form renders the same diagram', () => {
  const compact = renderCode(SAMPLE);
  const expanded = renderCode(
    SAMPLE.replace(
      '  web["Web server"] kind: host host: "10.0.0.10" hostname: "web.lab" ports: "80/http, 443/https"',
      [
        '  web["Web server"] kind: host',
        '    host: "10.0.0.10" hostname: "web.lab"',
        '    ports: "80/http, 443/https"',
      ].join('\n'),
    ),
  );
  assert.equal(expanded.ok, true, expanded.ok ? '' : expanded.error);
  assert.equal(expanded.svg, compact.svg, 'the two layouts draw the same picture');
});

await test('a syntax error names the line and draws nothing', () => {
  const result = renderCode('flowchart LR\nweb --> db\nsubgraph broken["X"]');
  assert.equal(result.ok, false);
  assert.equal(result.line, 3);
  assert.match(result.error, /never closed/);
});

await test('comments and blank lines are an empty diagram, not an error', () => {
  for (const text of ['', '   \n\n', '%% just a comment\n# and another']) {
    const result = renderCode(text);
    assert.equal(result.ok, true);
    assert.equal(result.empty, true);
  }
});

await test('risk levels from the code colour the cards', () => {
  const result = renderCode(
    ['flowchart LR', 'risk: Critical = 23 #e5484d', 'web["Web"] ports: "23/telnet"'].join('\n'),
  );
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.ok(result.svg.includes('#e5484d'), 'the level colour reaches the export');
});

await test('the dark palette recolours the page without moving anything', () => {
  const light = renderCode(SAMPLE);
  const dark = renderCode(SAMPLE, 'dark');
  assert.equal(dark.width, light.width, 'the palette must not change the geometry');
  assert.equal(dark.height, light.height);
  assert.ok(dark.svg.includes('fill="#0b1118"'), 'the page is dark');
  assert.equal(dark.svg.includes('fill="#ffffff"'), false, 'no white card is left behind');
  assert.ok(dark.svg.includes('Web server'), 'and the same cards are drawn');
  assert.equal(renderCode(SAMPLE).svg, light.svg, 'light is still the default');
});

await test('the preview page embeds the SVG and states the counts', () => {
  const result = renderCode(SAMPLE);
  const html = previewHtml(result, {
    cspSource: 'vscode-resource://x',
    fileName: 'lab.n2f',
    theme: 'light',
  });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes('<svg'), 'the page embeds the picture');
  assert.ok(html.includes('4 nodes'), 'the header counts the nodes');
  assert.ok(html.includes('lab.n2f'));
  assert.ok(html.includes("default-src 'none'"), 'the page locks itself down');
});

await test('the preview page carries the theme it was drawn in', () => {
  const result = renderCode(SAMPLE);
  const page = (theme) => previewHtml(result, { cspSource: 'c', fileName: 'lab.n2f', theme });
  assert.ok(page('light').includes('data-theme="light"'));
  assert.ok(page('dark').includes('data-theme="dark"'));
  assert.ok(page('light').includes('light</span>'), 'the bar names the palette');
  assert.ok(page('dark').includes('dark</span>'));
});

await test('the preview page escapes a hostile error message', () => {
  const html = previewHtml(
    { ok: false, error: '<img src=x onerror=alert(1)>', line: 2 },
    { cspSource: 'vscode-resource://x', fileName: '<script>.n2f', theme: 'light' },
  );
  assert.ok(!html.includes('<img src=x'), 'the message is escaped');
  assert.ok(!html.includes('<script>.n2f'));
  assert.ok(html.includes('&lt;img src=x'));
});

await test('the preview keeps the last good picture under an error', () => {
  const good = renderCode(SAMPLE);
  const html = previewHtml(
    { ok: false, error: 'Line 3: “subgraph broken” is never closed with “end”.', line: 3 },
    { cspSource: 'vscode-resource://x', fileName: 'lab.n2f', theme: 'light', lastGood: good },
  );
  assert.ok(html.includes('is-stale'), 'the older diagram is dimmed');
  assert.ok(html.includes('<svg'), 'and still shown');
});

const SCAN_XML = await readFile(path.join(ROOT, 'samples', 'scan.xml'), 'utf8');

await test('an nmap scan becomes diagram code', () => {
  const result = scanToCode(SCAN_XML, 'scan.xml');
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.equal(result.hosts, 3, 'three hosts in the sample scan');
  assert.equal(result.openPorts, 9, '3 + 2 + 4 open ports');
  assert.ok(result.code.startsWith('%% nmap2flowchart code'), 'the code carries the header');
  assert.ok(result.code.includes('flowchart LR'));
  assert.ok(result.code.includes('host: "10.0.0.10"'), 'addresses survive');
  assert.ok(result.code.includes('hostname: "web.lab"'), 'hostnames survive');
  assert.ok(result.code.includes('ports: "80/http, 443/https"'), 'ports keep their service');
});

await test('imported code draws the same diagram as the app', () => {
  const scanned = scanToCode(SCAN_XML, 'scan.xml');
  const picture = renderCode(scanned.code);
  assert.equal(picture.ok, true, picture.ok ? '' : picture.error);
  assert.equal(picture.nodes, 5, 'three host cards, their /24 section and the scan origin');
  assert.ok(picture.svg.includes('web.lab'));
  assert.ok(picture.svg.includes('db.lab'), 'the database card is drawn');
  assert.ok(picture.svg.includes('4 open'), 'and counts every open port the scan found');
});

await test('a scan without ports never invents one', () => {
  const discovery = scanToCode(
    '<nmaprun args="nmap -sn 10.0.0.0/24"><host><status state="up"/>' +
      '<address addr="10.0.0.5" addrtype="ipv4"/></host></nmaprun>',
    'ping.xml',
  );
  assert.equal(discovery.ok, true);
  assert.equal(discovery.hosts, 1);
  assert.equal(discovery.openPorts, 0);
  assert.equal(discovery.code.includes('ports:'), false, 'a discovery-only host has no ports');

  const hosthint = scanToCode(
    '<nmaprun><hosthint><status state="up"/><address addr="10.0.0.6" addrtype="ipv4"/></hosthint></nmaprun>',
    'hint.xml',
  );
  assert.equal(hosthint.ok, true, 'a hosthint host still imports');
  assert.equal(hosthint.code.includes('ports:'), false);
});

await test('a file that is not a scan is refused with a reason', () => {
  const page = scanToCode('<html><body>not a scan</body></html>', 'page.xml');
  assert.equal(page.ok, false);
  assert.match(page.error, /-oX/, 'the message says how to get real input');

  const broken = scanToCode('this is not xml <<<', 'broken.xml');
  assert.equal(broken.ok, false);
  assert.match(broken.error, /not valid XML/);
});

await test('the manifest points at files that exist', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './out/extension.js');
  await stat(path.join(ROOT, manifest.main));
  await stat(path.join(ROOT, manifest.icon));

  const language = manifest.contributes.languages[0];
  await stat(path.join(ROOT, language.configuration));
  const grammar = manifest.contributes.grammars[0];
  assert.equal(grammar.scopeName, 'source.n2f');
  assert.ok(language.extensions.includes('.n2f'));
  await stat(path.join(ROOT, grammar.path));
  for (const snippet of manifest.contributes.snippets) await stat(path.join(ROOT, snippet.path));

  // The icon has to be a raster image: the Marketplace refuses an SVG.
  const icon = await readFile(path.join(ROOT, manifest.icon));
  assert.deepEqual([...icon.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the icon is a PNG');

  // Everything a user can search for is declared.
  assert.ok(manifest.displayName && manifest.description);
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length >= 4);
  assert.ok(Array.isArray(manifest.categories) && manifest.categories.length > 0);
  assert.ok(
    manifest.contributes.configuration.properties['n2f.preview.autoOpen'],
    'the auto-open preview setting is declared',
  );
  const theme = manifest.contributes.configuration.properties['n2f.preview.theme'];
  assert.ok(theme, 'the preview theme setting is declared');
  assert.deepEqual(theme.enum, ['auto', 'light', 'dark']);
  const toggle = manifest.contributes.commands.find((entry) => entry.command === 'n2f.togglePreviewTheme');
  assert.ok(toggle, 'the toggle command is declared');
  assert.ok(Array.isArray(toggle.icon) || typeof toggle.icon === 'string', 'so it can sit on a title bar');

  // The import has to be reachable without knowing it exists: a button on the
  // Explorer's title bar, one on an open scan, and the file's context menu.
  const menus = manifest.contributes.menus;
  const showsImport = (entries) =>
    (entries ?? []).some((entry) => entry.command === 'n2f.importNmap');
  assert.ok(showsImport(menus['view/title']), 'an import button on the Explorer title bar');
  assert.ok(showsImport(menus['editor/title']), 'an import button on an open scan');
  assert.ok(showsImport(menus['explorer/context']), 'and the scan context menu');
  const titleEntries = menus['editor/title'].filter((entry) => entry.command === 'n2f.importNmap');
  assert.ok(titleEntries.some((entry) => /xml/.test(entry.when)), 'shown on an open scan');
  assert.ok(titleEntries.some((entry) => /n2f/.test(entry.when)), 'and beside the preview button');
});

await test('the grammar compiles and covers the language', async () => {
  const grammar = JSON.parse(
    await readFile(path.join(ROOT, 'syntaxes', 'n2f.tmLanguage.json'), 'utf8'),
  );
  assert.equal(grammar.scopeName, 'source.n2f');
  assert.ok(Array.isArray(grammar.patterns) && grammar.patterns.length > 5);

  const compiled = [];
  const walk = (rule) => {
    for (const key of ['match', 'begin', 'end']) {
      if (typeof rule[key] === 'string') {
        new RegExp(rule[key]); // throws on a broken pattern
        compiled.push(key);
      }
    }
    for (const child of Object.values(rule.patterns ?? {})) walk(child);
  };
  for (const rule of Object.values(grammar.repository)) walk(rule);
  assert.ok(compiled.length > 8, 'the grammar has real rules');

  // The tokens the panel colours in the web app should exist here too.
  const sources = Object.values(grammar.repository).map((rule) => rule.match ?? rule.begin ?? '');
  assert.ok(sources.some((source) => source.includes('subgraph')), 'directives');
  assert.ok(grammar.repository.colour.match.includes('#'), 'colours');
  assert.ok(sources.some((source) => source.includes('\\|')), 'edge labels');
});

await test('the grammar tokenises the language with the real TextMate engine', async () => {
  const grammarPath = path.join(ROOT, 'syntaxes', 'n2f.tmLanguage.json');
  const wasm = await readFile(path.join(ROOT, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));

  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (value) => new oniguruma.OnigString(value),
    }),
    loadGrammar: async (scopeName) =>
      scopeName === 'source.n2f'
        ? vsctm.parseRawGrammar(await readFile(grammarPath, 'utf8'), grammarPath)
        : null,
  });

  const grammar = await registry.loadGrammar('source.n2f');
  assert.ok(grammar, 'the grammar loads');

  /** scope of the first token that covers a piece of text */
  const scopesOf = (line, needle) => {
    const { tokens } = grammar.tokenizeLine(line, vsctm.INITIAL);
    const at = line.indexOf(needle);
    assert.ok(at >= 0, `“${needle}” is not on the line`);
    const token = tokens.find((entry) => entry.startIndex <= at && at < entry.endIndex);
    return token ? token.scopes : [];
  };
  const has = (scopes, part) => scopes.some((scope) => scope.includes(part));

  assert.ok(has(scopesOf('%% a comment', 'comment'), 'comment.line'), 'a comment is a comment');
  assert.ok(has(scopesOf('flowchart LR', 'flowchart'), 'keyword.control'), 'a directive is a keyword');
  assert.ok(has(scopesOf('web["Web"]', 'web'), 'variable.other'), 'a node id is a variable');
  assert.ok(has(scopesOf('web["Web"]', 'Web'), 'string.quoted.double'), 'a label is a string');
  assert.ok(has(scopesOf('host: "10.0.0.5"', 'host'), 'entity.name.tag'), 'an attribute key is a tag');
  assert.ok(has(scopesOf('a -->|SQL| b', '-->'), 'keyword.operator.arrow'), 'an arrow is an operator');
  assert.ok(has(scopesOf('a -->|SQL| b', 'SQL'), 'string.unquoted.label'), 'an edge label is a label');
  assert.ok(has(scopesOf('accent: #2fd6a5', '#2fd6a5'), 'constant.other.color'), 'a colour is a colour');
  assert.ok(has(scopesOf('depth: 2', '2'), 'constant.numeric'), 'a number is a number');
  assert.ok(!has(scopesOf('accent: #2fd6a5', '#2fd6a5'), 'comment.line'), 'a colour is not a comment');
});

await test('the snippet keys match the file the manifest promises', async () => {
  const snippets = JSON.parse(
    await readFile(path.join(ROOT, 'snippets', 'n2f.code-snippets'), 'utf8'),
  );
  for (const snippet of Object.values(snippets)) {
    assert.ok(snippet.prefix, 'every snippet has a prefix');
    assert.ok(Array.isArray(snippet.body) && snippet.body.length > 0);
  }
});

/**
 * The extension host half, driven with a stand-in `vscode` module: it proves the
 * bundle loads, registers both commands, opens a panel and re-renders on a text
 * change – the wiring the renderer tests cannot see.
 */
await test('the extension activates and drives a preview panel', async () => {
  const bundle = path.join(TMP, 'extension.cjs');
  await build({
    entryPoints: [path.join(ROOT, 'src', 'extension.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['vscode'],
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const commands = new Map();
  let changeHandler;
  const panels = [];
  const editorState = { text: SAMPLE };
  const settings = { theme: 'auto' };
  const configuration = {
    get: (key, fallback) => (key in settings ? settings[key] : fallback),
    update: async (key, value) => {
      settings[key] = value;
    },
  };
  const imported = [];
  const scanText = await readFile(path.join(ROOT, 'samples', 'scan.xml'), 'utf8');
  const document = {
    languageId: 'n2f',
    getText: () => editorState.text,
    uri: { path: '/lab.n2f', toString: () => 'file:///lab.n2f', with: (part) => part },
  };

  const fake = {
    ViewColumn: { Beside: 2 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    ConfigurationTarget: { Global: 1 },
    commands: {
      registerCommand: (id, run) => {
        commands.set(id, run);
        return { dispose() {} };
      },
    },
    workspace: {
      onDidChangeTextDocument: (handler) => {
        changeHandler = handler;
        return { dispose() {} };
      },
      onDidCloseTextDocument: () => ({ dispose() {} }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      getConfiguration: () => configuration,
      fs: {
        writeFile: async () => {},
        stat: async () => ({ size: Buffer.byteLength(scanText) }),
        readFile: async () => Buffer.from(scanText, 'utf8'),
      },
      openTextDocument: async ({ language, content }) => {
        const opened = {
          languageId: language,
          getText: () => content,
          uri: { path: '/Untitled-1', toString: () => 'untitled:Untitled-1' },
        };
        imported.push(opened);
        return opened;
      },
    },
    window: {
      get activeTextEditor() {
        return { document };
      },
      // A dark editor, so `auto` has something to follow.
      activeColorTheme: { kind: 2 },
      onDidChangeActiveColorTheme: () => ({ dispose() {} }),
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showOpenDialog: async () => undefined,
      showSaveDialog: async () => undefined,
      showTextDocument: async (opened) => opened,
      createWebviewPanel: () => {
        const panel = {
          title: '',
          webview: { html: '', cspSource: 'vscode-resource://test' },
          reveal() {},
          onDidDispose: () => ({ dispose() {} }),
          dispose() {},
        };
        panels.push(panel);
        return panel;
      },
    },
    env: { openExternal: async () => true },
    Uri: { parse: (value) => value },
  };

  const requireCjs = createRequire(import.meta.url);
  const Module = requireCjs('node:module');
  const load = Module._load;
  Module._load = function patched(request, ...rest) {
    if (request === 'vscode') return fake;
    return load.call(this, request, ...rest);
  };
  let extension;
  try {
    extension = requireCjs(bundle);
    extension.activate({ subscriptions: [] });
  } finally {
    Module._load = load;
  }

  assert.deepEqual([...commands.keys()].sort(), [
    'n2f.exportSvg',
    'n2f.importNmap',
    'n2f.openPreview',
    'n2f.togglePreviewTheme',
  ]);
  await commands.get('n2f.openPreview')();

  assert.equal(panels.length, 1, 'one panel is opened');
  assert.ok(panels[0].webview.html.includes('<svg'), 'the panel shows the diagram');
  assert.ok(panels[0].title.includes('lab.n2f'), 'and names the file');
  assert.ok(panels[0].webview.html.includes('data-theme="dark"'), 'auto follows the dark editor');
  assert.ok(panels[0].webview.html.includes('fill="#0b1118"'), 'and draws on a dark page');

  // A broken edit lands through the debounce, and the old picture is kept.
  editorState.text = `${SAMPLE}\nsubgraph broken["X"]`;
  changeHandler({ document });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const html = panels[0].webview.html;
  assert.ok(html.includes('never closed'), 'the panel reports the parse error');
  assert.ok(html.includes('is-stale'), 'and keeps the last good diagram');

  // Toggling re-draws that dimmed picture in the other palette, not the old one.
  await commands.get('n2f.togglePreviewTheme')();
  assert.equal(settings.theme, 'light', 'the toggle writes the setting');
  const light = panels[0].webview.html;
  assert.ok(light.includes('data-theme="light"'), 'the page flips with the picture');
  assert.ok(light.includes('is-stale'), 'the stale picture is still there');
  assert.ok(light.includes('fill="#ffffff"'), 'and it was re-drawn light');
  assert.equal(light.includes('fill="#0b1118"'), false, 'nothing dark is left in the picture');

  extension.deactivate();

  // With the panel closed the button still works: it opens the preview it chose.
  editorState.text = SAMPLE;
  await commands.get('n2f.togglePreviewTheme')();
  assert.equal(panels.length, 2, 'the toggle opens the preview when it is closed');
  assert.ok(panels[1].webview.html.includes('<svg'), 'and draws the diagram');
  assert.ok(panels[1].webview.html.includes('data-theme="dark"'), 'in the palette just picked');

  // A scan taken from the Explorer arrives as a `.n2f` editor with the diagram open.
  await commands.get('n2f.importNmap')({
    scheme: 'file',
    path: '/samples/scan.xml',
    toString: () => 'file:///samples/scan.xml',
  });
  assert.equal(imported.length, 1, 'the import opens one document');
  assert.equal(imported[0].languageId, 'n2f', 'with the language that drives the preview');
  assert.ok(imported[0].getText().includes('host: "10.0.0.10"'), 'carrying the scan');
  assert.equal(panels.length, 2, 'the open preview switches to the import');
  assert.ok(panels[1].webview.html.includes('db.lab'), 'drawing what was imported');
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
