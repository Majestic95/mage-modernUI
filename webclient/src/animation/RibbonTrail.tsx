import { manaTokenForCode } from '../game/halo';
import { CINEMATIC_HOLD_MS } from './transitions';

/**
 * Slice 70-Z.3 — color-tinted ribbon trail accompanying a cinematic
 * cast. Renders as a fixed-position SVG quadratic-Bezier path from
 * the cast source (passed in as {@code sourceCenter}) to viewport
 * center. {@code stroke-dashoffset} animates from path-length to
 * 0 so the visible stroke "draws" along the path — a streamer
 * following the card's flight — then fades the last 40% of the
 * duration so the trail dissipates.
 *
 * <p><b>Color:</b> single-color spells use the spell's mana token
 * (W/U/B/R/G via {@link manaTokenForCode}). Multicolor spells use a
 * {@code <linearGradient>} with one stop per color, evenly spaced.
 * Colorless renders via {@code --color-team-neutral}.
 *
 * <p><b>Source bbox:</b> resolved by the parent (CardAnimationLayer)
 * at cast-event time — passing it in as a prop keeps this component
 * pure (no useEffect-driven setState pattern that the React lint
 * rule {@code react-hooks/set-state-in-effect} flags).
 *
 * <p><b>Reduced motion:</b> {@code CardAnimationLayer} skips
 * mounting this component entirely when {@code prefers-reduced-motion}
 * is set, so no internal gate is needed. The CSS keyframe is also
 * silenced by the global media query as belt-and-suspenders.
 */
export function RibbonTrail({
  cardId,
  colors,
  sourceCenter,
  targetCenter,
}: {
  cardId: string;
  colors: readonly string[];
  /**
   * Source position in viewport coordinates (e.g. center of the
   * caster's hand bbox or pod). When null, the trail renders
   * nothing — graceful degradation when the source can't be
   * resolved (no my-hand mounted yet, opponent pod off-screen, etc.).
   */
  sourceCenter: { x: number; y: number } | null;
  /**
   * Destination — the central focal zone center, NOT viewport
   * center. Slice 70-Z.3 critic IMP-5 fix: viewport center sits
   * ~180px right of the actual focal-tile position because the
   * side-panel takes the right portion of the viewport. Anchoring
   * to the focal-zone bbox keeps the ribbon end aligned with the
   * cinematic-pose card.
   */
  targetCenter: { x: number; y: number } | null;
}): React.JSX.Element | null {
  if (!sourceCenter || !targetCenter) return null;
  if (typeof window === 'undefined') return null;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const sx = sourceCenter.x;
  const sy = sourceCenter.y;
  const ex = targetCenter.x;
  const ey = targetCenter.y;

  // Quadratic control point — push the curve PERPENDICULAR to the
  // straight line midpoint so the trail arcs visibly. Slice 70-Z.3
  // critic CRIT-3 fix: pick the perpendicular direction whose
  // y-component is more negative (toward viewport top) so the arc
  // reads as "thrown overhand" for non-vertical chords. For
  // near-vertical chords (where perp y is ~0), apply a fixed
  // lateral bias so we don't degenerate to a straight line.
  const midX = (sx + ex) / 2;
  const midY = (sy + ey) / 2;
  const dx = ex - sx;
  const dy = ey - sy;
  const chord = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  // Perpendicular candidates: rotating the chord by ±90°.
  const perpAx = -dy / chord;
  const perpAy = dx / chord;
  // Pick the candidate with the more-negative y (= more "upward")
  // unless both are ~horizontal (vertical chord), in which case
  // pick the one with the more-negative x (= toward viewport left)
  // so vertical chords still get a visible lateral bow.
  let perpX: number;
  let perpY: number;
  if (Math.abs(perpAy) < 0.05) {
    // Vertical chord — perp is ~horizontal. Bias to viewport left.
    perpX = perpAx <= 0 ? perpAx : -perpAx;
    perpY = 0;
  } else if (perpAy < 0) {
    perpX = perpAx;
    perpY = perpAy;
  } else {
    perpX = -perpAx;
    perpY = -perpAy;
  }
  const arcMag = chord * 0.2;
  const cpx = midX + perpX * arcMag;
  const cpy = midY + perpY * arcMag;
  const dString = `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  const length = approxQuadraticLength(sx, sy, cpx, cpy, ex, ey);

  const isMulticolor = colors.length > 1;
  const stroke = strokeForColors(colors);
  const gradientId = `ribbon-gradient-${cardId}`;
  // Sweep duration = LAYOUT_GLIDE travel (~350ms estimate) + the
  // pose hold so the trail finishes drawing as the card arrives.
  const sweepMs = 350 + CINEMATIC_HOLD_MS;

  return (
    <svg
      data-testid="ribbon-trail"
      data-card-id={cardId}
      data-essential-motion="true"
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="pointer-events-none fixed inset-0"
      style={{ overflow: 'visible' }}
    >
      {isMulticolor && (
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse">
            {colors.map((c, i) => (
              <stop
                key={`${c}-${i}`}
                offset={`${(i / Math.max(colors.length - 1, 1)) * 100}%`}
                stopColor={manaTokenForCode(c)}
              />
            ))}
          </linearGradient>
        </defs>
      )}
      <path
        d={dString}
        fill="none"
        stroke={isMulticolor ? `url(#${gradientId})` : stroke}
        strokeWidth={3}
        strokeLinecap="round"
        strokeOpacity={0.85}
        strokeDasharray={length}
        style={
          {
            // Path length per-trail (geometry depends on cast source);
            // injected as a custom property the keyframe animates.
            ['--ribbon-length' as string]: `${length}`,
            animation: `ribbon-sweep ${sweepMs}ms ease-out forwards`,
          } as React.CSSProperties
        }
      />
    </svg>
  );
}

function approxQuadraticLength(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  // Sample 16 points and sum chord lengths. Cheap and accurate
  // within a few percent for our short arcs.
  const N = 16;
  let len = 0;
  let prevX = x0;
  let prevY = y0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const omt = 1 - t;
    const x = omt * omt * x0 + 2 * omt * t * x1 + t * t * x2;
    const y = omt * omt * y0 + 2 * omt * t * y1 + t * t * y2;
    len += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return len;
}

function strokeForColors(colors: readonly string[]): string {
  if (colors.length === 0) return 'var(--color-team-neutral)';
  if (colors.length === 1) return manaTokenForCode(colors[0]!);
  return 'var(--color-team-neutral)'; // unused — multicolor uses gradient
}

