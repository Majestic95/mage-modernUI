import { motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import {
  RESOLVE_FLIGHT_MS,
  RESOLVE_FLIGHT_ARC_PEAK_PX,
} from './transitions';

/**
 * Resolve-flight cinematic (2026-05-12) — when a non-token
 * permanent resolves stack → battlefield, this overlay paints a
 * copy of the card flying along a bezier arc from the stack focal
 * to its battlefield slot, scaling up at the apex and back down
 * on landing. Reads as "the spell soars in" instead of the
 * existing fast straight-line spring glide.
 *
 * <p><b>Mechanism:</b>
 * <ul>
 *   <li>Source center = stack focal (where the card resolved).</li>
 *   <li>Target center = the destination tile's FINAL layout
 *       position (not its mid-Framer-glide gBCR), so the overlay
 *       lands on the slot the card will settle into.</li>
 *   <li>Path: quadratic bezier. Control point sits at the
 *       midpoint, lifted {@link RESOLVE_FLIGHT_ARC_PEAK_PX} above
 *       the straight-line. Sampled at {@code n=24} steps via
 *       Framer's {@code animate.x} / {@code animate.y} keyframes
 *       so the motion follows the curve, not a chord.</li>
 *   <li>Scale: keyframes [1.0, 1.4, 1.0] at [0, 0.5, 1.0] so the
 *       card visibly enlarges mid-flight then settles to its slot
 *       size. Brightness keyframes [1.0, 1.4, 1.0] at the same
 *       waypoints punch the apex moment.</li>
 *   <li>Duration: {@link RESOLVE_FLIGHT_MS} (700ms).</li>
 * </ul>
 *
 * <p><b>Tile hiding:</b> the caller (CardAnimationLayer) marks
 * the destination cardId via {@code startFlightHide} in
 * animationState BEFORE React renders the new battlefield tile.
 * The tile's motion.div reads {@link useFlyingTileHide} (or the
 * bucket-level snapshot variant) during its first render and
 * clamps {@code animate.opacity} to 0, so Framer's LAYOUT_GLIDE-
 * driven copy of the same card is invisible while this overlay
 * arcs above. On {@code onComplete} the layer calls
 * {@code endFlightHide(cardId)}; the tile's animate.opacity flips
 * back to 1 and Framer fades it in (~200ms via the per-prop
 * transition override on each tile's motion.div).
 *
 * <p><b>Reduced motion:</b> the overlay does not mount — the
 * CardAnimationLayer handler short-circuits before scheduling the
 * flight. The tile arrives via the existing Framer LAYOUT_GLIDE
 * (essential motion: the card still moves from stack to slot).
 *
 * <p><b>Art source:</b> {@code imageUrl} is captured at event
 * time from the resolved tile's rendered {@code <img>} src (via
 * {@code resolveTileImageUrl}). Falls back to a neutral dark
 * block when null.
 */
interface Props {
  cardId: string;
  sourceCenter: { x: number; y: number };
  targetCenter: { x: number; y: number };
  tileWidth: number;
  tileHeight: number;
  imageUrl: string | null;
  onComplete: () => void;
}

const ARC_SAMPLE_COUNT = 24;

interface ArcPath {
  xKeyframes: number[];
  yKeyframes: number[];
  times: number[];
}

function buildArcKeyframes(
  sourceCenter: { x: number; y: number },
  targetCenter: { x: number; y: number },
): ArcPath {
  const midX = (sourceCenter.x + targetCenter.x) / 2;
  const midY = (sourceCenter.y + targetCenter.y) / 2;
  // Distance-responsive arc height — animation-critic fix 2026-05-12.
  // A flat 120px peak looks fine on short hops (~150px straight-line)
  // but reads as nearly flat on long diagonal flights (300+ px between
  // stack focal and a corner pod at 1440p). Scale peak with distance
  // so longer flights get a proportionally taller arc, clamped to the
  // base value as the floor.
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const distance = Math.hypot(dx, dy);
  const arcPeakPx = Math.max(RESOLVE_FLIGHT_ARC_PEAK_PX, distance * 0.4);
  const controlX = midX;
  const controlY = midY - arcPeakPx;
  const xKeyframes: number[] = [];
  const yKeyframes: number[] = [];
  const times: number[] = [];
  for (let i = 0; i <= ARC_SAMPLE_COUNT; i++) {
    const t = i / ARC_SAMPLE_COUNT;
    const oneMinusT = 1 - t;
    const x =
      oneMinusT * oneMinusT * sourceCenter.x +
      2 * oneMinusT * t * controlX +
      t * t * targetCenter.x;
    const y =
      oneMinusT * oneMinusT * sourceCenter.y +
      2 * oneMinusT * t * controlY +
      t * t * targetCenter.y;
    xKeyframes.push(x);
    yKeyframes.push(y);
    times.push(t);
  }
  return { xKeyframes, yKeyframes, times };
}

export function ResolveFlightOverlay({
  cardId,
  sourceCenter,
  targetCenter,
  tileWidth,
  tileHeight,
  imageUrl,
  onComplete,
}: Props): React.JSX.Element | null {
  const arc = useMemo(
    () => buildArcKeyframes(sourceCenter, targetCenter),
    [sourceCenter.x, sourceCenter.y, targetCenter.x, targetCenter.y],
  );

  useEffect(() => {
    const t = setTimeout(onComplete, RESOLVE_FLIGHT_MS + 50);
    return () => clearTimeout(t);
  }, [onComplete]);

  if (tileWidth === 0 || tileHeight === 0) return null;

  return (
    <motion.div
      data-testid="resolve-flight-overlay"
      data-card-id={cardId}
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{
        width: tileWidth,
        height: tileHeight,
        // Center the overlay on its current x/y by offsetting half
        // its size; Framer's `style.x`/`style.y` (set via animate)
        // moves the top-left corner, so we shift so the bezier
        // sample points correspond to the CENTER of the flying card.
        marginLeft: -tileWidth / 2,
        marginTop: -tileHeight / 2,
        backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
        backgroundColor: imageUrl ? undefined : 'rgba(40, 40, 45, 0.9)',
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        borderRadius: '0.5rem',
        willChange: 'transform, filter',
      }}
      initial={{
        x: sourceCenter.x,
        y: sourceCenter.y,
        scale: 1,
        filter: 'brightness(1)',
      }}
      animate={{
        x: arc.xKeyframes,
        y: arc.yKeyframes,
        scale: [1, 1.4, 1],
        filter: ['brightness(1)', 'brightness(1.4)', 'brightness(1)'],
      }}
      transition={{
        duration: RESOLVE_FLIGHT_MS / 1000,
        ease: 'easeInOut',
        times: arc.times,
        scale: {
          duration: RESOLVE_FLIGHT_MS / 1000,
          times: [0, 0.5, 1],
          ease: 'easeOut',
        },
        filter: {
          duration: RESOLVE_FLIGHT_MS / 1000,
          times: [0, 0.5, 1],
          ease: 'easeOut',
        },
      }}
    />
  );
}
