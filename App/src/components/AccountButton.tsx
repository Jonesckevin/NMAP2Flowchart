import type { AccountController } from '../account/useAccount';

export function AccountButton({ account, onOpen }: { account: AccountController; onOpen: () => void }) {
  if (!account.ready || !account.features.authEnabled) return null;

  const signedIn = account.user !== null;
  const tone = !signedIn
    ? 'anonymous'
    : account.saveState === 'saving'
      ? 'saving'
      : account.saveState === 'error'
        ? 'error'
        : 'saved';
  const project = account.activeProject?.name;

  return (
    <button
      type="button"
      className={`account-chip account-chip--${tone}`}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={signedIn ? `Account and projects – ${account.user!.username}` : 'Sign in or continue as a guest'}
      title={
        signedIn
          ? `${account.user!.username} · ${project ?? 'no project open'} – open the project list`
          : 'Sign in or continue as a guest'
      }
    >
      <svg
        className="account-chip__icon"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
      </svg>
      <span className="account-chip__name">{signedIn ? account.user!.username : 'Sign in'}</span>
      {signedIn && project && <span className="account-chip__project">{project}</span>}
      {signedIn && <span className="account-chip__caret" aria-hidden="true">▾</span>}
      <span className="account-chip__dot" aria-hidden="true" />
    </button>
  );
}
