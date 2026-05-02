import { useEffect, useMemo } from 'react';
import { GROUND_CRACK_DURATION_MS } from './transitions';

/**
 * Slice 70-Z.4 follow-up — "ground cracks beneath them" on creature
 * ETB. When a creature resolves stack → battlefield and the
 * LAYOUT_GLIDE spring settles, this overlay mounts at the new
 * tile's bbox and animates 6-8 radial crack lines drawing outward
 * from center plus a brown earth-dust puff.
 *
 * <p><b>Trigger:</b> {@link CardAnimationLayer} subscribes to
 * {@code resolve_to_board} and, for events whose card is a CREATURE,
 * waits {@code GROUND_CRACK_LANDING_DELAY_MS} (~400ms) before
 * resolving the new tile's bbox via {@code [data-card-id]} and
 * mounting this overlay. The delay aligns the crack with the
 * perceived "landing" moment — Framer's spring has settled and the
 * tile sits at rest in its slot.
 *
 * <p><b>Visual</b> (round 2 user direction):
 * <ul>
 *   <li>6 crack lines start ON THE TILE EDGES (not the center) and
 *       spider OUTWARD into the surrounding ground — the impact
 *       point is the perimeter, like the creature stomped down and
 *       split the floor at its boundary.</li>
 *   <li>Stroke is gold+white {@code rgba(255, 230, 150, 0.95)}
 *       matching the focal-card spotlight palette, with a soft
 *       drop-shadow glow so the cracks read as molten/energy
 *       rather than dirt.</li>
 *   <li>Lines draw via {@code stroke-dashoffset} 0-30% of duration;
 *       opacity fades 40-100%. Each line staggers 35ms after the
 *       previous so the cracks propagate around the tile perimeter
 *       rather than firing at once.</li>
 *   <li>Padding extended 50% beyond the tile in every direction so
 *       cracks have room to reach into the surrounding ground.</li>
 * </ul>
 *
 * <p><b>Reduced motion:</b> {@link CardAnimationLayer} skips
 * mounting under {@code prefers-reduced-motion}; the global media
 * query also silences the {@code ground-crack-draw} keyframe as
 * defense in depth.
 */
