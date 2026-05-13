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
/**
 * Slice 2026-05-13 (playtester feedback item 4) — cardIds whose
 * destination battlefield tile must render at opacity 0 while a
 * {@link ResolveFlightOverlay} arc is in flight. The synchronous-
 * before-React-render write closes the rAF race the old
 * {@code setTileOpacity}-from-rAF path had — without this, the
 * destination tile painted at full opacity on the same frame the
 * Framer LAYOUT_GLIDE settled it into its slot, before the rAF
 * callback could hide it. Result: a second visible copy of the
 * card at the landing slot.
 */
const activeFlyingTiles = new Set<string>();
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
 * Mark a cardId as currently being flown to by ResolveFlightOverlay.
 * Called SYNCHRONOUSLY inside the {@code resolve_to_board} eventBus
 * handler (which itself fires synchronously inside Zustand's
 * subscribe) so the mark is set BEFORE React re-renders the new
 * battlefield tile. {@link useFlyingTileHide} reads the set during
 * the same render commit, and the destination tile renders at
 * opacity 0 from its first paint — no rAF race, no flicker frame.
 */
export function startFlightHide(cardId: string): void {
  activeFlyingTiles.add(cardId);
  fireListeners();
}

/**
 * Clear a cardId from the flying-tiles set. Called when the
 * ResolveFlightOverlay's onComplete fires (or the safety
 * setTimeout, or an early-return inside the rAF when bbox capture
 * fails — in all three cases the destination tile must become
 * visible again).
 */
export function endFlightHide(cardId: string): void {
  if (!activeFlyingTiles.delete(cardId)) return;
  fireListeners();
}

/**
 * Is the given cardId currently mid-resolve-flight? Read by the
 * battlefield tile motion.div's animate.opacity to clamp to 0
 * until the flight completes.
 */
export function isFlyingTo(cardId: string): boolean {
  return activeFlyingTiles.has(cardId);
}

/**
 * Snapshot the flying-tiles set as a frozen copy. Used by
 * {@code useFlyingTilesSnapshot} so a parent component that needs
 * to test membership for many cardIds in one render can do so
 * against a stable per-render Set rather than calling
 * {@link isFlyingTo} N times. Returns a fresh Set each call —
 * pair with React's useState + setState-on-subscription so
 * reference equality only changes when the set itself changes.
 */
export function snapshotFlyingTiles(): ReadonlySet<string> {
  return new Set(activeFlyingTiles);
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
  const hadFlying = activeFlyingTiles.size > 0;
  activeFlyingTiles.clear();
  if (activeCinematicCasts.size === 0 && !hadFlying && listeners.size === 0) {
    return;
  }
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
  activeFlyingTiles.clear();
  listeners.clear();
  castKindByCardId.clear();
  exitKindByCardId.clear();
}
