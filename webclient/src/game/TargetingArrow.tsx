import { useEffect, useState } from 'react';

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
  /** CSS color. Defaults to {@code --color-targeting-arrow}. */
  color?: string;
}

export function TargetingArrow({ source, to, color }: Props) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

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

  const stroke = color ?? 'var(--color-targeting-arrow)';

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
          id="targeting-arrow-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
        </marker>
      </defs>
      <path
        d={`M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`}
        stroke={stroke}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        markerEnd="url(#targeting-arrow-head)"
      />
    </svg>
  );
}
