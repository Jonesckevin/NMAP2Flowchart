import * as vscode from 'vscode';

import type { SvgTheme } from './core/app/export/svg';
import { previewHtml } from './preview';
import { renderCode, type RenderPicture } from './render';
import { MAX_SCAN_BYTES, scanToCode } from './scan';

/**
 * The extension host side: one preview panel that follows a `.n2f` document, the
 * scan import that creates one, and an SVG export. Everything that turns text into
 * a picture lives in `render.ts` and `scan.ts`, which have no `vscode` import and
 * are covered by the tests.
 */

const VIEW_TYPE = 'n2f.preview';
const LANGUAGE = 'n2f';
/** Long enough that typing does not re-render per keystroke, short enough to feel live. */
const DEBOUNCE_MS = 250;

let panel: vscode.WebviewPanel | undefined;
let watching: vscode.TextDocument | undefined;
/** The last text that parsed, and the picture drawn from it in each palette. */
let lastGood: { text: string; themes: Partial<Record<SvgTheme, RenderPicture>> } | undefined;
let timer: NodeJS.Timeout | undefined;
/** A theme the user picked when the settings file could not be written. */
let forcedTheme: SvgTheme | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('n2f.openPreview', () => {
      const editor = activeN2fEditor();
      if (!editor) {
        void vscode.window.showInformationMessage(
          'Open a .n2f diagram first – the preview follows the editor.',
        );
        return;
      }
      openPreview(editor.document);
    }),

    vscode.commands.registerCommand('n2f.exportSvg', () => void exportSvg()),

    vscode.commands.registerCommand('n2f.importNmap', (uri?: unknown) => importScan(uri)),

    vscode.commands.registerCommand('n2f.togglePreviewTheme', () => void toggleTheme()),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!panel || !watching || event.document.uri.toString() !== watching.uri.toString()) return;
      schedule();
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('n2f.preview.theme')) return;
      forcedTheme = undefined;
      render();
    }),

    // Under `auto` the diagram follows the editor, so its theme change is ours too.
    vscode.window.onDidChangeActiveColorTheme(() => {
      if (themeSetting() === 'auto') render();
    }),

    // Following the active editor is what makes the panel feel attached to the file.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || editor.document.languageId !== LANGUAGE) return;
      if (panel) {
        if (watching && editor.document.uri.toString() === watching.uri.toString()) return;
        watching = editor.document;
        render();
        return;
      }
      if (autoOpen()) openPreview(editor.document);
    }),

    vscode.workspace.onDidCloseTextDocument((document) => {
      if (!watching || document.uri.toString() !== watching.uri.toString()) return;
      watching = undefined;
      if (panel) {
        panel.webview.html = previewHtml(
          { ok: true, empty: true, svg: '', width: 0, height: 0, nodes: 0, edges: 0, sections: 0 },
          { cspSource: panel.webview.cspSource, fileName: 'no file', theme: previewTheme() },
        );
        panel.title = 'Flowchart Preview';
      }
    }),
  );

  const opened = activeN2fEditor();
  if (opened && autoOpen()) openPreview(opened.document);
}

/** `n2f.preview.autoOpen`: open the panel when a diagram becomes active. */
function autoOpen(): boolean {
  return vscode.workspace.getConfiguration('n2f.preview').get<boolean>('autoOpen', false);
}

/** `n2f.preview.theme`, with an unwritable settings file falling back to the toggle. */
function themeSetting(): 'auto' | SvgTheme {
  if (forcedTheme) return forcedTheme;
  const value = vscode.workspace.getConfiguration('n2f.preview').get<string>('theme', 'auto');
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** `auto` means the diagram follows the editor, which is the default. */
function previewTheme(): SvgTheme {
  const setting = themeSetting();
  if (setting !== 'auto') return setting;
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast
    ? 'dark'
    : 'light';
}

/** The title-bar button and any keybinding a user adds point here. */
async function toggleTheme(): Promise<void> {
  const next: SvgTheme = previewTheme() === 'dark' ? 'light' : 'dark';
  try {
    await vscode.workspace
      .getConfiguration('n2f.preview')
      .update('theme', next, vscode.ConfigurationTarget.Global);
  } catch {
    forcedTheme = next;
  }

  // With no panel there is nothing to re-draw: the button lives on a `.n2f`
  // editor's title bar, so the click is asking for the preview as well.
  if (!panel) {
    const editor = activeN2fEditor();
    if (editor) openPreview(editor.document);
    return;
  }
  render();
}

export function deactivate(): void {
  if (timer) clearTimeout(timer);
  panel?.dispose();
  panel = undefined;
}

function activeN2fEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.languageId === LANGUAGE ? editor : undefined;
}

function openPreview(document: vscode.TextDocument): void {
  watching = document;
  if (panel) {
    panel.reveal(undefined, true);
    render();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    'Flowchart Preview',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: false, retainContextWhenHidden: true, localResourceRoots: [] },
  );
  panel.onDidDispose(() => {
    panel = undefined;
    watching = undefined;
    lastGood = undefined;
    if (timer) clearTimeout(timer);
  });
  render();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(render, DEBOUNCE_MS);
}

