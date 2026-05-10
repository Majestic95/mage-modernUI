import { useEffect, useId, useState } from 'react';
import type { StrokeSpec } from './halo';
import { ArrowInkLayer, type DrawInSpec } from './ArrowInkLayer';
import { ArrowShimmerLayer } from './ArrowShimmerLayer';

// Re-export DrawInSpec so the existing CombatArrows + tests import
// path stays valid (Slice 6-Y.2 split moved the canonical definition
// into ArrowInkLayer.tsx; the public API surface is unchanged).
export type { DrawInSpec };

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
 * it tracks the cursor 1:1.
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
 *
 * <p><b>Slice 6-Y.2 — file split (2026-05-11):</b> ink-overlay (slice
 * 6-A v2) extracted to {@link ArrowInkLayer}; shimmer-overlay (slice
 * 6-C) extracted to {@link ArrowShimmerLayer}. This file owns the
 * base path + its marker/gradient defs + cursor-tracking pointer
 * lifecycle. The two sub-components render React Fragments inside
 * the parent {@code <svg>} so multiple {@code <defs>} blocks coexist
 * naturally and fragment-URLs ({@code url(#id)}) resolve document-
 * scoped.
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
   * over {@code ARROW_INK_FADEOUT_MS} and unmounts. The base path
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
   * when the prop value changes; the {@code transition: stroke
   * 300ms ease-in-out} rule in {@code .arrow-shimmer-*} interpolates
   * the stroke color smoothly (slice 6-X.0 F-M-N2 fix).
   *
   * <p>Reduced-motion: the explicit
   * {@code @media (prefers-reduced-motion: reduce)} block in
   * {@code index.css} silences the keyframe animation; the static
   * stroke color persists with class-base {@code opacity: 0.4} so
   * cool-vs-warm differentiation is preserved as a static signal
   * (slice 6-X.0 F-T-B1 / F-G-B1 / F-M-N3 fix).
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

  // Slice 6-A — latch the drawIn prop on mount. A parent re-render
  // that flips drawIn back to undefined (CombatArrows marks the arrow
  // drawn after the first paint) must NOT unmount the ink layer; the
  // latch ensures ArrowInkLayer stays in the tree so its local state
  // machine runs to completion regardless of subsequent prop changes.
  // ArrowInkLayer self-unmounts via returning null once its `done`
  // phase fires. The latch lives HERE (not inside ArrowInkLayer)
  // because React unmounts a conditionally-rendered child the instant
  // the parent's gate flips to false — internal latching would arrive
  // too late.
  const [latchedDrawIn] = useState<DrawInSpec | undefined>(() => drawIn);

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
  const d = `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;

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
        d={d}
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
      {latchedDrawIn !== undefined && (
        <ArrowInkLayer
          d={d}
          pathStroke={pathStroke}
          markerFill={markerFill}
          drawIn={latchedDrawIn}
        />
      )}
      {damageStep !== undefined && (
        <ArrowShimmerLayer d={d} damageStep={damageStep} />
      )}
    </svg>
  );
}
