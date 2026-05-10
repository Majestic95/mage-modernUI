/**
 * Bundle 5 / Slice 5-C — freeze-frame on damage resolution.
 *
 * Brief 400ms viewport-edge danger bloom that fires when the LOCAL
 * player takes combat damage. Cinematic punctuation through color
 * (not motion blur): the screen briefly tints from the edges
 * inward, like a comic-book splash panel.
 *
 * <p><b>Tuning slice (2026-05-10) — local-player only.</b> The
 * original implementation fired on any damage event. In multi-player
 * Commander that produces a constant red flicker as opponents trade
 * combat damage among themselves — the strongest "you're in danger"
 * signal in Bundle 5 was diluted into ambient noise. Per user
 * direction, the freeze-frame now only fires when {@code
 * event.defenderId === myPlayerId} so it strictly means "incoming
 * damage to YOU." Other players' damage still triggers the parcels
 * (5-A) and portrait bloom (5-B); only the viewport-edge bloom is
 * gated.
 *
 * <p><b>Scope deferral:</b> the brief lists three sub-effects for
 * slice 5-C — (a) viewport edge bloom, (b) per-creature rim
 * styling (survivors green / dying red), (c) hit-player edge bloom
 * tinted danger. (a) ships here. (b) and (c) move to slice 5-D's
 * death sequence integration because they require
 * {@code creature_died} events (already emitted by useGameDelta)
 * to discriminate dying-vs-surviving — wiring that integration in
 * 5-C would duplicate the 5-D code path. The viewport-edge bloom
 * carries the cinematic moment on its own; the per-creature rim
 * is enhancement that 5-D layers in cleanly.
 *
 * <p><b>Reduced motion:</b> the keyframe is suppressed by the
 * project-wide global rule. The damage parcel + portrait bloom
 * + life counter flash all carry the static fallback signal so
 * users miss nothing semantically.
 */
import { useEffect, useRef, useState } from 'react';
import { DAMAGE_FREEZE_FRAME_MS } from '../animation/transitions';
import { useDamageEvents } from '../animation/useDamageEvents';
import { useGameStore } from './store';

/**
 * Freeze-frame state — `counter` bumps on each hit batch so React
 * remounts the keyframe-bearing element and replays from frame 0
 * even on back-to-back damage frames.
 */
interface FreezeFrameState {
  counter: number;
  active: boolean;
}

export function DamageFreezeFrame() {
  const [state, setState] = useState<FreezeFrameState>({
    counter: 0,
    active: false,
  });
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useDamageEvents((events) => {
    if (events.length === 0) return;
    // Tuning slice (2026-05-10) — fire only on damage TO the local
    // player. Read myPlayerId imperatively from the store so callback
    // identity stays stable (the hook captures via ref + doesn't
    // re-subscribe on store changes; reading here is correct, not
    // racy, because frame-diff hooks fire synchronously inside
    // setState → store.gameView is the same `next` view the diff
    // just produced events from).
    const myPlayerId = useGameStore.getState().gameView?.myPlayerId ?? '';
    if (!myPlayerId) return;
    const hitMe = events.some((e) => e.defenderId === myPlayerId);
    if (!hitMe) return;
    setState((prev) => ({ counter: prev.counter + 1, active: true }));
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setState((prev) => ({ counter: prev.counter, active: false }));
      timeoutRef.current = null;
    }, DAMAGE_FREEZE_FRAME_MS);
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!state.active) {
    return (
      <div
        data-testid="damage-freeze-frame"
        data-active="false"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      key={`freeze-frame-${state.counter}`}
      data-testid="damage-freeze-frame"
      data-active="true"
      aria-hidden="true"
      className="pointer-events-none animate-damage-freeze-frame-edge"
      style={{
        position: 'fixed',
        inset: 0,
        // Z above arrows + parcels + chrome; below dialogs + modals.
        // Frames the action without intercepting any clicks.
        zIndex: 28,
      }}
    />
  );
}