function render(): void {
  if (!panel || !watching) return;

  const theme = previewTheme();
  const text = watching.getText();
  const result = renderCode(text, theme);

  let stale: RenderPicture | undefined;
  if (result.ok && result.empty) {
    lastGood = undefined;
  } else if (result.ok) {
    const themes: Partial<Record<SvgTheme, RenderPicture>> = {};
    themes[theme] = result;
    lastGood = { text, themes };
  } else {
    stale = lastGoodFor(theme);
  }

  panel.webview.html = previewHtml(result, {
    cspSource: panel.webview.cspSource,
    fileName: fileNameOf(watching.uri),
    theme,
    ...(stale ? { lastGood: stale } : {}),
  });
  panel.title = `Flowchart · ${fileNameOf(watching.uri)}`;
}

/** The dimmed picture under a syntax error, in the palette that is on screen now. */
function lastGoodFor(theme: SvgTheme): RenderPicture | undefined {
  if (!lastGood) return undefined;
  const cached = lastGood.themes[theme];
  if (cached) return cached;
  const picture = renderCode(lastGood.text, theme);
  if (!picture.ok || picture.empty) return undefined;
  lastGood.themes[theme] = picture;
  return picture;
}

function fileNameOf(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? uri.path;
}

/** Menu commands can arrive with a resource, a document or nothing at all. */
function looksLikeUri(value: unknown): value is vscode.Uri {
  const candidate = value as vscode.Uri | undefined;
  return Boolean(candidate && typeof candidate.path === 'string' && typeof candidate.scheme === 'string');
}

/**
 * Nmap `-oX` output to a `.n2f` editor. The result is untitled on purpose: the scan
 * is left untouched and the user decides where the diagram lives.
 */
async function importScan(target?: unknown): Promise<void> {
  const picked = looksLikeUri(target)
    ? target
    : (
        await vscode.window.showOpenDialog({
          title: 'Import an nmap scan',
          openLabel: 'Import',
          canSelectMany: false,
          filters: { 'nmap XML': ['xml'], 'All files': ['*'] },
        })
      )?.[0];
  if (!picked) return;

  const name = fileNameOf(picked);
  const { size } = await vscode.workspace.fs.stat(picked);
  if (size > MAX_SCAN_BYTES) {
    void vscode.window.showErrorMessage(
      `${name} is ${Math.round(size / (1024 * 1024))} MB – too large to import.`,
    );
    return;
  }

  const xml = new TextDecoder().decode(await vscode.workspace.fs.readFile(picked));
  const result = scanToCode(xml, name);
  if (!result.ok) {
    void vscode.window.showErrorMessage(`Nothing imported from ${name}: ${result.error}`);
    return;
  }

  const document = await vscode.workspace.openTextDocument({ language: LANGUAGE, content: result.code });
  await vscode.window.showTextDocument(document, { preview: false });

  if (result.hosts === 0) {
    void vscode.window.showWarningMessage(
      `No hosts in ${name} – the diagram starts empty. Save the file as .n2f to keep it.`,
    );
  } else {
    const hosts = `${result.hosts} host${result.hosts === 1 ? '' : 's'}`;
    const ports = `${result.openPorts} open port${result.openPorts === 1 ? '' : 's'}`;
    void vscode.window.showInformationMessage(
      `Imported ${hosts} · ${ports} from ${name} – save it as a .n2f file.`,
    );
  }

  // The import is only useful if you can see the picture it produced.
  openPreview(document);
}

async function exportSvg(): Promise<void> {
  const editor = activeN2fEditor();
  if (!editor) {
    void vscode.window.showInformationMessage('Open a .n2f diagram to export it.');
    return;
  }

  const result = renderCode(editor.document.getText());
  if (!result.ok) {
    void vscode.window.showErrorMessage(`Nothing exported: line ${result.line} – ${result.error}`);
    return;
  }
  if (result.empty) {
    void vscode.window.showInformationMessage('Nothing to export yet – the diagram is empty.');
    return;
  }

  const base = fileNameOf(editor.document.uri).replace(/\.[^.]+$/, '');
  // An imported diagram has no file yet: a `defaultUri` derived from `untitled:`
  // would name a folder that does not exist, so let the dialog decide.
  const suggested =
    editor.document.uri.scheme === 'file'
      ? editor.document.uri.with({ path: editor.document.uri.path.replace(/\.[^/.]+$/, '.svg') })
      : undefined;
  const target = await vscode.window.showSaveDialog({
    saveLabel: 'Export SVG',
    filters: { 'Scalable Vector Graphics': ['svg'] },
    ...(suggested ? { defaultUri: suggested } : {}),
  });
  if (!target) return;

  await vscode.workspace.fs.writeFile(target, Buffer.from(result.svg, 'utf8'));
  const open = 'Open';
  const choice = await vscode.window.showInformationMessage(`Exported ${base}.svg`, open);
  if (choice === open) await vscode.env.openExternal(target);
}
