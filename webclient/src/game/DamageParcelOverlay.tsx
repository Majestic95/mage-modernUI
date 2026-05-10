/**
 * Bundle 5 / Slice 5-A — damage parcel cinematic.
 *
 * Viewport-fixed SVG overlay that animates a small bright "parcel"
 * along each combat-arrow path when damage lands. Subscribes to
 * {@link useDamageEvents}; for each `parcel_hit_player` event,
 * queries the matching {@code <path data-arrow-defender-id="...">}
 * rendered by Bundle 1's CombatArrows, calls the path's native
 * {@code getPointAtLength()} to compute the parcel's position at
 * each animation frame, and renders a `<circle>` traveling 0 → 1
 * progress over {@link DAMAGE_PARCEL_TRAVEL_MS}.
 *
 * <p><b>Why a separate viewport overlay (not added to CombatArrows
 * directly):</b> CombatArrows mounts inside the central focal cell
 * and only renders during combat. The parcel overlay is a sibling
 * at the GameTable root so it can paint independently of focal-
 * cell mode flips. Foundation Option D's z-layer cohabitation
 * (2026-05-10) means arrows stay mounted continuously during combat,
 * so parcels can always find their target paths — but the overlay
 * being separate keeps the arrow renderer simple (one concern per
 * component).
 *
 * <p><b>Reduced motion:</b> when `prefers-reduced-motion: reduce`,
 * parcels do not animate at all. Bundle 5 sub-features 5-B
 * (portrait halo bloom) + 5-C (freeze-frame) cover the static
 * fallback signal — life still flashes, the portrait still blooms,
 * the user still sees damage land. The parcel cinematic is purely
 * additive enhancement.
 *
 * <p><b>Staging:</b> when N parcels fire in the same frame, they
 * stagger {@link DAMAGE_PARCEL_STAGGER_MS} apart so the user can
 * count individual hits. Stagger timing uses `setTimeout` to defer
 * the per-parcel `requestAnimationFrame` start; cleanup cancels
 * pending timeouts on unmount.
 *
 * <p><b>Defensive on every read:</b> if the matching arrow path
 * isn't in the DOM (e.g., CombatArrows hasn't yet mounted on a
 * just-started combat tick), we silently skip that parcel. Better
 * to lose one frame's cinematic than to crash the overlay.
 */
import { useEffect, useRef, useState } from 'react';
import {
  DAMAGE_PARCEL_STAGGER_MS,
  parcelSchedule,
} from '../animation/transitions';
import { useDamageEvents, type DamageEvent } from '../animation/useDamageEvents';
import { useLifeDisplayStore } from '../animation/lifeDisplayStore';

/**
 * One in-flight parcel. {@code progress} is 0..1 of the path's
 * total length; React reads it via state to drive the rendered
 * `<circle>`'s cx/cy. {@code id} is a monotonic counter so React
 * keys never collide even when multiple events fire for the same
 * (defender, attacker) pair across consecutive frames.
 */
interface ActiveParcel {
  id: number;
  defenderId: string;
  attackerId: string;
  // Path total length captured once at mount; used to convert
  // progress (0..1) to the SVG `getPointAtLength` argument.
  totalLength: number;
  // Reference to the SVG path so we can call getPointAtLength
  // without re-querying every frame.
  pathEl: SVGPathElement;
  // Current point along the path; updated every RAF.
  cx: number;
  cy: number;
}

// Tuning slice (2026-05-10) — 5 → 7 per user direction. Bigger
// parcel reads more clearly at 1440p without dominating the arrow.
const PARCEL_RADIUS = 7;
const PARCEL_FILL = 'rgb(255, 240, 200)';
const PARCEL_STROKE = 'rgb(255, 200, 90)';

