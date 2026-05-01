import { useGameStore } from '../store';
import { renderUpstreamMarkup } from './markupRenderer';
import type { GameStream } from '../stream';

/**
 * Slice 70-Y.3 (2026-05-01) — bottom-center banner for mana payment
 * dialogs. Replaces the bottom-right side panel that ManaPayPanel
 * rendered through GameDialog. Per the picture-catalog §6
 * click-resolution principle: the user pays mana by clicking mana
 * sources on the battlefield OR mana orbs in their pool (slice
 * 70-X.10). The banner only shows the cost text + actions — it
 * doesn't block the board.
 *
 * <p>Engine semantics (verified via MTG rules expert agent against
 * HumanPlayer.java:1576-1624 + ManaCostsImpl.java:166-204):
 * <ul>
 *   <li><b>gamePlayMana</b>: engine fires this each time the cost
 *     is unpaid. Click a mana source / orb → engine consumes one
 *     mana toward the cost → re-fires gamePlayMana with updated
 *     message until cost is paid. Cancel → boolean false → rollback
 *     the partial cast (ManaCostsImpl.payOrRollback restoreState).</li>
 *   <li><b>"Special" button</b>: convoke / improvise / delve. Sends
 *     {@code playerResponse{kind:'string', value:'special'}} →
 *     engine opens the special-action menu via
 *     activateSpecialAction (HumanPlayer.java:2244+). Existing
 *     ManaPayPanel lacked this entirely — convoke decks were
 *     unplayable. Banner fixes that gap.</li>
 * </ul>
 *
 * <p><b>X-cost spells:</b> X is announced via {@code announceX}
 * (HumanPlayer.java:1658+) which fires {@code fireGetAmountEvent}
 * — a numeric prompt routed to {@link AmountDialog}, NOT this
 * banner. After X is set, the regular gamePlayMana loop pays the
 * generic cost (which DOES route here). The wire method
 * {@code gamePlayXMana} is dispatched the same way as gamePlayMana
 * for the post-X payment loop.
 *
 * <p>The current ManaPayPanel had a "Done" button on isXMana that
 * sent {@code boolean:false} — per the rules-expert audit this is
 * almost certainly a latent bug (announceX accepts only Integer
 * via getInteger() at HumanPlayer.java:1676; boolean cancel during
 * X announcement is a no-op on the server). The new banner does
 * NOT carry this "Done" path forward; X commits via AmountDialog.
 *
 * <p>Phyrexian mana ({W/P}) is NOT a banner concern — it fires as
 * a separate {@code chooseUse} (gameAsk yes/no "Pay 2 life instead
 * of {R}?") BEFORE the mana-pay loop, handled by YesNoDialog.
 *
 * <p>Hybrid mana ({2/W}, {U/B}) auto-picks the first option in
 * declaration order without prompting (HybridManaCost.java:44).
 * If the player wants the other half, they must click the orb in
 * the floating pool to pre-pay manually before the auto-pay locks
 * in. (Server-side enhancement deferred — out of scope.)
 *
 * <p>Position: bottom-center fixed. pointer-events scoped so the
 * board stays clickable everywhere except the banner itself.
 */
interface ManaPayBannerProps {
  stream: GameStream | null;
}

export function ManaPayBanner({ stream }: ManaPayBannerProps) {
  const dialog = useGameStore((s) => s.pendingDialog);
  const clearDialog = useGameStore((s) => s.clearDialog);

  // Defensive: this component should only mount when pendingDialog
  // is gamePlayMana / gamePlayXMana (gated by GameDialog's branch).
  // Render nothing if state has cleared mid-render.
  if (!dialog) return null;
  if (
    dialog.method !== 'gamePlayMana' &&
    dialog.method !== 'gamePlayXMana'
  ) {
    return null;
  }
  // Type narrowing — gameChooseAbility is the other dialog shape;
  // mana-pay frames are always WebGameClientMessage shape.
  const data = 'cardsView1' in dialog.data ? dialog.data : null;
  if (!data) return null;

  // Read messageId at click time for both senders — engine fires
  // fresh frames as mana is paid; imperative read avoids stale-id
  // staleness (same pattern as ManaPayPanel.send).
  const cancel = () => {
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, 'boolean', false);
    clearDialog();
  };
  const requestSpecial = () => {
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    // Engine reads response.getString() === "special" at
    // HumanPlayer.java:1607 → activateSpecialAction opens the
    // special-action choice menu (Convoke / Improvise / Delve /
    // etc.) via fireGetChoiceEvent → ChoiceDialog.
    stream?.sendPlayerResponse(mid, 'string', 'special');
    // Don't clear locally — engine fires a fresh frame.
  };

  return (
    <div
      // Fixed positioner; stays out of click flow except for the
      // inner banner. Same shape as DialogBanner.
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 z-40"
      style={{ bottom: 'calc(var(--hand-area-height, 180px) + 16px)' }}
      data-testid="mana-pay-banner-positioner"
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="mana-pay-banner"
        className={
          'pointer-events-auto inline-flex items-center gap-3 rounded-lg ' +
          'bg-zinc-900/95 border border-amber-500/50 shadow-xl ' +
          'px-4 py-2 text-zinc-100 backdrop-blur-sm'
        }
      >
        <span
          className="text-xs uppercase tracking-wider text-amber-300 font-semibold"
          data-testid="mana-pay-banner-title"
        >
          Pay
        </span>
        <span className="text-sm" data-testid="mana-pay-banner-message">
          {renderUpstreamMarkup(data.message ?? '')}
        </span>
        <span className="text-xs text-zinc-500 italic">
          Click a mana source or pool orb
        </span>
        {/* Special: convoke / improvise / delve. Always available
            during mana pay — engine returns an empty menu via
            ChoiceDialog if no special actions apply, which is mildly
            ugly UX but server-correct. A future wire-format addition
            could surface "specials available" so we conditionally
            render this; out of scope for 70-Y.3. */}
        <button
          type="button"
          onClick={requestSpecial}
          data-testid="mana-pay-banner-special"
          title="Convoke / Improvise / Delve"
          className="px-3 py-1 rounded text-sm bg-amber-700/40 hover:bg-amber-700/70 text-amber-200 border border-amber-700/50 transition"
        >
          Special…
        </button>
        <button
          type="button"
          onClick={cancel}
          data-testid="mana-pay-banner-cancel"
          className="px-3 py-1 rounded text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
