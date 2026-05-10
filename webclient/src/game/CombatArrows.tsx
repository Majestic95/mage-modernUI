import { useEffect, useMemo, useState } from 'react';
import type {
  WebCombatGroupView,
  WebPlayerView,
} from '../api/schemas';
import {
  ARROW_REVEAL_MAX_INDEX,
  ARROW_REVEAL_STEP_MS,
} from '../animation/transitions';
import { TargetingArrow } from './TargetingArrow';
import { useCombatArrowGeometry } from './combatArrowGeometry';
import {
  getCombatArrowsAlreadyStaggered,
  hasArrowDrawn,
  markArrowDrawn,
  markCombatArrowsStaggered,
  useArrowIsolation,
} from './arrowIsolationStore';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Combat-arrow overlay — extracted from StackZone.tsx (was at 865
 * LOC, past the 500 hard cap with no documented exception). The
 * geometry layer (ArrowSpec, useCombatArrowGeometry, fingerprint
 * memo, DOM-rect helpers) was further split out into
 * {@link ./combatArrowGeometry} in slice 1-X.0 (mechanical-tier,
 * 2026-05-09) so this file lands back under cap with room for slices
 * 1-B / 1-C / 1-D to layer on. This file owns only:
 *
 * <ul>
 *   <li>{@link CombatArrows} — renders one TargetingArrow per
 *       attacker→defender (or attacker→blocker) pair.</li>
 *   <li>{@link useHoveredCombatId} — tracks which combat
 *       participant the cursor is over so the renderer can dim
 *       non-hovered arrows.</li>
 * </ul>
 *
 * <p><b>Why hover-isolation:</b> in dense combat the user wants to
 * trace one creature's connection without losing the full picture.
 * Hovering a {@code data-permanent-id} (attacker / blocker) or a
 * {@code data-portrait-target-player-id} (defender) sets the active
 * id; arrows touching that id stay at full opacity, the rest dim
 * to {@link ARROW_DIM_OPACITY}. Hovering off-board clears isolation.
 */

// User-tuned to 0.2 — hover-isolation is an opt-in focus gesture
// (cursor on a badge / portrait / permanent), not a passive visual
// state, so trading the WCAG 1.4.11 3:1 baseline for "barely visible"
// dim is the intended UX: full picture stays one cursor-move away.
const ARROW_DIM_OPACITY = 0.2;

// Slice 1-C — wave-reveal stagger constants live in
// `webclient/src/animation/transitions.ts` per the project's motion-
// registry convention (Graphical critic 1-C, GC-N3). Both
// `ARROW_REVEAL_STEP_MS` and `ARROW_REVEAL_MAX_INDEX` are imported
// from there so future retunes happen in one place.

/**
 * Slice 6-C — derive the shimmer-overlay palette from the wire's
 * combat-step string. Returns {@code undefined} for any step outside
 * the two damage steps so the shimmer overlay only mounts during
 * actual damage resolution; PRECOMBAT_MAIN, DECLARE_ATTACKERS, etc.
 * all return undefined.
 */
function damageStepFromGameStep(
  step: string | undefined,
): 'first-strike' | 'regular' | undefined {
  if (step === 'FIRST_COMBAT_DAMAGE') return 'first-strike';
  if (step === 'COMBAT_DAMAGE') return 'regular';
  return undefined;
}