export function GroundCrackOverlay({
  cardId,
  bbox,
  onComplete,
}: {
  cardId: string;
  bbox: { left: number; top: number; width: number; height: number };
  onComplete: () => void;
}): React.JSX.Element {
  // Generate the crack geometry once per overlay mount. cardId in
  // the dep keeps the seed stable for that landing — re-mounts of
  // the same cardId (rare) reuse the layout.
  const cracks = useMemo(() => generateCracks(cardId), [cardId]);

  useEffect(() => {
    const t = setTimeout(onComplete, GROUND_CRACK_DURATION_MS + 50);
    return () => clearTimeout(t);
  }, [onComplete]);

  // Cracks render in viewBox 0..100, scaled by the tile bbox. PAD
  // controls how far the SVG extends beyond the tile in each
  // direction. Round 4 (user direction): 35% smaller from the
  // round-3 0.4 → 0.26.
  const PAD = 0.26;
  const padX = bbox.width * PAD;
  const padY = bbox.height * PAD;

  // Round 5 user direction — clip-path excises the source card's
  // bounds from the rendered output. Anything painted at or inside
  // the perimeter (stroke half-width that extends inward past the
  // start point + drop-shadow blur radius leaking back over the
  // card) gets clipped. Result: cracks visible ONLY in the
  // surrounding ground; nothing renders BEHIND the source card.
  //
  // Using `path(evenodd, ...)` with two rectangles: a HUGE outer
  // rect (covering the SVG and any drop-shadow extents past it)
  // plus an inner rect at the card's bbox. Even-odd fill rule
  // includes the outer + excludes the inner. The outer rect's
  // size doesn't matter as long as it's bigger than the visible
  // output; 9999 covers everything safely.
  const wrapperW = bbox.width * (1 + PAD * 2);
  const wrapperH = bbox.height * (1 + PAD * 2);
  const cardLeft = padX;
  const cardTop = padY;
  const cardRight = cardLeft + bbox.width;
  const cardBottom = cardTop + bbox.height;
  const HUGE = 9999;
  const clipPathValue = `path(evenodd, "M ${-HUGE} ${-HUGE} L ${HUGE} ${-HUGE} L ${HUGE} ${HUGE} L ${-HUGE} ${HUGE} Z M ${cardLeft} ${cardTop} L ${cardRight} ${cardTop} L ${cardRight} ${cardBottom} L ${cardLeft} ${cardBottom} Z")`;

  return (
    <div
      data-testid="ground-crack-overlay"
      data-card-id={cardId}
      data-essential-motion="true"
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{
        left: bbox.left - padX,
        top: bbox.top - padY,
        width: wrapperW,
        height: wrapperH,
        clipPath: clipPathValue,
      }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ overflow: 'visible' }}
      >
        {cracks.map((c, i) => (
          <path
            key={i}
            d={c.d}
            // Round 3 user direction — pure white-gold core stroke
            // (max brightness, fully opaque) with THREE layered
            // drop-shadows for a thick warm glow: tight inner gold
            // halo, mid blur, wide soft white-gold outer glow.
            // Together they read as molten energy, not flat lines.
            stroke="rgba(255, 245, 200, 1.0)"
            strokeWidth={c.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            // pathLength normalizes all paths so the keyframe can
            // animate stroke-dashoffset 0..100 unit-less.
            pathLength={100}
            style={{
              strokeDasharray: 100,
              strokeDashoffset: 100,
              filter:
                'drop-shadow(0 0 4px rgba(255, 215, 100, 1)) ' +
                'drop-shadow(0 0 12px rgba(255, 215, 100, 0.85)) ' +
                'drop-shadow(0 0 24px rgba(255, 240, 180, 0.6))',
              animation: `ground-crack-draw ${GROUND_CRACK_DURATION_MS}ms ease-out forwards`,
              animationDelay: `${i * 35}ms`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}

interface Crack {
  d: string;
  width: number;
}

/**
 * Generate 6 jagged crack lines starting at the tile's perimeter
 * and spidering outward into the surrounding ground (round 2 user
 * direction: edge-anchored, not center-anchored). Deterministic per
 * cardId so re-renders during the same landing don't reshuffle.
 *
 * <p><b>Geometry:</b> the SVG viewBox is 0..100. With PAD=0.5 the
 * tile occupies the inner 50% of the viewBox in both axes — its
 * perimeter is the rectangle [25, 25] - [75, 75]. For each crack:
 * <ol>
 *   <li>Pick an angle uniformly around the tile.</li>
 *   <li>Cast a ray from tile center (50, 50) outward at that angle;
 *       the start point is where the ray hits the tile's perimeter
 *       rectangle.</li>
 *   <li>Extend the crack outward from that edge point along the
 *       same angle for ~50-75 viewBox units (1.5× the previous
 *       35-55), with per-segment perpendicular jitter so the line
 *       zigzags.</li>
 * </ol>
 */
function generateCracks(cardId: string): Crack[] {
  const rng = mulberry32(hashString(cardId));
  const out: Crack[] = [];
  const N = 6;
  // Tile perimeter in viewBox: tile occupies 1/(1+2*PAD) of the
  // viewBox along each axis. Round 4: PAD=0.26 → tile = 65.8% of
  // viewBox → halfTile = 32.9 viewBox units from center.
  const halfTile = 100 / (2 * (1 + 2 * 0.26));
  for (let i = 0; i < N; i++) {
    const baseAngle = (i / N) * Math.PI * 2;
    const angle = baseAngle + (rng() - 0.5) * 0.5;
    const tx = Math.cos(angle);
    const ty = Math.sin(angle);
    // Find where ray (tx, ty) from center exits the perimeter.
    const tToX = halfTile / Math.max(Math.abs(tx), 0.001);
    const tToY = halfTile / Math.max(Math.abs(ty), 0.001);
    const tEdge = Math.min(tToX, tToY);
    const startX = 50 + tx * tEdge;
    const startY = 50 + ty * tEdge;
    // Round 4: 35% smaller from round-3's 35-50 → 23-32 viewBox
    // units. Combined with PAD=0.26, cracks reach roughly 0.4-0.55
    // tile-widths past the perimeter — much more contained.
    const totalLen = 23 + rng() * 9;
    const segCount = 3;
    const segLen = totalLen / segCount;
    let path = `M ${startX.toFixed(1)} ${startY.toFixed(1)}`;
    for (let s = 0; s < segCount; s++) {
      const r = (s + 1) * segLen;
      const jitter = (rng() - 0.5) * (s + 1) * 4;
      const perpX = -ty;
      const perpY = tx;
      const nx = startX + tx * r + perpX * jitter;
      const ny = startY + ty * r + perpY * jitter;
      path += ` L ${nx.toFixed(1)} ${ny.toFixed(1)}`;
    }
    out.push({
      d: path,
      // Bumped 1.2-1.8 → 1.6-2.4 viewBox units so the gold core is
      // thick enough for the layered drop-shadow glow to read.
      width: 1.6 + rng() * 0.8,
    });
  }
  return out;
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
