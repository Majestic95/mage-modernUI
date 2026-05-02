/**
 * Slice L1 — top bar: back to main menu, settings, sign-out.
 *
 * <p>L8 wires the back button: host gets a close-confirm modal that
 * tears down the table for everyone; guest just vacates their seat.
 */
import { useAuthStore } from '../auth/store';

interface Props {
  /** Called when the user confirms leaving the lobby. */
  onBack?: () => void;
  /** Disabled state while the leave/close request is in flight. */
  backDisabled?: boolean;
  /**
   * Slice L8 review (UX HIGH #6) — when true, sign-out shows a
   * confirm dialog before tearing down the session (hosts in an
   * active lobby would otherwise destroy other players' setups
   * with one misclick).
   */
  signOutNeedsConfirm?: boolean;
}

export function LobbyTopBar({
  onBack,
  backDisabled = false,
  signOutNeedsConfirm = false,
}: Props = {}) {
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);

  const handleSignOut = () => {
    if (signOutNeedsConfirm) {
      // Browser-native confirm — small UX, but matches the
      // existing "Delete table" confirm on the legacy flow.
      const ok = window.confirm(
        "Sign out and leave the lobby? This will close the table for everyone if you're the host.",
      );
      if (!ok) return;
    }
    void logout();
  };

  return (
    <header
      data-testid="lobby-top-bar"
      className="flex items-center justify-between border-b border-card-frame-default/60 px-6 py-3"
      style={{ background: 'rgba(14, 26, 32, 0.55)' }}
    >
      <button
        type="button"
        data-testid="lobby-back-button"
        onClick={onBack}
        disabled={backDisabled}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium uppercase tracking-wider text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
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
        {/* Slice L8 review (UX HIGH #5) — the previous Settings gear
            was a no-op (onClick={() => undefined}) and just confused
            users. Hidden until there's a real destination (app prefs
            / theme / volume). The host-only Edit Settings affordance
            for the lobby itself lives in GameSettingsPanel. */}
        <IconButton
          ariaLabel="Sign out"
          data-testid="lobby-signout-button"
          onClick={handleSignOut}
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