export function CombatArrows({
  combat,
  players = [],
  step,
}: {
  combat: readonly WebCombatGroupView[];
  /**
   * Slice 1-A — players array used to resolve the defender's
   * commander color identity into the arrow stroke + dash pattern.
   * Optional with a default of {@code []} so older call sites that
   * don't yet plumb players don't crash; arrows fall back to the
   * legacy neutral teal stroke when no defender is found in the list.
   */
  players?: readonly WebPlayerView[];
  /**
   * Slice 6-C — wire's combat step (e.g. {@code 'FIRST_COMBAT_DAMAGE'}
   * / {@code 'COMBAT_DAMAGE'}) used to derive the per-arrow shimmer
   * overlay's palette. Passed through to TargetingArrow's
   * {@code damageStep} prop after the FIRST_COMBAT_DAMAGE → 'first-
   * strike' / COMBAT_DAMAGE → 'regular' / else → undefined mapping.
   * Optional so older call sites + tests don't need to plumb it.
   */
  step?: string | undefined;
}) {
  const damageStep = damageStepFromGameStep(step);
  const arrows = useCombatArrowGeometry(combat, players);
  const hoveredId = useHoveredCombatId();
  // Slice 1-B — pinned-defender id from the IncomingTag click affordance.
  // Pin wins over hover (sticky filter takes precedence over transient
  // cursor hover); cursor hover still works when no pin is active.
  const pinnedDefenderId = useArrowIsolation((s) => s.pinnedDefenderId);
  const clearPin = useArrowIsolation((s) => s.clearPin);

  // Slice 1-C — first-paint reveal stagger. State lives at module
  // scope in arrowIsolationStore so a stack push during combat
  // (which unmounts CombatArrows entirely — see StackZoneRedesigned)
  // doesn't replay the cinematic when the stack resolves and arrows
  // remount. The phase watcher in arrowIsolationStore auto-resets
  // the flag on COMBAT → non-COMBAT transitions, so a fresh combat
  // re-staggers from scratch.
  const reducedMotion = usePrefersReducedMotion();
  const isFirstPaint = !getCombatArrowsAlreadyStaggered() && arrows.length > 0;
  useEffect(() => {
    if (arrows.length > 0) {
      markCombatArrowsStaggered();
    }
  }, [arrows.length]);

  // Slice 1-C — defender-order index for the stagger cadence.
  // Brief: `defenderOrder.indexOf(arrow.defenderId) * 90` (the
  // defender's index in *the order they appear in combat*), NOT
  // their position in the players array. Sparse cases — e.g., only
  // opponents at players-indices 2 and 3 are being attacked — should
  // produce consecutive 0/90 ms delays, not gap-prone 180/270 ms.
  // Memo deps just on `arrows` (not on a fingerprint) — adding a
  // fingerprint would conflict with the brief's load-bearing
  // "delay derivation must NOT enter useCombatFingerprint" rule.
  const defenderOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const arrow of arrows) {
      if (!seen.has(arrow.defenderId)) {
        seen.add(arrow.defenderId);
        order.push(arrow.defenderId);
      }
    }
    return order;
  }, [arrows]);

  // Slice 1-B — Escape clears the pin globally. Listener registers
  // alongside CombatArrows and tears down on unmount. The cleanup
  // does NOT clear the pin: CombatArrows unmounts every time a stack
  // appears mid-combat (StackZoneRedesigned mounts arrows only when
  // stack is empty + combat active), so unmount-clearing would
  // silently kill the user's pin on every instant cast. Pin lifetime
  // instead lives on a module-level phase watcher in
  // {@link arrowIsolationStore} that auto-clears on COMBAT → non-
  // COMBAT transitions — surviving stack pushes within combat,
  // dying only when combat actually ends.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        clearPin();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [clearPin]);

  if (arrows.length === 0) {
    return (
      <div
        data-testid="stack-zone"
        data-stack-mode="combat-pending"
        aria-hidden="true"
      />
    );
  }

  // Slice 1-B — isolation precedence: pinned id (sticky, from
  // IncomingTag click) wins over hovered id (transient, from cursor).
  // The pinned id is a player UUID; convert to the same `player:<id>`
  // shape `useHoveredCombatId` returns for portrait hits so downstream
  // matching is uniform.
  const isolatingId = pinnedDefenderId
    ? `player:${pinnedDefenderId}`
    : hoveredId;
  const isolating = isolatingId !== null;

  return (
    <div
      data-testid="stack-zone"
      data-stack-mode="combat"
      data-arrow-count={arrows.length}
      data-hover-isolating={isolating || undefined}
      aria-hidden="true"
    >
      {arrows.map((spec) => {
        const matches =
          isolating &&
          (spec.attackerId === isolatingId || spec.targetId === isolatingId);
        const opacity = !isolating ? 1 : matches ? 1 : ARROW_DIM_OPACITY;
        // Slice 1-C — per-arrow reveal delay. Only applied on the
        // first-paint transition (no prior stagger this combat) AND
        // when the user hasn't opted into reduced motion. The
        // `Math.max(0, ...)` clamp neutralises the (-1) indexOf
        // miss (defenderId not present in defenderOrder — shouldn't
        // happen, defensive against future refactors).
        const orderIndex = defenderOrder.indexOf(spec.defenderId);
        const clampedIndex = Math.max(
          0,
          Math.min(orderIndex, ARROW_REVEAL_MAX_INDEX),
        );
        const revealDelayMs =
          isFirstPaint && !reducedMotion
            ? clampedIndex * ARROW_REVEAL_STEP_MS
            : 0;
        // Slice 6-A — attack-arrow ink draw-in (attacker→player,
        // 400ms symmetric ease).
        // Slice 6-B (2026-05-10) — block-arrow snap-in (attacker→
        // blocker, 200ms with cubic-bezier(0.5,0,0.4,1.4) overshoot
        // easing). The mechanism is shared via TargetingArrow's
        // `drawIn` prop discriminated union; only the kind changes.
        //
        // Per-arrow tracking key:
        //   attack arrows (target = player:<defenderId>) → attacker id
        //   block arrows  (target = blocker permanent id) → blocker id
        // The blocker-id key matters for reblocking after a destroyed
        // blocker — a fresh blocker has a fresh permanent id, so the
        // ink overlay redraws cleanly even though the attacker is the
        // same.
        //
        // Reduced-motion is gated inside TargetingArrow; we mark the
        // arrow drawn either way so a future un-toggle of reduced
        // motion mid-combat doesn't suddenly replay a missed cinematic.
        const isAttackArrow = spec.targetId.startsWith('player:');
        const arrowKindTrackId = isAttackArrow
          ? spec.attackerId
          : spec.targetId; // block arrow → blocker permanent id
        const drawIn = !hasArrowDrawn(arrowKindTrackId)
          ? isAttackArrow
            ? ({ kind: 'attack' } as const)
            : ({ kind: 'block' } as const)
          : undefined;
        return (
          <ArrowRow
            key={spec.key}
            spec={spec}
            opacity={opacity}
            revealDelayMs={revealDelayMs}
            drawIn={drawIn}
            markId={arrowKindTrackId}
            damageStep={damageStep}
          />
        );
      })}
    </div>
  );
}

