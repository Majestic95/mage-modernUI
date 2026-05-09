import { useEffect, useId, useState } from 'react';
import type { StrokeSpec } from './halo';

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
        style={{ transition: 'opacity 120ms ease-out' }}
      />
    </svg>
  );
}
