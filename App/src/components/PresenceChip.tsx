import { useEffect, useState } from 'react';

import type { SharedLive, SharedUser } from '../shared/live';

type PresenceChipProps = {
  live: SharedLive;
  users: SharedUser[];
  status: 'connecting' | 'live' | 'offline';
};

function since(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/**
 * Who is on this server right now. The chip doubles as the rename control: the
 * name a visitor picks is the name their pointer shows for everyone else.
 */
export function PresenceChip({ live, users, status }: PresenceChipProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? live.name;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const label = status === 'offline' ? 'Reconnecting' : status === 'connecting' ? 'Connecting' : 'Live';

  return (
    <div className="presence">
      <button
        type="button"
        className={`presence__chip presence__chip--${status}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${users.length} ${users.length === 1 ? 'person' : 'people'} on this server`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="presence__dots" aria-hidden="true">
          {users.slice(0, 3).map((user) => (
            <i key={user.id} style={{ background: user.color }} />
          ))}
        </span>
        {label}
        <b>{users.length}</b>
      </button>

      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="presence__panel" role="dialog" aria-label="People on this server" >
            <div className="presence__head">
              <span>On this server</span>
              <b>{users.length}</b>
            </div>
            <ul className="presence__list">
              {users.map((user) => (
                <li key={user.id} className={user.id === live.id ? 'is-self' : ''}>
                  <i style={{ background: user.color }} />
                  <span className="presence__name">
                    {user.name}
                    {user.id === live.id && <em>you</em>}
                  </span>
                  <span className="presence__meta">
                    {user.address || 'local'}
                    <b>{since(user.since)}</b>
                  </span>
                </li>
              ))}
            </ul>
            <label className="presence__rename">
              <span>Your name</span>
              <input
                className="input input--compact"
                value={name}
                maxLength={40}
                placeholder={live.name}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void live.rename(name);
                    setOpen(false);
                  }
                }}
                onBlur={() => { void live.rename(name); setDraft(null); }}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
