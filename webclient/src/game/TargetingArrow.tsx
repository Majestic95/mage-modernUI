import { useEffect, useId, useState } from 'react';
import type { StrokeSpec } from './halo';
import {
  ARROW_INK_FADEOUT_MS,
  ARROW_INK_HEAD_DELAY_FRACTION,
  ATTACK_ARROW_INK_DRAW_MS,
  BLOCK_ARROW_INK_DRAW_MS,
} from '../animation/transitions';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * Slice 6-A — discriminated union telling TargetingArrow to mount the
 * ink-overlay sibling path on top of the base dashed arrow. The
 * "kind" picks the duration + easing: attack arrows draw 400ms with
 * smooth easing; block arrows snap-in over 200ms with overshoot
 * (slice 6-B). The base path's dasharray + transition are completely
 * untouched — the ink layer is a separate <path> sibling.
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
 * Slice 70-F (ADR 0011 D5) — SVG arrow overlay drawn from a source
 * point to a target point per design-system §7.7.
 *
 * <p><b>Slice 70-F scope:</b> ships the **cursor-tracking variant**
 * — an arrow drawn from a fixed anchor (the central focal zone for
 * targeting; from the attacker's pod for combat) to the cursor
 * during target-selection. The SOURCE-card-to-TARGET-card "persists
 * while the spell is on the stack" flavor (spec §7.7) requires
 * server-side data the wire doesn't surface today (which spell on
 * the stack owns which targets) — deferred to a follow-up.
 *
 * <p>The arrow renders only when a {@code source} is provided. Pass
 * null to hide. {@code to} is either a fixed coordinate (target
 * card center) or undefined for cursor-tracking. The component
 * subscribes to pointermove only when cursor-tracking is active to
 * avoid wasted listeners.
 *
 * <p>Reduced-motion compliance: the arrow itself doesn't animate;
 * it tracks the cursor 1:1. Slice 70-G will add a fade-in/fade-out
 * on enter/exit per spec §7.7 ("fades on resolve").
 *
 * <p><b>Bundle 1 / Slice 1-A — defender color + dash:</b> accepts
 * a {@link StrokeSpec} that may be a solid color or a multi-stop
 * gradient (defender's commander color identity). Each instance
 * carries a {@code useId()}-prefixed marker + gradient id so two
 * arrows on screen can paint with different colors without the
 * shared SVG fragment-id resolving to whichever marker is first
 * in the DOM. The legacy {@code color?: string} prop continues to
 * work for cursor-tracking targeting (single arrow, neutral) — when
 * neither {@code stroke} nor {@code color} is supplied the default
 * remains {@code --color-targeting-arrow}.
 */
interface Props {
  /** SVG-coordinate origin (where the arrow starts). */
  source: { x: number; y: number } | null;
  /**
   * SVG-coordinate destination. When undefined, the arrow tracks
   * the cursor (target-selection mode). When provided, draws a
   * static curve to that point (committed targets).
   */
  to?: { x: number; y: number };
  /**
   * Slice 1-A — full stroke spec (solid color OR multi-stop gradient).
   * When provided, takes precedence over the legacy {@code color}
   * prop. When omitted, falls back to {@code color}, then to
   * {@code --color-targeting-arrow}.
   */
  stroke?: StrokeSpec;
  /**
   * Legacy single-color override. Retained for cursor-tracking
   * targeting call sites which always render in the neutral
   * targeting-arrow color and don't need a defender lookup.
   * Defaults to {@code --color-targeting-arrow}.
   */
  color?: string;
  /**
   * Slice 1-A — SVG stroke-dasharray attribute (e.g. {@code "8 6"} for
   * dashed). Empty string = solid (SVG default). Indexed per defender
   * by {@link DEFENDER_DASH_PATTERNS} so color-blind users get a
   * non-color signal alongside the stroke color (WCAG 2.1 SC 1.4.1).
   */
  strokeDasharray?: string;
  /**
   * Per-arrow opacity (0..1). Defaults to 1. Used by CombatArrows'
   * hover-isolation: non-hovered arrows render at ~0.25 while the
   * hovered arrow stays at 1. Cursor-tracking targeting arrows
   * (target selection) omit this prop and render at full opacity.
   */
  opacity?: number;
  /**
   * Slice 1-A — defender player id this arrow points at, surfaced
   * as a {@code data-arrow-defender-id} attribute on the rendered
   * path so tests + future filtering UIs (incoming-tag click-to-pin
   * in slice 1-B) can target arrows by defender.
   */
  defenderId?: string;
  /**
   * Slice 1-A — defender index in the {@code players} array, surfaced
   * as {@code data-defender-index} on the rendered path. Pairs with
   * the dash-pattern signal so test fixtures can assert dash → defender
   * mapping deterministically. {@code | undefined} explicitly allowed
   * (under {@code exactOptionalPropertyTypes}) so callers can omit it
   * by passing {@code undefined} when the lookup fails (-1 sentinel).
   */
  defenderIndex?: number | undefined;
  /**
   * Slice 1-C — wave-reveal stagger delay in milliseconds. Appended
   * to the existing 120ms opacity transition as
   * {@code transition-delay} so each defender's arrows fade in a
   * beat after the previous defender's. CombatArrows computes this
   * per-arrow at render time (defender position × 90ms, capped at
   * 5 × 90 = 450ms, zeroed when {@code prefers-reduced-motion:
   * reduce} is active or when the arrow set isn't on first paint).
   * Default 0 — instant fade alongside the base transition.
   */
  revealDelayMs?: number | undefined;
  /**
   * Slice 6-A — when set, mounts a sibling "ink" path on top of the
   * base dashed arrow that animates {@code stroke-dashoffset} from
   * 1 → 0 over the kind-specific duration, then fades opacity to 0
   * over {@link ARROW_INK_FADEOUT_MS} and unmounts. The base path
   * is untouched. Latched on mount so a re-render with undefined
   * doesn't interrupt the in-flight animation.
   *
   * <p>Reduced-motion: the ink layer never mounts when the user has
   * {@code prefers-reduced-motion: reduce}; only the base path
   * renders. Storytelling beats are inherently motion-driven; the
   * static base path conveys the same information without animation.
   */
  drawIn?: DrawInSpec | undefined;
  /**
   * Slice 6-C — when set, mounts a third sibling "shimmer" path on
   * top of the base + ink layers that breathes a step-keyed color
   * overlay during damage steps. {@code 'first-strike'} → cool cyan-
   * white shimmer with a sharp 200ms cycle. {@code 'regular'} →
   * warm amber-orange shimmer with a slower 350ms cycle.
   *
   * <p>Cross-dissolve between palettes happens via CSS class swap
   * when the prop value changes (e.g. when the engine transitions
   * from FIRST_COMBAT_DAMAGE → COMBAT_DAMAGE on a creature with
   * first strike that survived to deal regular damage).
   *
   * <p>Reduced-motion: the keyframe animation is silenced by the
   * global rule, but the static stroke color persists so cool-vs-
   * warm differentiation is preserved as a static signal.
   */
  damageStep?: 'first-strike' | 'regular' | undefined;
}

export function TargetingArrow({
  source,
  to,
  stroke,
  color,
  strokeDasharray,
  opacity,
  defenderId,
  defenderIndex,
  revealDelayMs,
  drawIn,
  damageStep,
}: Props) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Slice 1-A — per-instance unique id prefix so simultaneously-
  // mounted TargetingArrow components don't share marker / gradient
  // ids. SVG fragment URLs (`url(#...)`) resolve document-globally,
  // so before this fix every arrowhead picked up the FIRST mounted
  // marker's fill regardless of its own marker config — invisible
  // when all arrows shared the same color, user-visible the moment
  // colors diverge per defender. useId() returns a stable ":r0:"-
  // shaped string per React 18; we strip the colons because some
  // older SVG tooling treats them as namespace prefixes.
  const reactId = useId();
  const uid = reactId.replace(/:/g, '');
  const markerId = `targeting-arrow-head-${uid}`;
  const gradientId = `targeting-arrow-grad-${uid}`;
  // Slice 6-A — ink layer's marker. Distinct id so the ink arrowhead
  // can fade independently from the base arrowhead (which doesn't
  // fade — it's the at-rest visual). The ink marker fill matches the
  // base marker so the ink visually "extends" the base color rather
  // than introducing a third hue.
  const inkMarkerId = `targeting-arrow-ink-head-${uid}`;

  // Slice 6-A — latch the drawIn prop on mount. A parent re-render
  // that flips drawIn back to undefined (CombatArrows marks the arrow
  // drawn after the first paint) must NOT interrupt the in-flight
  // animation; the latch ensures the local state machine runs to
  // completion regardless of subsequent prop changes.
  const [latchedDrawIn] = useState<DrawInSpec | undefined>(() => drawIn);
  const reducedMotion = usePrefersReducedMotion();
  // Reduced-motion is also evaluated via the latch — toggling
  // mid-animation is rare and the simpler "evaluated on mount"
  // semantics avoids snap-to-final-state edge cases.
  const [latchedReducedMotion] = useState<boolean>(() => reducedMotion);
  const inkActive = latchedDrawIn !== undefined && !latchedReducedMotion;

  // Slice 6-A — ink layer state machine.
  //   'mounting' — initial render, strokeDashoffset=1 (path hidden).
  //   'drawing'  — strokeDashoffset transitions 1 → 0 over drawMs.
  //   'fading'   — opacity transitions 1 → 0 over ARROW_INK_FADEOUT_MS.
  //   'done'     — ink path unmounts.
  type InkPhase = 'mounting' | 'drawing' | 'fading' | 'done';
  const [inkPhase, setInkPhase] = useState<InkPhase>(
    inkActive ? 'mounting' : 'done',
  );
  const [inkHeadVisible, setInkHeadVisible] = useState<boolean>(false);

  useEffect(() => {
    if (!inkActive) return;
    const drawMs =
      latchedDrawIn?.kind === 'block'
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

  // Track cursor only when the arrow is active AND no static
  // destination is provided. Listener teardown on hide is critical
  // — pointermove fires every frame at 60fps and we don't want it
  // running outside target-selection.
  useEffect(() => {
    if (!source || to) {
      setCursor(null);
      return;
    }
    const onMove = (ev: PointerEvent) => {
      setCursor({ x: ev.clientX, y: ev.clientY });
    };
    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
      setCursor(null);
    };
  }, [source, to]);

  if (!source) {
    return null;
  }

  const target = to ?? cursor;
  if (!target) {
    return null;
  }

  // Quadratic curve via the midpoint shifted up so the arrow
  // arches naturally rather than running as a straight line.
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2 - 40;

  // Slice 1-A — stroke + marker fill resolution.
  // Precedence: stroke (full spec) > color (legacy single-color) >
  // default targeting-arrow token. The marker fill resolves to the
  // gradient's last stop color (defender-side band) so the arrowhead
  // matches the band the user reads it ending in.
  const resolvedStroke: StrokeSpec = stroke
    ? stroke
    : { kind: 'solid', color: color ?? 'var(--color-targeting-arrow)' };
  const isGradient = resolvedStroke.kind === 'gradient';
  const pathStroke = isGradient
    ? `url(#${gradientId})`
    : resolvedStroke.color;
  const markerFill = isGradient
    ? resolvedStroke.stops[resolvedStroke.stops.length - 1]?.color ??
      'var(--color-targeting-arrow)'
    : resolvedStroke.color;

  return (
    <svg
      data-testid="targeting-arrow"
      aria-hidden="true"
      data-essential-motion="true"
      className="pointer-events-none fixed inset-0 z-40"
      width="100%"
      height="100%"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={markerFill} />
        </marker>
        {inkActive && inkPhase !== 'done' && (
          // Slice 6-A — ink-layer marker. Distinct id so its opacity
          // can be toggled independently of the base marker (which
          // is always visible at-rest). Same fill as the base marker
          // so the ink visually extends the base color rather than
          // introducing a third hue at the arrowhead.
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
        )}
        {isGradient && (
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
          >
            {resolvedStroke.stops.map((stop, i) => (
              <stop
                // Stops are positionally identified — `${offset}-${i}`
                // is unique even when duplicate-offset stops produce
                // hard color bands.
                key={`${stop.offset}-${i}`}
                offset={stop.offset}
                stopColor={stop.color}
              />
            ))}
          </linearGradient>
        )}
      </defs>
      <path
        data-arrow-layer="base"
        d={`M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
        stroke={pathStroke}
        strokeWidth="3"
        fill="none"
        // Slice 1-A — `linecap="butt"` (was `"round"`) so dash
        // patterns render at their nominal pixel widths. Round caps
        // add stroke-width/2 to each dash on both sides, which at
        // 3px stroke turned `'2 5'` (dotted) into 5px-rounded-pills
        // with 2px gaps — visually equivalent to `'8 6'` (dashed).
        // Butt caps preserve the per-defender dash distinction the
        // WCAG 1.4.1 redundancy claim depends on.
        strokeLinecap="butt"
        strokeDasharray={strokeDasharray || undefined}
        markerEnd={`url(#${markerId})`}
        opacity={opacity ?? 1}
        data-arrow-stroke-kind={resolvedStroke.kind}
        data-arrow-defender-id={defenderId}
        data-defender-index={
          defenderIndex !== undefined ? defenderIndex : undefined
        }
        // Opacity-only fade — exempt from prefers-reduced-motion per
        // WCAG 2.1 SC 2.3.3 (motion targets translation/parallax/
        // autoplay, not fades). Short 120ms keeps hover-isolation
        // feedback snappy without feeling instant.
        // Slice 1-C — revealDelayMs (capped at 450ms by the caller)
        // staggers each defender's arrows in turn on first-paint.
        // Caller zeroes the delay under prefers-reduced-motion or
        // on subsequent renders, so the inline transitionDelay falls
        // back to 0ms naturally without a separate code path here.
        style={{
          transition: 'opacity 120ms ease-out',
          transitionDelay: revealDelayMs ? `${revealDelayMs}ms` : '0ms',
        }}
      />
      {inkActive && inkPhase !== 'done' && (
        // Slice 6-A — ink overlay path. pathLength="1" normalises the
        // path's stroke math to [0..1] so the dasharray "1 1" + a
        // dashoffset that animates 1 → 0 produces a smooth pen-stroke
        // sweep regardless of the curve's actual pixel length. Easing
        // is symmetric cubic-bezier per the brief default.
        //
        // Lifecycle: 'mounting' → strokeDashoffset=1 (path hidden);
        // requestAnimationFrame → 'drawing' → strokeDashoffset=0 with
        // transition; setTimeout(drawMs) → 'fading' → opacity=0 with
        // transition; setTimeout(drawMs + fadeoutMs) → 'done' → unmount.
        // The arrowhead's opacity is gated separately on inkHeadVisible
        // so it appears only in the last quarter of the draw.
        <path
          data-arrow-layer="ink"
          data-ink-phase={inkPhase}
          d={`M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
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
                latchedDrawIn?.kind === 'block'
                  ? BLOCK_ARROW_INK_DRAW_MS
                  : ATTACK_ARROW_INK_DRAW_MS
              }ms ${
                latchedDrawIn?.kind === 'block'
                  ? 'cubic-bezier(0.5, 0, 0.4, 1.4)'
                  : 'cubic-bezier(0.45, 0, 0.55, 1)'
              }`,
              `opacity ${ARROW_INK_FADEOUT_MS}ms ease-out`,
            ].join(', '),
          }}
        />
      )}
      {damageStep !== undefined && (
        // Slice 6-C — shimmer overlay path. Step-keyed CSS class
        // controls stroke color + keyframe animation:
        //   'first-strike' → cool cyan-white, sharp 200ms cycle
        //   'regular'      → warm amber-orange, slower 350ms cycle
        // mix-blend-mode: screen (in CSS) lifts the shimmer over the
        // existing arrow stroke without obscuring the per-defender
        // color identity underneath. Cross-dissolve between palettes
        // happens via React's natural class swap when damageStep
        // changes (engine transitions FIRST_COMBAT_DAMAGE → COMBAT_DAMAGE).
        <path
          data-arrow-layer="shimmer"
          data-damage-step={damageStep}
          d={`M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
          strokeWidth="5"
          strokeLinecap="butt"
          className={
            damageStep === 'first-strike'
              ? 'arrow-shimmer-first-strike'
              : 'arrow-shimmer-regular'
          }
        />
      )}
    </svg>
  );
}
