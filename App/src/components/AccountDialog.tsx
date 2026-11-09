import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DiagramDoc } from '../doc/types';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { AccountController } from '../account/useAccount';
import type { ProjectDetail, ProjectSummary } from '../account/types';

type AccountDialogProps = {
  account: AccountController;
  open: boolean;
  onClose: () => void;
  doc: DiagramDoc | null;
  onOpenProject: (project: ProjectDetail) => void;
  /** Opens the share dialog for a project without switching the editor to it. */
  onShareProject: (project: ProjectSummary) => void;
};

function projectNameFromDoc(doc: DiagramDoc | null): string {
  const name = (doc?.fileName ?? '').replace(/\.[^.]+$/, '').trim();
  return name || 'Untitled project';
}

function formatWhen(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function Feedback({ account }: { account: AccountController }) {
  if (account.error) {
    return (
      <p className="account-message account-message--error" role="alert">
        {account.error}
      </p>
    );
  }
  if (account.notice) {
    return (
      <p className="account-message" role="status">
        {account.notice}
      </p>
    );
  }
  return null;
}

function AuthForm({ account, onClose }: { account: AccountController; onClose: () => void }) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const registering = mode === 'register' && account.features.registrationEnabled;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (account.busy || !username.trim() || !password) return;
    if (registering) await account.register(username, password);
    else await account.signIn(username, password);
    setPassword('');
  };

  return (
    <div className="account-auth">
      {account.features.registrationEnabled && (
        <div className="account-tabs" role="tablist" aria-label="Account access">
          <button
            type="button"
            role="tab"
            aria-selected={!registering}
            className={`account-tab${!registering ? ' is-on' : ''}`}
            onClick={() => {
              setMode('signin');
              account.clearFeedback();
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={registering}
            className={`account-tab${registering ? ' is-on' : ''}`}
            onClick={() => {
              setMode('register');
              account.clearFeedback();
            }}
          >
            Create account
          </button>
        </div>
      )}

      <form className="account-form" onSubmit={(event) => void submit(event)}>
        <label className="account-field">
          <span>Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            spellCheck={false}
            minLength={3}
            maxLength={32}
            required
          />
        </label>
        <label className="account-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? 12 : 1}
            maxLength={128}
            required
          />
        </label>
        {registering && (
          <p className="account-hint">
            At least 12 characters, including an upper-case letter, a lower-case letter and a number.
          </p>
        )}
        <Feedback account={account} />
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Not now
          </button>
          <button type="submit" className="btn btn--accent" disabled={account.busy || !username.trim() || !password}>
            {account.busy ? 'Working…' : registering ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>

      {account.features.guestLoginEnabled && (
        <div className="account-guest">
          <div>
            <strong>Just looking?</strong>
            <span>
              Continue as a guest to save projects. Guest accounts and their diagrams are deleted after{' '}
              {account.features.guestTtlHours} hour{account.features.guestTtlHours === 1 ? '' : 's'}.
            </span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={account.busy}
            onClick={() => void account.continueAsGuest()}
          >
            Continue as guest
          </button>
        </div>
      )}

      <p className="account-hint account-hint--foot">
        Without an account everything stays in this browser. Signing in uploads diagrams to this server so
        you can switch between projects and machines.
      </p>
    </div>
  );
}

function ProjectRow({
  project,
  active,
  busy,
  onOpen,
  onShare,
  onRename,
  onDelete,
}: {
  project: ProjectSummary;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  onShare: () => void;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project.name);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className={`project-row${active ? ' is-active' : ''}`}>
      <div className="project-row__head">
        <button type="button" className="project-row__main" onClick={onOpen} disabled={busy} title="Open this project">
          <span className="project-row__name">{project.name}</span>
          <span className="project-row__meta">
            {project.nodeCount} node{project.nodeCount === 1 ? '' : 's'} · {project.edgeCount} connection
            {project.edgeCount === 1 ? '' : 's'} · updated {formatWhen(project.updatedAt)}
          </span>
        </button>
        <div className="project-row__actions">
          {active && <span className="project-row__badge">open</span>}
          {project.share && (
            <span className="project-row__badge project-row__badge--share" title="This project has a share link">
              {project.share.mode === 'view' ? 'link · view' : 'link · live'}
            </span>
          )}
          {!active && (
            <button
              type="button"
              className="project-row__action project-row__action--open"
              disabled={busy}
              title={`Open “${project.name}”`}
              onClick={onOpen}
            >
              Open
            </button>
          )}
          <button
            type="button"
            className="project-row__action"
            disabled={busy}
            title={`Share “${project.name}” with a link`}
            onClick={onShare}
          >
            Share
          </button>
          <button
            type="button"
            className="project-row__action"
            disabled={busy || renaming}
            onClick={() => {
              setName(project.name);
              setRenaming(true);
              setConfirming(false);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="project-row__action is-danger"
            disabled={busy || confirming}
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        </div>
      </div>

      {renaming && (
        <form
          className="project-row__inline"
          onSubmit={(event) => {
            event.preventDefault();
            void onRename(name).then((ok) => {
              if (ok) setRenaming(false);
            });
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={`New name for ${project.name}`}
            maxLength={80}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setName(project.name);
                setRenaming(false);
              }
            }}
          />
          <button type="submit" className="btn btn--accent" disabled={busy || !name.trim()}>
            Save
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setName(project.name);
              setRenaming(false);
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {confirming && (
        <div className="project-row__inline">
          <span className="project-row__confirm">Delete “{project.name}” and its diagram permanently?</span>
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => void onDelete().then(() => setConfirming(false))}
          >
            Delete
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function ProjectsView({
  account,
  doc,
  onOpenProject,
  onShareProject,
  onClose,
}: {
  account: AccountController;
  doc: DiagramDoc | null;
  onOpenProject: (project: ProjectDetail) => void;
  onShareProject: (project: ProjectSummary) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const startCreate = () => {
    setName(projectNameFromDoc(doc));
    setCreating(true);
    account.clearFeedback();
  };

  const create = async () => {
    if (!doc) return;
    const created = await account.createProject(name, doc);
    if (created) setCreating(false);
  };

  const open = async (project: ProjectSummary) => {
    const detail = await account.openProject(project.id);
    if (detail) onOpenProject(detail);
  };

  const user = account.user!;

  return (
    <div className="account-projects">
      <div className="account-identity">
        <div className="account-identity__who">
          <span className="account-identity__name">{user.username}</span>
          <span className={`account-role${user.isGuest ? ' is-guest' : ''}`}>
            {user.isGuest ? 'Guest' : user.role === 'admin' ? 'Admin' : 'Account'}
          </span>
        </div>
        <div className="account-identity__actions">
          <button type="button" className="btn btn--ghost" disabled={account.busy} onClick={() => void account.refreshProjects()}>
            Refresh
          </button>
          <button type="button" className="btn btn--ghost" disabled={account.busy} onClick={() => void account.signOut()}>
            Sign out
          </button>
        </div>
      </div>

      <div className="account-projects__head">
        <div>
          <h3>Projects</h3>
          <span className="account-projects__hint">
            {account.activeProject
              ? `Saving to “${account.activeProject.name}” as you edit – open another project below to switch.`
              : 'Open a project to keep it in sync, or save the diagram you have open now.'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--accent"
          disabled={!doc || account.busy || creating}
          title={doc ? 'Save the open diagram as a new project' : 'Import a scan or create a diagram first'}
          onClick={startCreate}
        >
          {account.activeProjectId ? 'Save as new project' : 'Save current diagram'}
        </button>
      </div>

      {creating && doc && (
        <form
          className="account-create"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="New project name"
            placeholder="Project name"
            maxLength={80}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setCreating(false);
              }
            }}
          />
          <button type="submit" className="btn btn--accent" disabled={account.busy || !name.trim()}>
            Create
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      <Feedback account={account} />

      {account.projects.length === 0 ? (
        <p className="account-empty">
          {account.busy ? 'Loading projects…' : 'No projects yet. Save the diagram you have open to start one.'}
        </p>
      ) : (
        <ul className="project-list">
          {account.projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              active={project.id === account.activeProjectId}
              busy={account.busy}
              onOpen={() => void open(project)}
              onShare={() => onShareProject(project)}
              onRename={(next) => account.renameProject(project.id, next)}
              onDelete={() => account.deleteProject(project.id)}
            />
          ))}
        </ul>
      )}

      {user.isGuest && (
        <p className="account-hint account-hint--foot">
          Guest projects live for {account.features.guestTtlHours} hours. Create an account before signing out to
          keep them.
        </p>
      )}

      <div className="dialog__actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export function AccountDialog({ account, open, onClose, doc, onOpenProject, onShareProject }: AccountDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, open);
  const closeRef = useRef(onClose);
  const clearFeedback = account.clearFeedback;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    clearFeedback();
    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      (dialog.querySelector<HTMLElement>('input, textarea') ?? dialog.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, clearFeedback]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = [
            ...(dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? []),
          ];
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="dialog__header">
          <div>
            <span className="account-eyebrow">{account.features.authEnabled ? 'Account' : 'Browser only'}</span>
            <h2 id="account-title">{account.user ? 'Projects' : 'Save your diagrams'}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close account dialog" onClick={onClose}>
            ×
          </button>
        </div>

        {account.user ? (
          <ProjectsView account={account} doc={doc} onOpenProject={onOpenProject} onShareProject={onShareProject} onClose={onClose} />
        ) : (
          <AuthForm account={account} onClose={onClose} />
        )}
      </section>
    </div>,
    document.body,
  );
}
