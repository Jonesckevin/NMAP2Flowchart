import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { colorAtOffset, replaceColor, toHex } from '../code/color';
import { findMatches, nextMatchIndex, replaceAllMatches, replaceMatch } from '../code/find';
import { highlightCode } from '../code/highlight';
import { parseCode } from '../code/dsl';
import { docToCode } from '../code/docToCode';
import { reflowCode, type CodeLayout } from '../code/reflow';
import type { DiagramDoc, Layer } from '../doc/types';

const WIDTH_KEY = 'nmap2flowchart.codePanelWidth';
const FONT_KEY = 'nmap2flowchart.codePanelFont';
const LAYOUT_KEY = 'nmap2flowchart.codePanelLayout';
const PANEL_MIN = 320;
/** A hard stop for very large displays; the window ratio below is the real limit. */
const PANEL_MAX = 2400;
/** …and never past the middle of the window, so the canvas keeps the other half. */
const PANEL_MAX_RATIO = 0.5;
const PANEL_DEFAULT = 430;
const FONT_MIN = 10;
const FONT_MAX = 24;
const FONT_DEFAULT = 12;
const INDENT = '  ';
/** Keystrokes closer together than this undo as one step. */
const TYPING_WINDOW = 600;
const HISTORY_LIMIT = 100;

/** The widest the panel may get right now: the middle of the window, rounded. */
function panelMax(): number {
  return Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(window.innerWidth * PANEL_MAX_RATIO)));
}

function clampWidth(width: number): number {
  return Math.max(PANEL_MIN, Math.min(panelMax(), Math.round(width)));
}

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampWidth(stored);
  } catch {
    // Private mode or blocked storage: fall back to the default width.
  }
  return PANEL_DEFAULT;
}

function readStoredFont(): number {
  try {
    const stored = Number(window.localStorage.getItem(FONT_KEY));
    if (Number.isFinite(stored) && stored >= FONT_MIN && stored <= FONT_MAX) return Math.round(stored);
  } catch {
    // Same as the width: a preference, nothing to recover.
  }
  return FONT_DEFAULT;
}

function readStoredLayout(): CodeLayout {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === 'expanded' ? 'expanded' : 'compact';
  } catch {
    return 'compact';
  }
}

export type ApplyCodeOutcome = { ok: true } | { ok: false; error: string; line?: number };

type CodePanelProps = {
  doc: DiagramDoc;
  layer: Layer | undefined;
  layerId: string;
  /** Commits the code; the editor owns history, so the panel never mutates the doc. */
  onApply: (code: string) => ApplyCodeOutcome;
  onClose: () => void;
};

/** One step of the panel's own undo history. */
type Snapshot = {
  text: string;
  start: number;
  end: number;
  /** The draft belongs to a layer, and so does the history that produced it. */
  layer: string;
};

type History = { past: Snapshot[]; future: Snapshot[] };

const KEYWORDS = [
  'flowchart LR | TB | RL | BT',
  'layer: "Name" color: #4b9fff',
  'risk: Critical = 21, 23 ; High = 445',
  'subgraph id["Title"] cidr: "10.0.0.0/24"',
  'web["Web server"] host: "10.0.0.5" ports: "80/http,443/https"',
  'memo>Note] notes: "free text"',
  'web -->|HTTPS| db',
  'web -.->|backup| db style: dotted arrow: none',
];

/**
 * Code as the structure of one layer, with the editing aids a text editor needs:
 * a numbered gutter, syntax colouring under a transparent textarea, its own undo
 * history, find and replace, a colour picker, a text size and a layout toggle that
 * wraps attributes onto indented continuation lines.
 *
 * The textarea follows the canvas until the user types: `draft` remembers which
 * layer it belongs to, so switching layers shows the new layer's code without an
 * effect. Apply is the only thing that writes back, as one committed step, so undo
 * still means undo.
 */
