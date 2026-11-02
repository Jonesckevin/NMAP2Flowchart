import { useMemo, useState } from 'react';
import { ICONS } from '../icons/registry';
import { NodeIcon } from '../icons/NodeIcon';

export function IconPicker({
  value,
  onPick,
  onClose,
}: {
  value?: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = needle ? ICONS.filter((icon) => icon.label.toLowerCase().includes(needle)) : ICONS;
    return [
      { title: 'Devices', items: shown.filter((icon) => icon.group === 'device') },
      { title: 'Network & topologies', items: shown.filter((icon) => icon.group === 'net') },
      { title: 'Flowchart', items: shown.filter((icon) => icon.group === 'flow') },
      { title: 'Operating systems & platforms', items: shown.filter((icon) => icon.group === 'os') },
    ].filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="icon-picker" role="dialog" aria-label="Choose icon">
        <input
          autoFocus
          className="icon-picker__search"
          placeholder="Search icons…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
        <div className="icon-picker__scroll">
          {groups.map((group) => (
            <section key={group.title}>
              <h4>{group.title}</h4>
              <div className="icon-picker__grid">
                {group.items.map((icon) => (
                  <button
                    key={icon.id}
                    type="button"
                    className={`icon-picker__item${icon.id === value ? ' is-active' : ''}`}
                    title={icon.label}
                    onClick={() => {
                      onPick(icon.id);
                      onClose();
                    }}
                  >
                    <NodeIcon id={icon.id} size={22} />
                    <span>{icon.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="icon-picker__empty">No icon matches “{query}”.</p>}
        </div>
      </div>
    </>
  );
}
