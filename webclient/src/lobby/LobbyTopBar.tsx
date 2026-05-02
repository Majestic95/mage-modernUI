/**
 * Slice L1 — top bar: back to main menu, settings, sign-out.
 *
 * <p>L1 ships visual chrome only. Slice L8 wires the back button to
 * the host-confirm / leave-seat flow.
 */
import { useAuthStore } from '../auth/store';

export function LobbyTopBar() {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);

  return (
    <header
      data-testid="lobby-top-bar"
      className="flex items-center justify-between border-b border-card-frame-default/60 px-6 py-3"
      style={{ background: 'rgba(14, 26, 32, 0.55)' }}
    >
      <button
        type="button"
        data-testid="lobby-back-button"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium uppercase tracking-wider text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary"
      >
        <BackChevron />
        <span>Lobby</span>
      </button>

      <div className="flex items-center gap-2">
        {session && (
          <span className="mr-2 text-sm text-text-secondary">
            {session.username}
          </span>
        )}
        <IconButton
          ariaLabel="Settings"
          data-testid="lobby-settings-button"
          onClick={() => undefined}
        >
          <GearIcon />
        </IconButton>
        <IconButton
          ariaLabel="Sign out"
          data-testid="lobby-signout-button"
          onClick={() => void logout()}
        >
          <SignOutIcon />
        </IconButton>
      </div>
    </header>
  );
}

function IconButton({
  children,
  ariaLabel,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  ariaLabel: string;
  onClick: () => void;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      {...rest}
      className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}

function BackChevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="10,3 5,8 10,13" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16,17 21,12 16,7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
