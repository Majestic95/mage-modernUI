import { useEffect, useState } from 'react';

/**
 * Bundle 3-C (2026-05-09) — combat-step tempo meter.
 *
 * <p>Returns the elapsed wall-clock time the user has spent on the
 * current combat sub-step plus a discretized intensity bucket. Resets
 * to zero whenever {@code step} changes — the engine moves us between
 * BEGIN_COMBAT / DECLARE_ATTACKERS / DECLARE_BLOCKERS / etc. and each
 * transition starts the meter fresh. The banner uses the returned
 * shape to render a thin progress bar at its bottom edge that grows
 * + colors-up as the user lingers, so longer turns self-pace ("I've
 * been on attackers for 90 seconds, time to commit").
 *
 * <p><b>Tick cadence: 1000ms.</b> Sub-second precision isn't useful —
 * the visible bar at 1Hz reads as "almost smooth" once the consumer
 * applies a CSS width-transition, and a faster interval pays a
 * meaningful re-render cost on every banner consumer in the tree.
 *
 * <p><b>Intensity thresholds:</b> calm (&lt;30s), warm (30–90s), hot
 * (≥90s). Picked from observed real-game pacing — most combats
 * resolve in under 30s, 90s is the "table is waiting, commit or
 * pass" zone. The cap (120s) bounds the {@link CombatTempo#progress}
 * value so absurdly long deliberations don't visually overflow; the
 * intensity bucket stays {@code hot} past the cap.
 *
 * <p><b>Reduced-motion handling lives in the consumer.</b> The hook
 * is style-agnostic — it returns numbers + a bucket. The banner
 * (3-C's only consumer today) gates the bar's CSS width-transition
 * behind {@code motion-safe:} so reduced-motion users still see the
 * intensity color updates but the width snaps to the new value at
 * each tick instead of animating.
 *
 * <p><b>Lifetime:</b> the interval is cleaned up on unmount AND on
 * step-change (effect cleanup runs before the new effect body fires).
 * No leak when the banner closes mid-combat.
 */
export type TempoIntensity = 'calm' | 'warm' | 'hot';

export const TEMPO_WARM_MS = 30_000;
export const TEMPO_HOT_MS = 90_000;
export const TEMPO_CAP_MS = 120_000;
const TEMPO_TICK_MS = 1_000;

export interface CombatTempo {
  elapsedMs: number;
  intensity: TempoIntensity;
  /** 0..1, suitable for `style.width` as a percentage. */
  progress: number;
}

export function useCombatTempo(step: string): CombatTempo {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    // Reset on step transition. The state set is synchronous within
    // the effect; React schedules a re-render with elapsedMs=0 before
    // the first interval fires.
    setElapsedMs(0);
    const interval = window.setInterval(() => {
      setElapsedMs((prev) => Math.min(prev + TEMPO_TICK_MS, TEMPO_CAP_MS));
    }, TEMPO_TICK_MS);
    return () => window.clearInterval(interval);
  }, [step]);

  const intensity: TempoIntensity =
    elapsedMs >= TEMPO_HOT_MS
      ? 'hot'
      : elapsedMs >= TEMPO_WARM_MS
        ? 'warm'
        : 'calm';

  return {
    elapsedMs,
    intensity,
    progress: Math.min(elapsedMs / TEMPO_CAP_MS, 1),
  };
}
