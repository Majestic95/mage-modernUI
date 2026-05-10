/**
 * Bundle 5 / Slice 5-B — portrait halo bloom on life-loss.
 *
 * <p>Subscribes to {@link useDamageEvents} (built in slice 5-A); when
 * a `parcel_hit_player` event fires for the given player, returns
 * `true` for {@link PORTRAIT_BLOOM_MS} milliseconds, then resets to
 * `false`. The PlayerPortrait component composes a CSS keyframe class
 * when this returns true — the keyframe peaks alpha + scale exactly
 * at the moment the LifeCounter's flash also peaks, so the visual
 * (halo bloom) and numeric (life count flash) feel like one event
 * instead of two disconnected updates.
 *
 * <p><b>Re-trigger semantics:</b> if a second hit fires while a
 * bloom is already in flight, the bloom resets to a fresh start.
 * Internally this is achieved by bumping a counter — the consumer
 * applies the bloom class keyed off the counter so React remounts
 * the keyframe-bearing element each time.
 *
 * <p><b>Reduced-motion:</b> the keyframe itself is wrapped in
 * `@media (prefers-reduced-motion: no-preference)` (the project's
 * global reduced-motion rule kills it under reduce). The hook
 * still returns true under reduced-motion so the LifeCounter's
 * existing static flash isn't blocked, but the visual bloom is
 * suppressed by CSS.
 */
import { useEffect, useRef, useState } from 'react';
import { PORTRAIT_BLOOM_MS } from '../animation/transitions';
import { useDamageEvents } from '../animation/useDamageEvents';

interface BloomState {
  // Monotonic counter — bumped on every hit. The consumer keys
  // their keyframe-bearing element off this so React remounts and
  // the keyframe replays from frame 0 on consecutive hits.
  counter: number;
  // True while the bloom is in flight; false once the timeout
  // elapsed.
  active: boolean;
}

/**
 * Returns `{ counter, active }` for the given player. `active` is
 * true for {@link PORTRAIT_BLOOM_MS} after a hit; `counter` bumps
 * on every hit (used as React key for keyframe remount).
 */
export function usePortraitBloom(playerId: string): BloomState {
  const [state, setState] = useState<BloomState>({
    counter: 0,
    active: false,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useDamageEvents((events) => {
    // Trigger when ANY event names this player as defender. Multiple
    // events in the same frame still produce one bloom (the first
    // hit; subsequent hits within the same frame are absorbed —
    // visually they're indistinguishable at this scale).
    const matched = events.some((e) => e.defenderId === playerId);
    if (!matched) return;
    setState((prev) => ({ counter: prev.counter + 1, active: true }));
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setState((prev) => ({ counter: prev.counter, active: false }));
      timeoutRef.current = null;
    }, PORTRAIT_BLOOM_MS);
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return state;
}
