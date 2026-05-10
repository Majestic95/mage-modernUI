import { useEffect, useId, useState } from 'react';
import {
  ARROW_INK_FADEOUT_MS,
  ARROW_INK_HEAD_DELAY_FRACTION,
  ATTACK_ARROW_INK_DRAW_MS,
  BLOCK_ARROW_INK_DRAW_MS,
} from '../animation/transitions';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Slice 6-A — discriminated union telling {@link TargetingArrow} to
 * mount the ink-overlay sibling path on top of the base dashed arrow.
 * The "kind" picks the duration + easing: attack arrows draw 400ms
 * with smooth easing; block arrows snap-in over 200ms with overshoot
 * (slice 6-B). The base path's dasharray + transition are completely
 * untouched — the ink layer is a separate {@code <path>} sibling.
 *
 * <p>The prop is LATCHED on mount via {@link useState}'s lazy init so
 * a parent re-render that flips drawIn back to undefined mid-animation
 * doesn't unmount the ink path; the local state machine runs to
 * completion. CombatArrows leverages this by marking the arrow
 * "drawn" immediately on first paint via {@code markArrowDrawn}, so
 * the very next render passes drawIn=undefined — a re-mount within
 * the same combat phase (stack push) sees the marked id and passes
 * undefined too, suppressing replay.
 */
export interface DrawInSpec {
  kind: 'attack' | 'block';
}

/**
 * Slice 6-Y.2 — extracted from {@link TargetingArrow} (was 467 LOC,
 * past the 400 soft cap). Owns the ink-overlay state machine, the
 * sibling {@code <path data-arrow-layer="ink">} element, and its
 * companion {@code <marker>} definition. Renders as a React Fragment
 * so it slots into the parent {@code <svg>} cleanly — multiple
 * {@code <defs>} blocks within one SVG are valid, and SVG fragment-
 * URLs ({@code url(#id)}) are document-scoped so the marker reference
 * resolves regardless of which {@code <defs>} declared it.
 *
 * <p><b>Lifecycle (state machine):</b>
 * <ol>
 *   <li>{@code 'mounting'} — initial render, {@code strokeDashoffset=1}
 *       (path hidden, dasharray "1 1" with pathLength 1).</li>
 *   <li>{@code 'drawing'} — {@code requestAnimationFrame} kicks
 *       {@code strokeDashoffset} → 0 with the kind-specific
 *       transition (400ms attack / 200ms block).</li>
 *   <li>{@code 'fading'} — after the draw window, opacity transitions
 *       1 → 0 over {@link ARROW_INK_FADEOUT_MS}.</li>
 *   <li>{@code 'done'} — ink layer unmounts.</li>
 * </ol>
 *
 * <p>The arrowhead is gated separately on {@code inkHeadVisible}
 * (toggled at {@link ARROW_INK_HEAD_DELAY_FRACTION} × drawMs) so it
 * appears only in the last ~quarter of the draw window — fulfills the
 * brief's "arrowhead appears only at the end of the path" intent.
 *
 * <p>Reduced-motion: latched on mount; when {@code prefers-reduced-
 * motion: reduce} is active at mount time, the component renders
 * nothing. The base path's static visual is the at-rest state.
 */
interface Props {
  /** Path d-attribute (shared with base + shimmer paths). */
  d: string;
  /** Resolved stroke color or url(#gradient) reference. */
  pathStroke: string;
  /** Marker arrowhead fill color (last gradient stop or solid color). */
  markerFill: string;
  /** Draw-in kind + tracking discriminator. Latched on mount. */
  drawIn: DrawInSpec;
}

