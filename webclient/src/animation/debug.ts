/**
 * Debug knob for slowing down all Framer Motion animations during
 * live testing. Usage:
 *
 *   http://localhost:5173/?slowmo=3
 *
 * Multiplier semantics: time period of a spring is ~ 2π·√(mass/stiffness).
 * Multiplying `mass` by N AND dividing `stiffness` by N makes the period
 * N× longer while keeping the damping ratio constant — i.e. the SHAPE
 * of the curve (number of overshoots, settle behavior) is preserved,
 * only the time axis stretches. This is the right knob for "see what
 * the animation does without changing how it feels."
 *
 * For duration-based ease transitions, the multiplier just scales the
 * duration linearly.
 *
 * Reads `?slowmo=N` from the URL once at module load. Defaults to 1
 * (no slowdown). Negative or zero values are clamped to 1.
 */

const SLOWMO_DEFAULT = 1;

function readSlowmoFromUrl(): number {
  if (typeof window === 'undefined') return SLOWMO_DEFAULT;
  try {
    const raw = new URLSearchParams(window.location.search).get('slowmo');
    if (raw == null) return SLOWMO_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return SLOWMO_DEFAULT;
    return n;
  } catch {
    return SLOWMO_DEFAULT;
  }
}

export const SLOWMO: number = readSlowmoFromUrl();

export const isSlowmoActive: boolean = SLOWMO !== 1;

interface SpringTransition {
  type: 'spring';
  stiffness?: number;
  damping?: number;
  mass?: number;
  [key: string]: unknown;
}

interface DurationTransition {
  duration: number;
  [key: string]: unknown;
}

type AnyTransition = SpringTransition | DurationTransition | Record<string, unknown>;

/**
 * Wrap any Framer Motion transition object with the active slowmo
 * multiplier. Springs get `stiffness / SLOWMO` and `mass * SLOWMO`
 * (preserves damping ratio); duration-based transitions get
 * `duration * SLOWMO`. No-op when SLOWMO === 1.
 *
 * Usage:
 *   transition={slow({ type: 'spring', stiffness: 280, damping: 26, mass: 0.7 })}
 *   transition={slow({ duration: 0.7, ease: 'easeOut' })}
 */
export function slow<T extends AnyTransition>(t: T): T {
  if (SLOWMO === 1) return t;
  if ('type' in t && t.type === 'spring') {
    const s = t as SpringTransition;
    return {
      ...t,
      stiffness: (s.stiffness ?? 200) / SLOWMO,
      mass: (s.mass ?? 1) * SLOWMO,
    } as T;
  }
  if ('duration' in t && typeof t.duration === 'number') {
    return { ...t, duration: t.duration * SLOWMO } as T;
  }
  return t;
}