/**
 * Slice 6-A / 6-B — per-arrow render row. Extracted so we can mount
 * a per-arrow useEffect that marks the arrow as "drawn" on first
 * paint. Inlining the useEffect inside the .map callback would
 * violate React's rules-of-hooks (hooks must run in stable order
 * across renders; .map's iteration count varies with combat shape).
 *
 * <p>The {@code markId} is the permanent id we record as "drew its
 * ink overlay this combat phase." For attack arrows (6-A) that's the
 * attacker id; for block arrows (6-B) it's the blocker permanent id.
 * Both branches go through the same Set in arrowIsolationStore — id
 * collisions can't happen because attacker and blocker permanent ids
 * are pulled from the same engine-side UUID space (no overlap).
 */
function ArrowRow({
  spec,
  opacity,
  revealDelayMs,
  drawIn,
  markId,
  damageStep,
}: {
  spec: import('./combatArrowGeometry').ArrowSpec;
  opacity: number;
  revealDelayMs: number;
  drawIn: { kind: 'attack' } | { kind: 'block' } | undefined;
  markId: string;
  damageStep: 'first-strike' | 'regular' | undefined;
}) {
  // Mark the arrow as drawn on first paint so a re-render or stack-
  // push remount within the same combat phase doesn't replay the ink
  // animation. The phase watcher in arrowIsolationStore clears the
  // set on COMBAT exit so the next combat phase replays fresh.
  useEffect(() => {
    if (drawIn !== undefined) {
      markArrowDrawn(markId);
    }
  }, [drawIn, markId]);

  return (
    <TargetingArrow
      source={spec.source}
      to={spec.target}
      stroke={spec.stroke}
      strokeDasharray={spec.dashArray}
      opacity={opacity}
      defenderId={spec.defenderId}
      // Slice 1-A — drop -1 sentinel (defender not in players)
      // at the boundary so the rendered DOM doesn't surface a
      // confusing `data-defender-index="-1"` to downstream
      // consumers (slice 1-B's incoming-tag pin-by-defender,
      // slice 1-D's beams). Pattern lookup already returns ''
      // for -1 so the visual fallback is unaffected.
      defenderIndex={
        spec.defenderIndex >= 0 ? spec.defenderIndex : undefined
      }
      revealDelayMs={revealDelayMs}
      drawIn={drawIn}
      damageStep={damageStep}
    />
  );
}

/**
 * Tracks the cursor-targeted combat participant id. Returns:
 * <ul>
 *   <li>a permanent id (attacker or blocker) when the cursor is
 *       over a {@code data-permanent-id} element,</li>
 *   <li>{@code "player:<uuid>"} when the cursor is over a
 *       {@code data-portrait-target-player-id} element,</li>
 *   <li>{@code null} otherwise (no isolation).</li>
 * </ul>
 *
 * <p>Document-level pointerover listener. Fast path: closest() on
 * the immediate event target. Slow path (when the immediate target
 * isn't a combat element): walk the elementsFromPoint stack so a
 * tooltip / HoverCardDetail painted ON TOP of an attacker tile
 * still resolves to the underlying tile rather than clearing
 * isolation. setHovered bails out via Object.is when the resolved
 * id doesn't change, so transitions between nested children of
 * the same tile don't trigger re-renders.
 */
function useHoveredCombatId(): string | null {
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const matchOn = (el: Element): string | null => {
      const tile = el.closest('[data-permanent-id]');
      if (tile) return tile.getAttribute('data-permanent-id');
      const portrait = el.closest('[data-portrait-target-player-id]');
      if (portrait) {
        const pid = portrait.getAttribute('data-portrait-target-player-id');
        return pid ? `player:${pid}` : null;
      }
      return null;
    };
    const onOver = (ev: PointerEvent) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (target) {
        const fast = matchOn(target);
        if (fast !== null) {
          setHovered(fast);
          return;
        }
      }
      // Slow path — peek beneath the cursor for stacked combat
      // elements (tooltip / portal painted on top).
      if (typeof document.elementsFromPoint === 'function') {
        const stack = document.elementsFromPoint(ev.clientX, ev.clientY);
        for (const el of stack) {
          const id = matchOn(el);
          if (id !== null) {
            setHovered(id);
            return;
          }
        }
      }
      setHovered(null);
    };
    document.addEventListener('pointerover', onOver);
    return () => {
      document.removeEventListener('pointerover', onOver);
    };
  }, []);

  return hovered;
}
