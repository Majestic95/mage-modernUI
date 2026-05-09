import { useEffect, useRef } from 'react';
import type { GameStream } from './stream';
import { useGameStore } from './store';
import { usePriorityStopsSettings } from './priorityStopsSettings';

/**
 * Per user direction 2026-05-09 + Magic-rules-agent verification:
 * the active player is entitled to priority on every combat step
 * (CR 117.1a + CR 507.2 / 508.2 / 509.4 / 510.2 / 511.2). The
 * existing webclient "Next Phase" button dispatches macros like
 * {@code PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE} that suppress the
 * active player's priority across the whole combat phase. This
 * hook auto-cancels those macros when entering combat steps where
 * the engine doesn't already stop by default (DECLARE_ATTACKERS
 * has {@code stopOnDeclareAttackers=true} engine-side, so no
 * cancel needed there).
 *
 * <p>When the {@code stopOnEachCombatStep} toggle is ON (default
 * 2026-05-09 onward), entering BEGIN_COMBAT, DECLARE_BLOCKERS,
 * FIRST_COMBAT_DAMAGE, COMBAT_DAMAGE, or END_COMBAT while the
 * active player has any skip-macro armed dispatches
 * {@code PASS_PRIORITY_CANCEL_ALL_ACTIONS}. The engine clears the
 * macro flag; the active player gets priority normally on that
 * step.
 *
 * <p><b>Race condition (acknowledged):</b> the cancel travels
 * over the wire and may arrive after the engine has already
 * auto-passed the active player's priority for that step. In that
 * case the player misses that one priority window — but the next
 * combat step's cancel will fire on entry, so they'll still get
 * priority on most of the 5 windows. Acceptable trade-off vs.
 * adding a new engine action or wire shape (which T5 forbids for
 * variant work; this is general game logic but staying webclient-
 * only avoids upstream-rebase pain).
 *
 * <p>Applies to the local player's macros regardless of whose turn
 * it is — per CR 117.3 both active and non-active players receive
 * priority on every combat step (APNAP order). The defender's
 * macro to skip "until next main" likewise suppresses their
 * priority on each combat step; this hook cancels it on entry to
 * the step so they can respond.
 */
const COMBAT_STEPS_NEEDING_STOP = new Set<string>([
  'BEGIN_COMBAT',
  'DECLARE_BLOCKERS',
  'FIRST_COMBAT_DAMAGE',
  'COMBAT_DAMAGE',
  'END_COMBAT',
]);

export function useStopOnCombatSteps(stream: GameStream | null): void {
  const enabled = usePriorityStopsSettings((s) => s.stopOnEachCombatStep);
  const step = useGameStore((s) => s.gameView?.step ?? '');
  const me = useGameStore((s) => {
    const gv = s.gameView;
    if (!gv) return null;
    return gv.players.find((p) => p.playerId === gv.myPlayerId) ?? null;
  });
  const lastCancelledStepRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!stream) return;
    if (!me) return;
    // Only cancel when there's actually a macro armed — otherwise
    // the cancel is a no-op that adds wire chatter. The wire enum
    // uses empty string '' as the "no skip" sentinel (per the
    // SkipState type in api/schemas.ts).
    if (!me.skipState) return;
    // Only cancel when entering a combat step where the engine
    // doesn't already stop by default. DECLARE_ATTACKERS has the
    // engine's {@code stopOnDeclareAttackers=true} default, so
    // the engine already pauses there — no cancel needed.
    if (!COMBAT_STEPS_NEEDING_STOP.has(step)) {
      lastCancelledStepRef.current = null;
      return;
    }
    // Don't re-fire if we already cancelled for this step (could
    // happen if other gameView fields update mid-step — re-render
    // shouldn't re-dispatch).
    if (lastCancelledStepRef.current === step) return;
    lastCancelledStepRef.current = step;
    stream.sendPlayerAction('PASS_PRIORITY_CANCEL_ALL_ACTIONS');
  }, [enabled, stream, me, step]);
}
