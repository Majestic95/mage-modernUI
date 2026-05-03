import { useDraggable } from '../../util/useDraggable';
import { useGameStore } from '../store';
import { BannerSpotlightHalo } from './BannerSpotlightHalo';
import { renderUpstreamMarkup } from './markupRenderer';
import type { GameStream } from '../stream';

/**
 * Slice 70-Y.4 (2026-05-01) — bottom-center banner for declare-
 * attackers + declare-blockers. Replaces the bottom-right side
 * panel that CombatPanel rendered through GameDialog. Per the
 * picture-catalog §6 click-resolution principle: the user toggles
 * attackers/blockers by clicking creatures on the board (already
 * wired in clickRouter.ts as the 'declareAttackers' / 'declareBlockers'
 * modes). Banner only shows the prompt + Done button (+ "All attack"
 * for declare-attackers when applicable).
 *
 * <p>Engine semantics validated via MTG rules expert agent against
 * HumanPlayer.java:1786-2124 + CombatGroup.java:281-318:
 *
 * <ul>
 *   <li><b>Declare attackers</b> (gameSelect with POSSIBLE_ATTACKERS):
 *     each board click toggles attack state via
 *     selectAttackers/selectDefender. Multi-defender → engine fires
 *     a follow-up gameTarget (TargetDefender) that swaps pendingDialog
 *     mid-declaration; the gameTarget banner takes over for the
 *     defender pick, then declare-attackers banner re-mounts.</li>
 *   <li><b>All attack</b> button: dispatches
 *     {@code playerResponse{kind:'string', value:'special'}}; engine
 *     handles the all-attack branch + multi-defender pick.</li>
 *   <li><b>Done</b>: dispatches
 *     {@code playerResponse{kind:'boolean', value:true}} — engine
 *     calls checkIfAttackersValid; if valid, combat commits.</li>
 *   <li><b>No Cancel</b>: per the rules-expert audit, boolean false
 *     hits the same checkIfAttackersValid branch as true. Rendering
 *     a "Cancel" that's actually a "Done" is misleading.</li>
 *   <li><b>Declare blockers</b> (gameSelect with POSSIBLE_BLOCKERS):
 *     same shape — board clicks toggle blocker assignment via
 *     selectCombatGroup, which fires gameTarget (TargetAttacker) when
 *     multiple attackers could be blocked. Done commits. No All-attack
 *     equivalent. No Special button (selectBlockers doesn't populate
 *     SPECIAL_BUTTON).</li>
 * </ul>
 *
 * <p>Damage-assignment ordering for multi-block (CR 510.1c) is
 * IMPLICIT in click order in xmage — no separate "order blockers"
 * prompt fires. Defender clicks blockers in their preferred order
 * → engine appends to CombatGroup.blockers list → MultiAmountDialog
 * (slice 70-X.14 Wave 3) renders rows in that order for trample
 * damage assignment. No banner change needed.
 *
 * <p>Position: bottom-center fixed. pointer-events scoped so the
 * board stays clickable for creatures.
 */
interface CombatBannerProps {
  stream: GameStream | null;
  isAttackers: boolean;
}

export function CombatBanner({ stream, isAttackers }: CombatBannerProps) {
  const dialog = useGameStore((s) => s.pendingDialog);
  const { ref, containerProps, style } = useDraggable({
    placement: { kind: 'bottom-center', bottomMargin: 196 },
  });

  if (!dialog) return null;
  if (dialog.method !== 'gameSelect') return null;
  const data = 'cardsView1' in dialog.data ? dialog.data : null;
  if (!data) return null;

  const message =
    data.message ||
    (isAttackers ? 'Select attackers' : 'Select blockers');

  // "All attack" is offered only when the engine populated the
  // SPECIAL_BUTTON option. Per HumanPlayer.java:1786-1842, this is
  // present only on declare-attackers AND when possibleAttackers is
  // non-empty. selectBlockers does NOT populate SPECIAL_BUTTON, so
  // the All-attack button is implicitly hidden for blockers.
  const allAttackLabel = data.options?.specialButton ?? '';
  const showAllAttack = isAttackers && allAttackLabel.length > 0;

  const sendDone = () => {
    // Read the latest messageId at click time — combat may have
    // re-fired with fresh frames during the user's selection.
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, 'boolean', true);
    // Don't clearDialog locally — engine drives teardown via fresh
    // gameUpdate / gameSelect frames.
  };

  const sendAllAttack = () => {
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, 'string', 'special');
  };

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid="combat-banner"
      data-combat-phase={isAttackers ? 'attackers' : 'blockers'}
      data-drag-handle
      className={
        'relative pointer-events-auto inline-flex items-center gap-3 rounded-lg ' +
        'bg-zinc-900/95 border border-amber-400/60 shadow-xl ' +
        'px-4 py-2 text-zinc-100 backdrop-blur-sm cursor-move select-none z-40'
      }
      style={style}
      {...containerProps}
    >
      <BannerSpotlightHalo testId="combat-banner-halo" />
      <span
        className="text-xs uppercase tracking-wider text-amber-300 font-semibold"
        data-testid="combat-banner-title"
      >
        {isAttackers ? 'Combat — attackers' : 'Combat — blockers'}
      </span>
      <span className="text-sm" data-testid="combat-banner-message">
        {renderUpstreamMarkup(message)}
      </span>
      <span className="text-xs text-zinc-500 italic">
        Click creatures on the board to toggle
      </span>
      {showAllAttack && (
        <button
          type="button"
          onClick={sendAllAttack}
          data-testid="combat-banner-all-attack"
          className="px-3 py-1 rounded text-sm font-medium bg-amber-700/70 hover:bg-amber-700 text-amber-50 transition"
        >
          {allAttackLabel}
        </button>
      )}
      <button
        type="button"
        onClick={sendDone}
        data-testid="combat-banner-done"
        className="px-3 py-1 rounded text-sm font-medium bg-amber-500 hover:bg-amber-400 text-zinc-950 transition"
      >
        Done
      </button>
    </div>
  );
}
