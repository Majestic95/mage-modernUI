import { castKindByCardId, exitKindByCardId } from './eventBus';

/**
 * Slice 70-Z.3 — module-singleton state for cross-component
 * animation coordination. Currently tracks "which cardIds are
 * mid-cinematic-cast" so the StackZone focal-tile can skip its
 * mount during the casting-pose hold (avoiding two motion.divs
 * with the same {@code layoutId} at once, which is undefined
 * behavior in Framer Motion).
 *
 * <p>This is intentionally NOT a Zustand store — the shape is
 * trivial (a Set), the access pattern is single-writer (only
 * {@link CardAnimationLayer} writes; many components subscribe),
 * and a Zustand wrapper would add boilerplate. The handcoded
 * subscribe pattern mirrors {@link eventBus} for consistency.
 *
 * <p><b>Memory:</b> the Set grows only when cinematic casts are
 * in flight. {@link endCinematicCast} clears entries after the
 * 250ms hold + glide settles. Stale entries are cleared on game
 * boundaries via {@link resetAnimationState}, which {@code
 * Game.tsx} calls when the game stream closes.
 */

const activeCinematicCasts = new Set<string>();
const listeners = new Set<() => void>();

/**
 * Mark a cardId as currently mid-cinematic-cast. Called by
 * {@link CardAnimationLayer} when a {@code cast} event with
 * {@code cinematic: true} arrives.
 */
export function startCinematicCast(cardId: string): void {
  activeCinematicCasts.add(cardId);
  fireListeners();
}

/**
 * Clear a cardId from the active-cinematic set. Called by
 * {@link CastingPoseOverlay} on unmount (after CINEMATIC_HOLD_MS
 * + LAYOUT_GLIDE travel time has elapsed).
 */
export function endCinematicCast(cardId: string): void {
  if (!activeCinematicCasts.delete(cardId)) return;
  fireListeners();
}

/**
 * Is the given cardId mid-cinematic? StackZone focal-tile uses
 * this to gate its mount during the casting-pose hold.
 */
export function isCinematicCastActive(cardId: string): boolean {
  return activeCinematicCasts.has(cardId);
}

/**
 * Subscribe to state changes. Returns an unsubscribe fn — pair
 * with the React effect cleanup.
 */
export function subscribeToAnimationState(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Reset all in-flight animation state. Called when the game stream
 * closes or a new game starts so a player who plays two games in
 * one session doesn't see stale cinematic state.
 *
 * <p>P0 audit fix — also drains the eventBus's per-cardId metadata
 * Maps ({@code castKindByCardId}, {@code exitKindByCardId}). These
 * accumulate one entry per cast / per-permanent-leaving-battlefield
 * across the whole game. Without the cross-game clear, a long session
 * (e.g. best-of-three or sideboard match) leaks stale entries — by
 * game N the Maps carry entries for cardIds that no longer exist on
 * the wire, and a future "look up cast kind for this cardId" path
 * could read a wrong-zone hit. Clearing here keeps the
 * eventBus-singleton model viable for an indefinite session.
 */
export function resetAnimationState(): void {
  castKindByCardId.clear();
  exitKindByCardId.clear();
  if (activeCinematicCasts.size === 0 && listeners.size === 0) return;
  activeCinematicCasts.clear();
  fireListeners();
}

function fireListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error('[animationState] listener threw', err);
    }
  }
}

/**
 * Test-only reset. Clears state AND listeners, unlike
 * {@link resetAnimationState} which preserves listener
 * registrations.
 */
export function __resetForTests(): void {
  activeCinematicCasts.clear();
  listeners.clear();
  castKindByCardId.clear();
  exitKindByCardId.clear();
}
