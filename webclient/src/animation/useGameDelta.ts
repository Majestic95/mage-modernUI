import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import type { WebGameView } from '../api/schemas';
import { diffGameViews, type GameEvent } from './gameDelta';

/**
 * Slice 70-Z.2 + 70-Z.4 — subscribes to the Zustand {@code gameView}
 * and fires the supplied callback with {@link GameEvent}s computed
 * by {@link diffGameViews}. Holds the previous snapshot in a ref so
 * each invocation diffs against the immediately-prior state.
 *
 * <p><b>Timing (slice 70-Z.4 fix):</b> uses Zustand's imperative
 * {@code useGameStore.subscribe} (not React's {@code useEffect})
 * so the diff fires SYNCHRONOUSLY inside the store's {@code set()}
 * call, BEFORE React schedules a re-render. This is load-bearing
 * for the impact-tier (slice 70-Z.4): when a creature dies, the
 * snapshot diff emits {@code creature_died}, the layer's
 * subscriber writes {@code exitKindByCardId.set(cardId, 'dust')},
 * and ALL of that happens before {@code BattlefieldRowGroup}
 * re-renders without the dying cardId. The next render's
 * {@code AnimatePresence} exit phase reads {@code exitKindByCardId}
 * and gets the right value.
 *
 * <p>Slice 70-Z.2 used {@code useEffect}, which fires AFTER
 * React's commit — for the impact case that meant the dying
 * tile's exit animation had already started (with the default B
 * glide) by the time the event was emitted. Moving to the
 * synchronous subscribe path closes the race.
 *
 * <p><b>Reference equality:</b> Zustand subscribe fires only when
 * the selected slice (gameView) actually changes by reference
 * equality. No-op writes don't trigger.
 *
 * <p>The callback identity should be stable across renders. The
 * hook captures the latest callback in a ref so non-stable
 * callbacks don't re-register the subscription on every render.
 */
export function useGameDelta(
  onEvents: (events: GameEvent[]) => void,
): void {
  const prevRef = useRef<WebGameView | null>(null);
  const onEventsRef = useRef(onEvents);
  // Capture the latest callback in a ref via useLayoutEffect (post-
  // commit, before paint) so the subscribe handler below can read
  // the most recent value without re-subscribing.
  useLayoutEffect(() => {
    onEventsRef.current = onEvents;
  });

  useEffect(() => {
    // Initialize prev from the current state at subscribe time so
    // the FIRST real change diffs against a non-null baseline if
    // the store already had a gameView when the hook mounted.
    prevRef.current = useGameStore.getState().gameView;
    const unsub = useGameStore.subscribe((state, prev) => {
      if (state.gameView === prev.gameView) return;
      if (state.gameView === null) {
        // Pre-game / Waiting state — clear so the next real
        // snapshot is treated as the baseline (no events emitted).
        prevRef.current = null;
        return;
      }
      const events = diffGameViews(prevRef.current, state.gameView);
      prevRef.current = state.gameView;
      if (events.length > 0) {
        onEventsRef.current(events);
      }
    });
    return unsub;
  }, []);
}
