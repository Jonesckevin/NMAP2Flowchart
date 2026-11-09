import { useEffect, useMemo, useRef, useState } from 'react';

import { useDialogFocus } from '../hooks/useDialogFocus';

export type Command = {
  id: string;
  label: string;
  group: string;
  hint?: string;
  shortcut?: string;
  run: () => void;
  disabled?: boolean;
};

/**
 * Ctrl/Cmd-K: every action that used to hide in a menu, a dock or the layer panel,
 * searchable from the keyboard. Commands are plain callbacks owned by the editor,
 * so the palette cannot drift away from what the UI actually does.
 */
export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogFocus(sectionRef, open);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const available = commands.filter((command) => !command.disabled);
    if (!needle) return available;
    return available.filter((command) =>
      `${command.group} ${command.label} ${command.hint ?? ''}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (active >= matches.length) setActive(0);
  }, [active, matches.length]);

  if (!open) return null;

  const run = (command: Command | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + delta + matches.length) % matches.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      run(matches[active]);
    }
  };

  return (
    <div
      className="dialog-backdrop command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={sectionRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
      >
        <div className="command-palette__search">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.2" />
            <path d="m15.2 15.2 4 4" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette__input"
            placeholder="Type a command…"
            aria-label="Search commands"
            aria-controls="command-list"
            aria-activedescendant={matches[active] ? `command-${matches[active].id}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <kbd className="command-palette__esc">esc</kbd>
        </div>

        <ul className="command-palette__list" id="command-list" role="listbox" aria-label="Commands">
          {matches.length === 0 && <li className="command-palette__empty">No command matches “{query}”.</li>}
          {matches.map((command, index) => (
            <li key={command.id}>
              <button
                id={`command-${command.id}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`command-row${index === active ? ' is-on' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(command)}
              >
                <span className="command-row__group">{command.group}</span>
                <span className="command-row__label">{command.label}</span>
                {command.hint && <span className="command-row__hint">{command.hint}</span>}
                {command.shortcut && <kbd className="command-row__key">{command.shortcut}</kbd>}
              </button>
            </li>
          ))}
        </ul>

        <p className="command-palette__foot">
          <kbd>↑</kbd>
          <kbd>↓</kbd> to move · <kbd>↵</kbd> to run · <kbd>esc</kbd> to close
        </p>
      </section>
    </div>
  );
}