export function CodePanel({ doc, layer, layerId, onApply, onClose }: CodePanelProps) {
  const [draft, setDraft] = useState<{ layerId: string; text: string } | null>(null);
  const [error, setError] = useState<{ layerId: string; message: string; line?: number } | null>(null);
  const [width, setWidth] = useState(readStoredWidth);
  const [fontSize, setFontSize] = useState(readStoredFont);
  const [layout, setLayout] = useState<CodeLayout>(readStoredLayout);
  const [resizing, setResizing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const [caret, setCaret] = useState(0);
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const lastTyping = useRef(0);
  const lastWasTyping = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const generated = useMemo(() => docToCode(doc, layerId, layout), [doc, layerId, layout]);
  const dirty = draft !== null && draft.layerId === layerId;
  const text = dirty ? draft.text : generated;
  const shownError = error && error.layerId === layerId ? error : null;
  const lines = useMemo(() => highlightCode(text), [text]);
  const activeLine = useMemo(
    () => text.slice(0, Math.min(caret, text.length)).split('\n').length - 1,
    [caret, text],
  );

  useEffect(() => {
    const onResize = () => setWidth((current) => clampWidth(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The colour swatch follows the caret, and the caret can move without a key,
  // a click or a change: Ctrl+A, a drag, an IME. One listener covers them all.
  useEffect(() => {
    const onSelectionChange = () => {
      const area = areaRef.current;
      if (!area || document.activeElement !== area) return;
      setCaret(area.selectionStart);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // A draft belongs to one layer, and so does its undo history: an old layer's
  // steps must never replace the text of the one on screen.
  const canUndo = history.past.length > 0 && history.past[history.past.length - 1].layer === layerId;
  const canRedo = history.future.length > 0 && history.future[history.future.length - 1].layer === layerId;

  const commitWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // Non-fatal: the width just will not survive a reload.
    }
  }, []);

  const changeFont = useCallback((next: number) => {
    const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(next)));
    setFontSize(clamped);
    try {
      window.localStorage.setItem(FONT_KEY, String(clamped));
    } catch {
      // Same: a preference only.
    }
  }, []);

  /** Put the caret somewhere after React has painted the new value. */
  const placeCaret = useCallback((start: number, end = start) => {
    window.requestAnimationFrame(() => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(start, end);
      setCaret(start);
    });
  }, []);

  const currentSnapshot = useCallback((): Snapshot => {
    const area = areaRef.current;
    return {
      text,
      start: area?.selectionStart ?? caret,
      end: area?.selectionEnd ?? caret,
      layer: layerId,
    };
  }, [caret, layerId, text]);

  /** Every text change goes through here, so undo sees all of them. */
  const write = useCallback(
    (next: string, typing = false) => {
      if (next === text) return;
      const now = Date.now();
      // A burst of typing is one undo step; anything discrete starts a new one.
      const coalesce =
        typing &&
        lastWasTyping.current &&
        now - lastTyping.current < TYPING_WINDOW &&
        history.past.length > 0;
      lastTyping.current = now;
      lastWasTyping.current = typing;
      if (!coalesce) {
        const snapshot = currentSnapshot();
        setHistory((value) => ({
          past: [...value.past.slice(-(HISTORY_LIMIT - 1)), snapshot],
          future: [],
        }));
      }
      setDraft({ layerId, text: next });
      setError(null);
    },
    [currentSnapshot, history.past.length, layerId, text],
  );

  const undo = useCallback(() => {
    const previous = history.past[history.past.length - 1];
    if (!previous || previous.layer !== layerId) return;
    setHistory({
      past: history.past.slice(0, -1),
      future: [...history.future.slice(-(HISTORY_LIMIT - 1)), currentSnapshot()],
    });
    setDraft(previous.text === generated ? null : { layerId, text: previous.text });
    setError(null);
    placeCaret(previous.start, previous.end);
  }, [currentSnapshot, generated, history, layerId, placeCaret]);

  const redo = useCallback(() => {
    const next = history.future[history.future.length - 1];
    if (!next || next.layer !== layerId) return;
    setHistory({
      past: [...history.past.slice(-(HISTORY_LIMIT - 1)), currentSnapshot()],
      future: history.future.slice(0, -1),
    });
    setDraft(next.text === generated ? null : { layerId, text: next.text });
    setError(null);
    placeCaret(next.start, next.end);
  }, [currentSnapshot, generated, history, layerId, placeCaret]);

  /** Parsed as it is typed, so a mistake is visible before Apply is pressed. */
  const liveError = useMemo(() => {
    if (!dirty) return null;
    const result = parseCode(text);
    return result.ok ? null : { message: result.error, line: result.line };
  }, [text, dirty]);

  const apply = useCallback(() => {
    const result = onApply(text);
    if (!result.ok) {
      setError({ layerId, message: result.error, ...(result.line ? { line: result.line } : {}) });
      const area = areaRef.current;
      if (area && result.line) {
        const all = text.split('\n');
        const offset = all.slice(0, result.line - 1).join('\n').length + (result.line > 1 ? 1 : 0);
        area.focus();
        area.setSelectionRange(offset, offset + (all[result.line - 1]?.length ?? 0));
      }
      return;
    }
    setError(null);
    setDraft(null);
    setFindOpen(false);
    setHistory({ past: [], future: [] });
  }, [layerId, onApply, text]);

  const revert = useCallback(() => {
    setDraft(null);
    setError(null);
    setHistory({ past: [], future: [] });
  }, []);

  const changeLayout = useCallback(
    (next: CodeLayout) => {
      setLayout(next);
      try {
        window.localStorage.setItem(LAYOUT_KEY, next);
      } catch {
        // A preference only.
      }
      // An edited draft is not regenerated, so reflow it in place instead – it is
      // a textual reformat and works even while the code is mid-edit.
      if (dirty) write(reflowCode(text, next));
    },
    [dirty, text, write],
  );

  // --- find and replace -----------------------------------------------------

  const matches = useMemo(
    () => findMatches(text, query, { caseSensitive, regex: useRegex }),
    [text, query, caseSensitive, useRegex],
  );
  const current = matches.length > 0 ? Math.min(activeMatch, matches.length - 1) : -1;

  const selectMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return;
      const area = areaRef.current;
      const bounded = ((index % matches.length) + matches.length) % matches.length;
      const match = matches[bounded];
      setActiveMatch(bounded);
      if (!area) return;
      area.focus();
      area.setSelectionRange(match.start, match.end);
      setCaret(match.start);
      const line = text.slice(0, match.start).split('\n').length - 1;
      const lineHeight = Number.parseFloat(window.getComputedStyle(area).lineHeight) || fontSize * 1.6;
      area.scrollTop = Math.max(0, line * lineHeight - area.clientHeight / 2 + lineHeight);
    },
    [fontSize, matches, text],
  );

  const openFind = useCallback(() => {
    setFindOpen(true);
    const from = areaRef.current?.selectionStart ?? 0;
    setActiveMatch(nextMatchIndex(matches, from));
    window.setTimeout(() => {
      findRef.current?.focus();
      findRef.current?.select();
    }, 0);
  }, [matches]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(caret, caret);
  }, [caret]);

  const replaceOne = useCallback(() => {
    if (current < 0) return;
    write(
      replaceMatch(text, matches[current], query, { caseSensitive, regex: useRegex }, replacement),
    );
    window.requestAnimationFrame(() => areaRef.current?.focus());
  }, [caseSensitive, current, matches, query, replacement, text, useRegex, write]);

  const replaceEverything = useCallback(() => {
    const result = replaceAllMatches(text, query, { caseSensitive, regex: useRegex }, replacement);
    if (result.count === 0) return;
    write(result.text);
  }, [caseSensitive, query, replacement, text, useRegex, write]);

  // --- editing aids ---------------------------------------------------------

  const indent = useCallback(
    (outdent: boolean) => {
      const area = areaRef.current;
      if (!area) return;
      const { selectionStart: start, selectionEnd: end, value } = area;
      if (start !== end && value.slice(start, end).includes('\n')) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const block = value.slice(lineStart, end);
        const changed = outdent ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, INDENT);
        write(value.slice(0, lineStart) + changed + value.slice(end));
        placeCaret(lineStart, lineStart + changed.length);
        return;
      }
      if (outdent) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lead = /^ {1,2}/.exec(value.slice(lineStart, start));
        if (!lead) return;
        write(value.slice(0, lineStart) + value.slice(lineStart + lead[0].length));
        placeCaret(start - lead[0].length);
        return;
      }
      write(`${value.slice(0, start)}${INDENT}${value.slice(end)}`);
      placeCaret(start + INDENT.length);
    },
    [placeCaret, write],
  );

  const newline = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;
    const { selectionStart: start, selectionEnd: end, value } = area;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const line = value.slice(lineStart, start);
    const lead = /^\s*/.exec(line)?.[0] ?? '';
    // A `subgraph` body starts one level in, so the next line is ready to type.
    const extra = /^\s*subgraph\b/i.test(line) ? INDENT : '';
    const insert = `\n${lead}${extra}`;
    write(value.slice(0, start) + insert + value.slice(end));
    placeCaret(start + insert.length);
  }, [placeCaret, write]);

  const colorTarget = useMemo(() => colorAtOffset(text, caret), [text, caret]);
  const colorHex = colorTarget ? (toHex(colorTarget.value) ?? '#000000') : '#000000';

  const applyColor = useCallback(
    (value: string) => {
      if (!colorTarget) return;
      write(replaceColor(text, colorTarget, value));
      placeCaret(colorTarget.start + value.length);
    },
    [colorTarget, placeCaret, text, write],
  );

  const onEditorKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (event.key === 'y' || event.key === 'Y')) {
        event.preventDefault();
        event.stopPropagation();
        redo();
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        apply();
        return;
      }
      if (mod && (event.key === 'f' || event.key === 'F' || event.key === 'h' || event.key === 'H')) {
        event.preventDefault();
        openFind();
        return;
      }
      if (mod && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        changeFont(fontSize + 1);
        return;
      }
      if (mod && event.key === '-') {
        event.preventDefault();
        changeFont(fontSize - 1);
        return;
      }
      if (mod && event.key === '0') {
        event.preventDefault();
        changeFont(FONT_DEFAULT);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        indent(event.shiftKey);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        newline();
        return;
      }
      if (event.key === 'Escape' && findOpen) {
        event.preventDefault();
        closeFind();
      }
    },
    [
      apply,
      changeFont,
      closeFind,
      findOpen,
      fontSize,
      indent,
      newline,
      openFind,
      redo,
      undo,
    ],
  );

  const onEditorChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      write(event.target.value, true);
      setCaret(event.target.selectionStart);
    },
    [write],
  );

  const syncScroll = useCallback((area: HTMLTextAreaElement) => {
    const pre = preRef.current;
    if (!pre) return;
    pre.scrollTop = area.scrollTop;
    pre.scrollLeft = area.scrollLeft;
  }, []);

  const shown = shownError ?? liveError;
  const nodes = doc.nodes.filter((node) => node.layerId === layerId);
  const expanded = layout === 'expanded';

  return (
    <aside
      className="code-panel"
      style={{ width, ['--code-font-size' as string]: `${fontSize}px` }}
      aria-label="Diagram code"
    >
      <div
        className={`code-panel__resizer${resizing ? ' is-dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the code panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN}
        aria-valuemax={panelMax()}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { startX: event.clientX, startWidth: width };
          setResizing(true);
        }}
        onPointerMove={(event) => {
          const state = drag.current;
          if (!state) return;
          setWidth(clampWidth(state.startWidth - (event.clientX - state.startX)));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          setResizing(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          commitWidth(width);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setResizing(false);
        }}
        onDoubleClick={() => commitWidth(PANEL_DEFAULT)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            commitWidth(width + 16);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            commitWidth(width - 16);
          } else if (event.key === 'Home') {
            event.preventDefault();
            commitWidth(PANEL_DEFAULT);
          }
        }}
      />

      <header className="code-panel__head">
        <div>
          <span className="code-panel__eyebrow" title={layer?.name}>
            Code · {layer?.name ?? 'layer'}
          </span>
          <strong>
            {nodes.length} node{nodes.length === 1 ? '' : 's'} · {lines.length} line
            {lines.length === 1 ? '' : 's'}
          </strong>
        </div>
        <button type="button" className="icon-button" aria-label="Close code panel" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="code-panel__toolbar" role="toolbar" aria-label="Editor tools">
        <button
          type="button"
          className="code-panel__tool"
          aria-label="Smaller text"
          title="Smaller text (Ctrl+-)"
          disabled={fontSize <= FONT_MIN}
          onClick={() => changeFont(fontSize - 1)}
        >
          A−
        </button>
        <span className="code-panel__font" aria-live="polite" title="Editor text size">
          {fontSize}px
        </span>
        <button
          type="button"
          className="code-panel__tool"
          aria-label="Larger text"
          title="Larger text (Ctrl++)"
          disabled={fontSize >= FONT_MAX}
          onClick={() => changeFont(fontSize + 1)}
        >
          A+
        </button>
        <span className="code-panel__tool-sep" aria-hidden="true" />
        <button
          type="button"
          className="code-panel__tool"
          aria-label="Undo code edit"
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={undo}
        >
          ↶
        </button>
        <button
          type="button"
          className="code-panel__tool"
          aria-label="Redo code edit"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={redo}
        >
          ↷
        </button>
        <span className="code-panel__tool-sep" aria-hidden="true" />
        <button
          type="button"
          className={`code-panel__tool${findOpen ? ' is-on' : ''}`}
          aria-pressed={findOpen}
          title="Find and replace (Ctrl+F)"
          onClick={() => (findOpen ? closeFind() : openFind())}
        >
          Find
        </button>
        <button
          type="button"
          className={`code-panel__tool${expanded ? ' is-on' : ''}`}
          aria-pressed={expanded}
          aria-label={expanded ? 'Compact the code' : 'Expand the code'}
          title={
            expanded
              ? 'Put every statement back on one line'
              : 'Wrap attributes onto indented lines'
          }
          onClick={() => changeLayout(expanded ? 'compact' : 'expanded')}
        >
          {expanded ? 'Compact' : 'Expand'}
        </button>
        <label
          className={`code-panel__swatch${colorTarget ? '' : ' is-off'}`}
          title={colorTarget ? `Change ${colorTarget.value}` : 'Put the caret on a colour to edit it'}
        >
          <span
            className="code-panel__swatch-dot"
            style={{ background: colorTarget ? colorHex : 'transparent' }}
          />
          <span className="code-panel__swatch-text">{colorTarget ? colorTarget.value : 'Colour'}</span>
          <input
            type="color"
            value={colorHex}
            disabled={!colorTarget}
            aria-label="Change the colour at the caret"
            onChange={(event) => applyColor(event.target.value)}
          />
        </label>
      </div>

      {findOpen && (
        <div className="code-panel__find">
          <div className="code-panel__find-row">
            <input
              ref={findRef}
              className="code-panel__find-input"
              value={query}
              placeholder="Find"
              aria-label="Find in code"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveMatch(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  selectMatch(current + (event.shiftKey ? -1 : 1));
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFind();
                }
              }}
            />
            <span className="code-panel__find-count" aria-live="polite">
              {matches.length === 0 ? '0/0' : `${current + 1}/${matches.length}`}
            </span>
            <button
              type="button"
              className="code-panel__tool"
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
              disabled={matches.length === 0}
              onClick={() => selectMatch(current - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="code-panel__tool"
              aria-label="Next match"
              title="Next match (Enter)"
              disabled={matches.length === 0}
              onClick={() => selectMatch(current + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={`code-panel__tool${caseSensitive ? ' is-on' : ''}`}
              aria-pressed={caseSensitive}
              title="Match case"
              onClick={() => setCaseSensitive((value) => !value)}
            >
              Aa
            </button>
            <button
              type="button"
              className={`code-panel__tool${useRegex ? ' is-on' : ''}`}
              aria-pressed={useRegex}
              title="Regular expression"
              onClick={() => setUseRegex((value) => !value)}
            >
              .*
            </button>
            <button
              type="button"
              className="code-panel__tool"
              aria-label="Close find"
              title="Close find (Escape)"
              onClick={closeFind}
            >
              ×
            </button>
          </div>
          <div className="code-panel__find-row">
            <input
              className="code-panel__find-input"
              value={replacement}
              placeholder="Replace with"
              aria-label="Replace with"
              spellCheck={false}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  replaceOne();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeFind();
                }
              }}
            />
            <button
              type="button"
              className="code-panel__tool"
              disabled={current < 0}
              title="Replace this match"
              onClick={replaceOne}
            >
              Replace
            </button>
            <button
              type="button"
              className="code-panel__tool"
              disabled={matches.length === 0}
              title="Replace every match"
              onClick={replaceEverything}
            >
              All
            </button>
          </div>
        </div>
      )}

      <div className="code-panel__editor">
        <pre className="code-panel__highlight" aria-hidden="true" ref={preRef}>
          {lines.map((tokens, index) => (
            <span
              key={index}
              className={`code-line${index === activeLine ? ' is-active' : ''}`}
              data-line={index + 1}
            >
              {tokens.map((token, at) => (
                <span
                  key={at}
                  className={`tk-${token.kind}`}
                  style={token.kind === 'color' ? { boxShadow: `inset 0 -2px 0 ${token.text}` } : undefined}
                >
                  {token.text}
                </span>
              ))}
              {tokens.length === 0 ? '\u200b' : null}
            </span>
          ))}
        </pre>
        <textarea
          ref={areaRef}
          className="code-panel__area"
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="soft"
          aria-label={`Code for layer ${layer?.name ?? ''}`}
          onChange={onEditorChange}
          onKeyDown={onEditorKeyDown}
          onSelect={() => setCaret(areaRef.current?.selectionStart ?? 0)}
          onClick={() => setCaret(areaRef.current?.selectionStart ?? 0)}
          onKeyUp={() => setCaret(areaRef.current?.selectionStart ?? 0)}
          onScroll={(event) => syncScroll(event.currentTarget)}
        />
      </div>

      {shown && (
        <p className="code-panel__error" role="alert">
          {shown.line ? <b>Line {shown.line}: </b> : null}
          {shown.message}
        </p>
      )}

      <div className="code-panel__actions">
        <button type="button" className="btn btn--accent btn--tiny" onClick={apply}>
          Apply
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--tiny"
          onClick={revert}
          disabled={!dirty}
          title="Discard the edits and follow the canvas again"
        >
          Revert
        </button>
        <button
          type="button"
          className={`btn btn--ghost btn--tiny code-panel__help-toggle${helpOpen ? ' is-on' : ''}`}
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
        >
          Syntax
        </button>
        <span className="code-panel__state">{dirty ? 'edited' : 'following the canvas'}</span>
      </div>

      {helpOpen && (
        <div className="code-panel__help">
          <p>
            Edit this layer in code and press <b>Apply</b> (Ctrl+Enter) to rebuild it. Nodes, sections,
            notes, connections, host details and risk levels round-trip; positions are laid out
            automatically and centred where the layer was.
          </p>
          <ul>
            {KEYWORDS.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
          <p className="code-panel__help-note">
            A node id is a name you choose. <code>#</code> and <code>%%</code> start a comment.{' '}
            <code>risk:</code> describes levels for the whole diagram, not just this layer. An indented
            <code> key: value</code> line continues the statement above it, so a node can spread over
            several lines – <b>Expand</b> and <b>Compact</b> switch between the two shapes. Undo is
            Ctrl+Z (Ctrl+Shift+Z redoes), Find is Ctrl+F, Tab indents and Ctrl with +/− resizes the
            text.
          </p>
        </div>
      )}
    </aside>
  );
}