/** Read the current `prefers-reduced-motion: reduce` setting. */
function reducedMotionEnabled(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Locate the rendered combat-arrow `<path>` for the given defender.
 * CombatArrows emits one path per (attacker, defender) pair carrying
 * a {@code data-arrow-defender-id} attribute. Returns null when the
 * path isn't yet in the DOM (graceful skip).
 *
 * <p>Slice 5-X.0 BugHunter-7 — defender id is escaped via
 * {@code CSS.escape} before splicing into the attribute selector
 * so a malformed wire payload (or future format change introducing
 * special characters) can't crash the overlay with a SyntaxError.
 */
function findArrowPath(defenderId: string): SVGPathElement | null {
  if (typeof document === 'undefined') return null;
  try {
    const escaped =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(defenderId)
        : defenderId;
    return document.querySelector<SVGPathElement>(
      `path[data-arrow-defender-id="${escaped}"]`,
    );
  } catch {
    return null;
  }
}

export function DamageParcelOverlay() {
  // Active parcels keyed by id so React's reconciliation can
  // animate cx/cy in place rather than remount on every frame.
  const [parcels, setParcels] = useState<ReadonlyMap<number, ActiveParcel>>(
    () => new Map(),
  );
  // Monotonic counter — survives re-renders via ref so id collisions
  // can't happen across consecutive frames.
  const nextIdRef = useRef(0);
  // Pending stagger timeouts so unmount can cancel them all.
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  // Active RAF handles so unmount can cancel them.
  const activeRafsRef = useRef<Set<number>>(new Set());

  useDamageEvents((events) => {
    if (reducedMotionEnabled()) return;
    events.forEach((event, eventIdx) => {
      // Slice 5-A.2 — fire N parcels per event (one per damage point).
      // Each parcel landing decrements the defender's displayed life
      // by 1 via lifeDisplayStore. The full N-parcel stream fits
      // inside the tier budget (1000/2000/3000ms) so a 20-damage swing
      // still resolves in 3 seconds.
      const schedule = parcelSchedule(event.amount);
      const eventDelayMs = eventIdx * DAMAGE_PARCEL_STAGGER_MS;
      // Enqueue all ticks UPFRONT so the displayed life immediately
      // reflects the pending lag (wireLife + N) before the first
      // parcel lands. Each tickLand call decrements one. If a parcel's
      // arrow path can't be resolved at fire-time, startParcel
      // tick-lands immediately to keep the displayed life converging.
      useLifeDisplayStore
        .getState()
        .enqueueTicks(event.defenderId, schedule.count);
      for (let i = 0; i < schedule.count; i++) {
        const fireDelayMs = eventDelayMs + i * schedule.staggerMs;
        const timeoutHandle = setTimeout(() => {
          pendingTimeoutsRef.current.delete(timeoutHandle);
          startParcel(event, schedule.travelMs);
        }, fireDelayMs);
        pendingTimeoutsRef.current.add(timeoutHandle);
      }
    });
  });

  function startParcel(event: DamageEvent, travelMs: number) {
    const pathEl = findArrowPath(event.defenderId);
    if (pathEl == null) {
      // Graceful skip — arrow path isn't in the DOM (e.g., focal cell
      // remounting). Tick-land immediately so the displayed life keeps
      // converging to the wire value even though we lost this parcel's
      // visual.
      useLifeDisplayStore.getState().tickLand(event.defenderId);
      return;
    }
    const totalLength = pathEl.getTotalLength();
    if (!isFinite(totalLength) || totalLength <= 0) {
      // Same defensive tick-land for the geometry-degenerate case.
      useLifeDisplayStore.getState().tickLand(event.defenderId);
      return;
    }
    const id = nextIdRef.current++;
    const startPoint = pathEl.getPointAtLength(0);
    setParcels((prev) => {
      const next = new Map(prev);
      next.set(id, {
        id,
        defenderId: event.defenderId,
        attackerId: event.attackerId,
        totalLength,
        pathEl,
        cx: startPoint.x,
        cy: startPoint.y,
      });
      return next;
    });
    const startTime = performance.now();
    // Slice 5-X.0 Tech-1 — track this parcel's CURRENT raf handle
    // in a closure so each tick's new handle replaces the previous
    // one in `activeRafsRef`. Previously the Set just grew unbounded
    // for the parcel's lifetime; on completion the final handle is
    // also removed.
    let currentRaf = 0;
    const stepRafFn = (now: number) => {
      // Drop the just-fired handle from the cleanup Set (it's now
      // already executed, no point cancelling it).
      activeRafsRef.current.delete(currentRaf);
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / travelMs);
      const point = pathEl.getPointAtLength(progress * totalLength);
      setParcels((prev) => {
        const existing = prev.get(id);
        if (!existing) return prev; // Cleaned up.
        const next = new Map(prev);
        next.set(id, { ...existing, cx: point.x, cy: point.y });
        return next;
      });
      if (progress < 1) {
        currentRaf = requestAnimationFrame(stepRafFn);
        activeRafsRef.current.add(currentRaf);
      } else {
        // Travel complete — remove the parcel state entirely AND tick
        // the defender's displayed life down by 1. No new RAF queued
        // so currentRaf stays as the just-deleted handle.
        useLifeDisplayStore.getState().tickLand(event.defenderId);
        setParcels((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
    };
    currentRaf = requestAnimationFrame(stepRafFn);
    activeRafsRef.current.add(currentRaf);
  }

  useEffect(() => {
    return () => {
      // Cancel pending staggered starts.
      const timeouts = pendingTimeoutsRef.current;
      for (const t of timeouts) clearTimeout(t);
      timeouts.clear();
      // Cancel active travels.
      const rafs = activeRafsRef.current;
      for (const handle of rafs) cancelAnimationFrame(handle);
      rafs.clear();
      // Reset the displayed-life lag so a fresh game starts with
      // displayed = wire (no stuck pending ticks from a stream that
      // got cancelled mid-flight by the unmount).
      useLifeDisplayStore.getState().reset();
    };
  }, []);

  if (parcels.size === 0) {
    return (
      <svg
        data-testid="damage-parcel-overlay"
        data-parcel-count={0}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          // Z below ActionPanel chrome (z=30) but above the existing
          // viewport-fixed overlays (DefenderBeams z=5, TurnEdgeGlow
          // z=20). Parcels need to sit above arrows (which are
          // inside the focal cell, naturally below this fixed
          // overlay).
          zIndex: 25,
        }}
      />
    );
  }

  return (
    <svg
      data-testid="damage-parcel-overlay"
      data-parcel-count={parcels.size}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 25,
      }}
    >
      {Array.from(parcels.values()).map((p) => (
        <circle
          key={p.id}
          data-testid="damage-parcel"
          data-defender-id={p.defenderId}
          data-attacker-id={p.attackerId}
          cx={p.cx}
          cy={p.cy}
          r={PARCEL_RADIUS}
          fill={PARCEL_FILL}
          stroke={PARCEL_STROKE}
          strokeWidth={1}
          // Slice 5-X.0 UI-1 — dual drop-shadow: warm glow + dark
          // 1px outline so the parcel pops on warm-tinted arrows
          // (Boros / Mardu / mono-R defender colors) where the
          // single warm glow alone visually merges with the arrow
          // stroke.
          style={{
            filter:
              'drop-shadow(0 0 1px rgb(0 0 0 / 0.9)) drop-shadow(0 0 4px rgb(255 220 130 / 0.7))',
          }}
        />
      ))}
    </svg>
  );
}
