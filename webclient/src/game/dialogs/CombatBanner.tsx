import { useDraggable } from '../../util/useDraggable';
import { useGameStore } from '../store';
import { BannerSpotlightHalo } from './BannerSpotlightHalo';
import { renderUpstreamMarkup } from './markupRenderer';
import type { GameStream } from '../stream';
import { useCombatTempo } from '../useCombatTempo';

/**
 * Bundle 3-B (2026-05-09) — sub-title display map. Engine PhaseStep
 * enum names mapped to title-case labels for the banner's secondary
 * row. Limited to the six combat sub-steps because (a) the banner
 * only fires during gameSelect with combat options, and (b) showing
 * a non-combat label here would be misleading. Steps not in this
 * map cause the sub-title row to be omitted.
 */
const COMBAT_STEP_LABEL: Record<string, string> = {
  BEGIN_COMBAT: 'Begin combat',
  DECLARE_ATTACKERS: 'Declare attackers',
  DECLARE_BLOCKERS: 'Declare blockers',
  FIRST_COMBAT_DAMAGE: 'First-strike damage',
  COMBAT_DAMAGE: 'Combat damage',
  END_COMBAT: 'End of combat',
};

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
  const step = useGameStore((s) => s.gameView?.step ?? '');
  const { ref, containerProps, style } = useDraggable({
    placement: {
      kind: 'bottom-center',
      bottomMargin: 16,
      bottomMarginVar: 'hand-area-height',
    },
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

  // Bundle 3-B — sub-title row from gameView.step. The banner only
  // fires during combat-related gameSelect frames in practice; steps
  // outside the combat enum range collapse to no sub-title (the row
  // simply doesn't render). The map above is internal to this file
  // — sharing it with PhaseTimeline would be over-coupling for two
  // tiny look-up tables, so it stays duplicated by design.
  const subTitleLabel = COMBAT_STEP_LABEL[step] ?? '';

  // Bundle 3-C — tempo meter at the bottom edge. Resets on step
  // change (engine moving us between combat sub-steps), grows from
  // 0% to 100% width over 120s, color-grades from calm grey to warm
  // amber to hot red. The hook is the sole source of pacing state;
  // tests in useCombatTempo.test.ts lock in the thresholds.
  const tempo = useCombatTempo(step);
  const tempoFillClass =
    tempo.intensity === 'hot'
      ? 'bg-red-400/80'
      : tempo.intensity === 'warm'
        ? 'bg-amber-400/70'
        : 'bg-zinc-500/60';

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

  // Bundle 3-B — banner restructured into a two-column layout:
  //   left = stacked typography (title / sub-title / message / hint),
  //   right = action buttons (All-attack secondary, Done primary).
  // The horizontal footprint is unchanged at the segment level; the
  // banner grows vertically by ~30px to accommodate the sub-title +
  // hint rows. Banner-sprawl monitoring (per the bundle 3 brief) is
  // a 3-D concern — at this stage the height is well under the
  // hand-fan clearance budget.
  //
  // Top-edge inset highlight (boxShadow style) lifts the frosted
  // band off busy battlefield content; uses a literal style rather
  // than a Tailwind utility because Tailwind's box-shadow utilities
  // don't compose with `shadow-xl` cleanly (would override it).
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid="combat-banner"
      data-combat-phase={isAttackers ? 'attackers' : 'blockers'}
      data-drag-handle
      className={
        'relative pointer-events-auto inline-flex items-stretch gap-4 rounded-lg ' +
        'bg-zinc-900/95 border border-amber-400/60 shadow-xl ' +
        'px-4 py-2 text-zinc-100 backdrop-blur-sm cursor-move select-none z-40'
      }
      style={{
        ...style,
        boxShadow:
          '0 25px 50px -12px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      }}
      {...containerProps}
    >
      <BannerSpotlightHalo testId="combat-banner-halo" />
      <div className="flex flex-col justify-center flex-1 min-w-0">
        <span
          data-testid="combat-banner-title"
          className="text-xs uppercase tracking-wider text-amber-300 font-semibold"
        >
          Combat
        </span>
        {subTitleLabel && (
          <span
            data-testid="combat-banner-subtitle"
            data-step={step}
            className="text-[10px] uppercase tracking-wide text-zinc-400 mt-0.5"
          >
            {subTitleLabel}
          </span>
        )}
        <span data-testid="combat-banner-message" className="text-sm mt-1">
          {renderUpstreamMarkup(message)}
        </span>
        <span
          data-testid="combat-banner-hint"
          className="text-xs text-zinc-600 italic mt-0.5"
        >
          Click creatures on the board to toggle
        </span>
      </div>
      <div className="flex items-center gap-2 self-center">
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
          className={
            'px-4 py-1.5 rounded-full text-sm font-semibold transition ' +
            'bg-amber-500 hover:bg-amber-400 text-zinc-950 ' +
            'border-2 border-amber-400'
          }
        >
          Done
        </button>
      </div>
      <div
        data-testid="combat-banner-tempo"
        className="absolute inset-x-4 bottom-1.5 h-[2px] bg-zinc-800/40 rounded-full overflow-hidden"
      >
        <div
          data-testid="combat-banner-tempo-fill"
          data-intensity={tempo.intensity}
          className={
            'h-full ease-linear motion-safe:transition-[width,background-color] motion-safe:duration-700 ' +
            tempoFillClass
          }
          style={{ width: `${tempo.progress * 100}%` }}
        />
      </div>
    </div>
  );
}
