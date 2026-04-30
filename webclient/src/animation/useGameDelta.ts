import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameStore } from '../game/store';
import type { WebGameView } from '../api/schemas';
import { diffGameViews, type GameEvent } from './gameDelta';

/**
 * Slice 70-Z.2 — subscribes to the Zustand {@code gameView} and
 * fires the supplied callback with the {@link GameEvent}s computed
 * by {@link diffGameViews}. Holds the previous snapshot in a ref so
 * each invocation diffs against the immediately-prior state.
 *
 * <p><b>Timing:</b> uses {@code useEffect} (not store middleware)
 * so the diff runs AFTER React commits the new snapshot. This is
 * load-bearing: animation consumers may need to read DOM bboxes for
 * tiles whose props changed in the same render, and middleware
 * runs before React commits.
 *
 * <p><b>Reference equality:</b> Zustand's setState replaces the
 * gameView reference on every {@code gameUpdate} frame, so the
 * effect fires once per snapshot. No-op snapshots (where prev ===
 * next) wouldn't trigger because the store doesn't write equal
 * references; the {@link diffGameViews} pure function additionally
 * returns an empty array on identical content as a defensive net.
 *
 * <p>The callback identity should be stable across renders (wrap
 * in {@code useCallback} on the consumer side). The hook captures
 * the latest callback in a ref so non-stable callbacks don't
 * re-fire the effect on every parent render.
 */
export function useGameDelta(
  onEvents: (events: GameEvent[]) => void,
): void {
  const gameView = useGameStore((s) => s.gameView);
  const prevRef = useRef<WebGameView | null>(null);
  const onEventsRef = useRef(onEvents);
  // Capture the latest callback in a ref via useLayoutEffect (post-
  // commit, before paint) so the diff effect below can read the most
  // recent value without listing onEvents as a dependency. Listing
  // it would re-run the diff on every render that produces a new
  // function identity, which would re-emit events for the same
  // snapshot — exactly the bug the ref pattern is preventing.
  useLayoutEffect(() => {
    onEventsRef.current = onEvents;
  });

  useEffect(() => {
    if (gameView === null) {
      // Pre-game / Waiting state — clear the prev so the first real
      // snapshot is treated as game-start (no events emitted).
      prevRef.current = null;
      return;
    }
    const events = diffGameViews(prevRef.current, gameView);
    prevRef.current = gameView;
    if (events.length > 0) {
      onEventsRef.current(events);
    }
  }, [gameView]);
}