export function ArrowInkLayer({ d, pathStroke, markerFill, drawIn }: Props) {
  // Slice 6-Y.2 — useId per-instance so simultaneously-mounted
  // arrows don't collide on the ink-marker fragment URL. Distinct
  // from the parent's markerId since each layer's marker can fade
  // independently from the others.
  const reactId = useId();
  const uid = reactId.replace(/:/g, '');
  const inkMarkerId = `targeting-arrow-ink-head-${uid}`;

  // Slice 6-A — latch the drawIn prop on mount. A parent re-render
  // that flips drawIn back to undefined (CombatArrows marks the arrow
  // drawn after the first paint) must NOT interrupt the in-flight
  // animation; the latch ensures the local state machine runs to
  // completion regardless of subsequent prop changes.
  const [latchedDrawIn] = useState<DrawInSpec>(() => drawIn);
  const reducedMotion = usePrefersReducedMotion();
  // Reduced-motion is also evaluated via the latch — toggling
  // mid-animation is rare and the simpler "evaluated on mount"
  // semantics avoids snap-to-final-state edge cases.
  const [latchedReducedMotion] = useState<boolean>(() => reducedMotion);
  const inkActive = !latchedReducedMotion;

  type InkPhase = 'mounting' | 'drawing' | 'fading' | 'done';
  const [inkPhase, setInkPhase] = useState<InkPhase>(
    inkActive ? 'mounting' : 'done',
  );
  const [inkHeadVisible, setInkHeadVisible] = useState<boolean>(false);

  useEffect(() => {
    if (!inkActive) return;
    const drawMs =
      latchedDrawIn.kind === 'block'
        ? BLOCK_ARROW_INK_DRAW_MS
        : ATTACK_ARROW_INK_DRAW_MS;
    // requestAnimationFrame lets the browser commit the initial
    // strokeDashoffset=1 paint before we flip to 0; without the
    // raf, React batches both states into a single commit and the
    // transition fires from the final value (no animation).
    const rafId = requestAnimationFrame(() => {
      setInkPhase('drawing');
    });
    const headDelayMs = drawMs * ARROW_INK_HEAD_DELAY_FRACTION;
    const headTimer = setTimeout(() => {
      setInkHeadVisible(true);
    }, headDelayMs);
    const fadeTimer = setTimeout(() => {
      setInkPhase('fading');
    }, drawMs);
    const doneTimer = setTimeout(() => {
      setInkPhase('done');
    }, drawMs + ARROW_INK_FADEOUT_MS);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(headTimer);
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [inkActive, latchedDrawIn]);

  if (!inkActive || inkPhase === 'done') return null;

  return (
    <>
      <defs>
        {/* Slice 6-A — ink-layer marker. Distinct id so its opacity
            can be toggled independently of the base marker (which is
            always visible at-rest). Same fill as the base marker so
            the ink visually extends the base color rather than
            introducing a third hue at the arrowhead. */}
        <marker
          id={inkMarkerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={markerFill} />
        </marker>
      </defs>
      {/* Slice 6-A — ink overlay path. pathLength="1" normalises the
          path's stroke math to [0..1] so the dasharray "1 1" + a
          dashoffset that animates 1 → 0 produces a smooth pen-stroke
          sweep regardless of the curve's actual pixel length. Easing
          is symmetric cubic-bezier for attack arrows per the brief's
          default; block arrows use cubic-bezier(0.5,0,0.4,1.4) for a
          snap-with-overshoot feel.

          Lifecycle: 'mounting' → strokeDashoffset=1 (path hidden);
          requestAnimationFrame → 'drawing' → strokeDashoffset=0 with
          transition; setTimeout(drawMs) → 'fading' → opacity=0 with
          transition; setTimeout(drawMs + fadeoutMs) → 'done' → unmount.
          The arrowhead's opacity is gated separately on inkHeadVisible
          so it appears only in the last quarter of the draw. */}
      <path
        data-arrow-layer="ink"
        data-ink-phase={inkPhase}
        d={d}
        stroke={pathStroke}
        strokeWidth="3"
        fill="none"
        strokeLinecap="butt"
        pathLength={1}
        strokeDasharray="1 1"
        markerEnd={inkHeadVisible ? `url(#${inkMarkerId})` : undefined}
        style={{
          strokeDashoffset: inkPhase === 'mounting' ? 1 : 0,
          opacity: inkPhase === 'fading' ? 0 : 1,
          transition: [
            `stroke-dashoffset ${
              latchedDrawIn.kind === 'block'
                ? BLOCK_ARROW_INK_DRAW_MS
                : ATTACK_ARROW_INK_DRAW_MS
            }ms ${
              latchedDrawIn.kind === 'block'
                ? 'cubic-bezier(0.5, 0, 0.4, 1.4)'
                : 'cubic-bezier(0.45, 0, 0.55, 1)'
            }`,
            `opacity ${ARROW_INK_FADEOUT_MS}ms ease-out`,
          ].join(', '),
        }}
      />
    </>
  );
}
