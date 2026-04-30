import { useRef, useState } from 'react';
import { useModalA11y } from '../util/useModalA11y';

/**
 * Slice 70-O (picture-catalog §1.3) — settings modal launched from
 * the header gear icon. Hosts the relocated **Concede** action
 * (with confirmation step) and **Leave game** action that the
 * legacy header bar previously surfaced as inline text buttons.
 *
 * <p><b>Why a modal vs an inline menu?</b> Both Concede and Leave
 * are destructive / irreversible at the lobby level (Leave drops
 * the user out of the table; Concede ends the game). A modal puts
 * a deliberate gesture between hover-click and effect, mirroring
 * the slice 37 ConfirmConcedeModal pattern. Settings is also the
 * future home for theme toggle, animation toggle, accessibility
 * toggles, etc. — slot in once feature requests land.
 *
 * <p>Concede uses a two-step inline confirmation rather than nesting
 * a second modal. The first click reveals a "Yes, concede" /
 * "Cancel" pair in place of the Concede button; submission fires
 * the engine action and closes the settings modal entirely. Same
 * irreversible-action UX the legacy {@code ConfirmConcedeModal}
 * uses, just collapsed into the parent dialog.
 *
 * <p>Reuses {@link useModalA11y} for focus trap + Esc-to-close +
 * focus restoration on unmount.
 */
export function SettingsModal({
  onClose,
  onConcede,
  onLeave,
}: {
  /** Backdrop click / Esc / Cancel button. */
  onClose: () => void;
  /**
   * Called when the user confirms concede. Implementations send the
   * engine {@code CONCEDE} action; this component just handles the
   * confirm gesture and closes the dialog.
   */
  onConcede: () => void;
  /**
   * Called when the user clicks Leave game. Implementations route
   * to the lobby; this component just dispatches and closes the
   * dialog.
   */
  onLeave: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  // Two-step concede gesture. confirmingConcede=true swaps the
  // single Concede button for a Yes-cancel pair (mirrors the slice
  // 37 modal flow but inline, since the parent modal IS the
  // dialog).
  const [confirmingConcede, setConfirmingConcede] = useState(false);

  return (
    <div
      data-testid="settings-modal-root"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        data-testid="settings-modal-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Game settings"
        data-testid="settings-modal"
        className="relative bg-bg-elevated border border-zinc-800 rounded-lg shadow-2xl p-5 w-[min(90vw,400px)] space-y-4"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            Settings
          </h2>
          <button
            type="button"
            data-testid="settings-modal-close"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-lg leading-none"
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <p className="text-xs text-text-secondary">
          Theme, animation, and accessibility toggles will appear here
          in a future update. For now the panel hosts game-level
          actions.
        </p>

        <div className="border-t border-zinc-800 pt-4 space-y-3">
          {/* Concede — two-step confirm to prevent stray clicks
              ending the match. Same UX contract as the legacy
              ConfirmConcedeModal (slice 37). Concede is the
              dominant red button; Leave (below) is visually
              demoted to a small grey link so the two destructive
              gestures don't read as peers (UI/UX critic I3:
              Concede is irreversible, Leave is recoverable —
              hierarchy should reflect that). */}
          {!confirmingConcede ? (
            <button
              type="button"
              data-testid="settings-concede-button"
              onClick={() => setConfirmingConcede(true)}
              className="w-full px-3 py-2 rounded text-sm bg-red-900/40 hover:bg-red-800/60 text-red-200 border border-red-900/60"
            >
              Concede game
            </button>
          ) : (
            <div
              data-testid="settings-concede-confirm"
              className="space-y-2"
            >
              <p className="text-xs text-zinc-300">
                Concede ends the current game immediately. The match
                continues if more games remain.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="settings-concede-cancel"
                  onClick={() => setConfirmingConcede(false)}
                  // Slice 70-O Tech critic N5 — autoFocus the
                  // safer (non-destructive) button when the
                  // confirm pair appears, so keyboard users land
                  // on Cancel rather than the now-unmounted
                  // Concede trigger (which would fall through to
                  // body).
                  autoFocus
                  className="flex-1 px-3 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="settings-concede-confirm-yes"
                  onClick={() => {
                    onConcede();
                    setConfirmingConcede(false);
                    onClose();
                  }}
                  className="flex-1 px-3 py-1.5 rounded text-xs bg-red-700 hover:bg-red-600 text-white border border-red-800"
                >
                  Yes, concede
                </button>
              </div>
            </div>
          )}

          {/* Leave game — exits the table without conceding (engine
              keeps the seat for reconnect). UI/UX critic I3 fix —
              demoted from a peer-weight button to a centered link
              so the asymmetry between irreversible (Concede, red)
              and recoverable (Leave, link) reads at a glance. No
              two-step confirm: the engine recovery makes a single-
              click acceptable cost-vs-friction. */}
          <button
            type="button"
            data-testid="settings-leave-button"
            onClick={() => {
              onLeave();
              onClose();
            }}
            className="w-full text-center text-xs text-text-secondary hover:text-text-primary underline-offset-4 hover:underline"
          >
            Leave game
          </button>
        </div>
      </div>
    </div>
  );
}
