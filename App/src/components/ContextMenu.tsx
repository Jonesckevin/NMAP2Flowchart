export type MenuEntry =
  | 'separator'
  | {
      label: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
    };

type ContextMenuProps = {
  x: number;
  y: number;
  title?: string;
  entries: MenuEntry[];
  onClose: () => void;
};

const MENU_WIDTH = 212;
const ITEM_HEIGHT = 31;

export function ContextMenu({ x, y, title, entries, onClose }: ContextMenuProps) {
  const height = entries.length * ITEM_HEIGHT + (title ? 28 : 12);
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  return (
    <>
      <div
        className="context-menu__scrim"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="context-menu"
        role="menu"
        style={{ left, top, width: MENU_WIDTH }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {title && <div className="context-menu__title">{title}</div>}
        {entries.map((entry, index) =>
          entry === 'separator' ? (
            <div key={`sep-${index}`} className="context-menu__sep" />
          ) : (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              className={`context-menu__item${entry.danger ? ' is-danger' : ''}`}
              disabled={entry.disabled}
              onClick={() => {
                entry.onSelect();
                onClose();
              }}
            >
              {entry.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}
