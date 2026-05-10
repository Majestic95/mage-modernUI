/**
 * Bundle 5 / Slice 5-E — frame-diff hook detecting lethal-21
 * commander damage crossings. Sibling to {@link useDamageEvents}
 * (slice 5-A) and {@link useGameDelta}; reads the schema 1.35
 * {@code WebPlayerView.commanderDamageReceived} field added in
 * slice 5-F.
 *
 * <p>CR 704.5b: a player who has been dealt 21 OR MORE combat
 * damage by the same commander is a state-based loss. The engine
 * enforces this in {@code GameCommanderImpl.checkStateBasedActions}
 * by walking each commander's {@code CommanderInfoWatcher}
 * (`mage.watchers.common.CommanderInfoWatcher.getDamageToPlayer()`).
 * This hook reads the same data — exposed on the wire by slice 5-F
 * — and emits a `commander_lethal` event the moment a (player,
 * commander) pair crosses from below-21 to ≥21.
 *
 * <p><b>Why threshold-crossing only:</b> we want the cinematic to
 * fire EXACTLY ONCE per lethal moment. If the wire keeps reporting
 * a stable 22 across multiple frames (engine ticks happening
 * between damage and player-elimination), we don't want to
 * re-fire the authority sequence on every frame. The diff compares
 * prev vs next: only when the prev value was < 21 AND the next is
 * ≥ 21 do we emit.
 *
 * <p>Returns events sorted deterministically by `(defenderId,
 * commanderId)` so multi-lethal frames (rare but possible — e.g.,
 * a single damage step that pushes two players past 21 each from
 * different commanders) sequence in stable order.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import type { WebGameView } from '../api/schemas';

/** CR 704.5b state-based loss threshold. */
export const LETHAL_COMMANDER_DAMAGE_THRESHOLD = 21;

export type CommanderLethalEvent = {
  kind: 'commander_lethal';
  defenderId: string;
  commanderId: string;
  damage: number;
  /**
   * Slice 5-X.0 BugHunter-5 — captured at diff time so the
   * cinematic doesn't have to do a second store read after the
   * staggered timeout fires. Avoids the race where
   * CommanderLethalSequence's `setTimeout(...)` callback runs
   * after the user has disconnected (gameView=null) and the
   * defender lookup falls back to a generic 'Player' label.
   */
  defenderName: string;
};

export function useCommanderLethalEvents(
  onEvents: (events: CommanderLethalEvent[]) => void,
): void {
  const prevRef = useRef<WebGameView | null>(null);
  const onEventsRef = useRef(onEvents);
  useLayoutEffect(() => {
    onEventsRef.current = onEvents;
  });

  useEffect(() => {
    prevRef.current = useGameStore.getState().gameView;
    const unsub = useGameStore.subscribe((state, prev) => {
      if (state.gameView === prev.gameView) return;
      if (state.gameView === null) {
        prevRef.current = null;
        return;
      }
      const events = diffLethalEvents(prevRef.current, state.gameView);
      prevRef.current = state.gameView;
      if (events.length > 0) {
        onEventsRef.current(events);
      }
    });
    return unsub;
  }, []);
}

/**
 * Pure diff function — exported for unit testing without the
 * Zustand store. Returns `[]` on first invocation (no prev) and
 * for any frame where no (player, commander) pair crossed the
 * lethal threshold.
 */
export function diffLethalEvents(
  prev: WebGameView | null,
  next: WebGameView,
): CommanderLethalEvent[] {
  if (prev == null) return [];
  // Build a quick lookup of prev per-player commander damage maps.
  const prevDamageByPlayer = new Map<
    string,
    Record<string, number>
  >();
  for (const p of prev.players) {
    prevDamageByPlayer.set(p.playerId, p.commanderDamageReceived ?? {});
  }

  const events: CommanderLethalEvent[] = [];
  for (const nextPlayer of next.players) {
    const nextDamage = nextPlayer.commanderDamageReceived ?? {};
    const prevDamage = prevDamageByPlayer.get(nextPlayer.playerId) ?? {};
    for (const [commanderId, damage] of Object.entries(nextDamage)) {
      if (damage < LETHAL_COMMANDER_DAMAGE_THRESHOLD) continue;
      const prevValue = prevDamage[commanderId] ?? 0;
      if (prevValue >= LETHAL_COMMANDER_DAMAGE_THRESHOLD) continue;
      events.push({
        kind: 'commander_lethal',
        defenderId: nextPlayer.playerId,
        commanderId,
        damage,
        defenderName: nextPlayer.name,
      });
    }
  }

  // Deterministic sort — multi-lethal frames sequence stably.
  events.sort((a, b) => {
    if (a.defenderId !== b.defenderId) {
      return a.defenderId < b.defenderId ? -1 : 1;
    }
    return a.commanderId < b.commanderId ? -1 : 1;
  });

  return events;
}
