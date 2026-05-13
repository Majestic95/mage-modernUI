import { useEffect, useState } from 'react';
import {
  isFlyingTo,
  snapshotFlyingTiles,
  subscribeToAnimationState,
} from './animationState';

/**
 * Playtester-feedback fix (2026-05-13, item 4) — React subscription
 * to {@link animationState}'s flying-tiles set. Returns true while
 * the given cardId is mid-resolve-flight, so the battlefield tile's
 * {@code animate.opacity} can clamp to 0 until the flight completes.
 *
 * <p><b>Why this exists:</b> the old path called
 * {@code setTileOpacity(cardId, 0)} from inside a
 * {@code requestAnimationFrame} callback scheduled by the
 * {@code resolve_to_board} handler. By the time the rAF fired, the
 * new battlefield tile had already mounted and painted at opacity 1,
 * producing a one-frame flash of "the card is already in its slot"
 * BEFORE the {@link ResolveFlightOverlay} arc started — a visible
 * duplicate. The synchronous-before-React-render write to the
 * flying-tiles set (paired with this hook reading the set during
 * the same render commit) closes the race: the destination tile
 * renders at opacity 0 from its first paint.
 *
 * <p><b>Idle cost:</b> when no flight is in flight, every subscribed
 * BattlefieldRowGroup re-renders zero times (subscribeToAnimationState
 * fires only on writes to the set). The wake-up storm on a single
 * resolve fires N re-renders for N rendered tiles — acceptable in
 * practice (typical board ≤ 15 permanents).
 */
export function useFlyingTileHide(cardId: string | undefined): boolean {
  // Lazy initializer fires during the first render commit of this
  // component (e.g. BattlefieldRowGroup's AttachmentGroupSlot when
  // a new permanent enters the row). The synchronous mark in
  // CardAnimationLayer's resolve_to_board handler runs inside
  // Zustand's subscribe (fired by useGameDelta before React's
  // commit), so by the time this initializer reads isFlyingTo, the
  // mark IS set. The useEffect+update path below is a belt-and-
  // suspenders catch for state changes that arrive AFTER mount
  // (i.e. endFlightHide); the initializer alone closes the rAF
  // race for the mount case. If a future refactor moves the mark
  // off of Zustand's synchronous-subscribe path, this initializer
  // would race and the original duplicate-flash returns.
  const [hidden, setHidden] = useState<boolean>(() =>
    cardId ? isFlyingTo(cardId) : false,
  );
  useEffect(() => {
    if (!cardId) {
      setHidden(false);
      return undefined;
    }
    const update = () => setHidden(isFlyingTo(cardId));
    update();
    return subscribeToAnimationState(update);
  }, [cardId]);
  return hidden;
}

/**
 * Bucket-level variant — returns a stable snapshot of the
 * flying-tiles set. Parent components that render many cardIds in
 * a single map (e.g. {@code TabletopBuckets}, where the inline JSX
 * structure makes per-permanent hook calls awkward) call this once
 * and then test {@code snapshot.has(cardId)} per iteration.
 *
 * <p>Re-renders the caller on every flying-tile change (i.e. one
 * extra render at flight-start and one at flight-end). All
 * subscribed components fire on the same animationState change;
 * acceptable cost for the ~700ms-per-flight window.
 *
 * <p><b>Reference-equality note (Technical critic 2026-05-13):</b>
 * {@link snapshotFlyingTiles} returns a fresh Set per call, so any
 * call to {@code subscribeToAnimationState}'s listener — including
 * cinematic-cast start/end events — invalidates the snapshot
 * reference and triggers a re-render of every component using this
 * hook. Acceptable trade-off: simple code, no Set-equality dance,
 * and the cost is at most a handful of re-renders per game tick.
 * If a future perf audit calls for tightening, switch the
 * subscribe filter to fire only on flying-tile changes.
 */
export function useFlyingTilesSnapshot(): ReadonlySet<string> {
  const [snap, setSnap] = useState<ReadonlySet<string>>(() =>
    snapshotFlyingTiles(),
  );
  useEffect(() => {
    return subscribeToAnimationState(() => setSnap(snapshotFlyingTiles()));
  }, []);
  return snap;
}
