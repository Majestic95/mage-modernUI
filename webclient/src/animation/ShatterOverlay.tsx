import { useEffect, useMemo } from 'react';
import { DUST_DURATION_MS } from './transitions';

/**
 * Creature-death shatter cinematic (2026-05-12) — replaces the
 * previous dust-particle visual which was too small to read on a
 * crowded 1440p tabletop. The dying card's actual rendered art is
 * split into 8 triangular shards (each a clip-path polygon meeting
 * at card center), and each shard flies outward radially +
 * rotates + fades over {@link DUST_DURATION_MS} (1000ms).
 *
 * <p><b>Polygon partition:</b> 8 isoceles triangles whose apex is
 * the card center (50% 50%). Bases sit on the card edges at every
 * 45° clock position, so the 8 shards exactly tile the card with
 * no gaps and no overlap.
 *
 * <p><b>Radial flight:</b> each shard translates outward along its
 * own angle vector (-90° + 45°·i for i in 0..7, mapped to (dx, dy)
 * via cos/sin). Flight distance is one card-width so shards
 * visibly clear the original tile bbox before fading. Each shard
 * also gets a per-mount random rotation (±60°) so the shatter
 * doesn't look like a mechanical pinwheel.
 *
 * <p><b>Art source:</b> the caller passes in {@code imageUrl} —
 * resolved at event time from the dying tile's rendered {@code
 * <img>} src via {@link resolveTileImageUrl}. Shards use it as a
 * {@code backgroundImage} sized to the original tile's footprint,
 * so each shard's clip-path region shows the correct slice of the
 * original art.
 *
 * <p><b>Self-cleanup:</b> {@code onComplete} fires after
 * {@code DUST_DURATION_MS + 50} so CardAnimationLayer can prune
 * the activeImpacts entry.
 *
 * <p><b>Reduced motion:</b> the keyframe is silenced by the global
 * {@code @media (prefers-reduced-motion: reduce)} rule. Shards still
 * mount and paint at their initial position (translate 0, rotate 0,
 * opacity 1) — visible as the card's intact art for the brief window
 * before this component's onComplete timer + ImpactOverlay unmount
 * remove them. The dying tile's AnimatePresence exit still conveys
 * the death signal independently, so reduced-motion users get the
 * gameplay information without the shatter cinematic.
 *
 * <p><b>Fallback when imageUrl is null:</b> shards mount with a
 * neutral dark backgroundColor. Visual is less impactful but still
 * reads as "card shatters." Face-down cards (morph / manifest /
 * disguise) intentionally fall through here only if the {@code <img>}
 * is missing — face-up morph cards render shards of the card-back
 * art (visually correct, since the player should not learn the
 * hidden card's identity from its destruction).
 *
 * <p><b>z-index ladder:</b> rendered inside CardAnimationLayer at
 * {@code z-[35]}. Sits ABOVE table chrome (side panel + action dock
 * at z-30) but BELOW interactive dialogs (z-40) and HoverCardDetail
 * (z-50). Decorative-over-interactive is the project rule; shatter
 * never obscures a target-confirmation prompt.
 */
interface Props {
  cardId: string;
  bbox: { left: number; top: number; width: number; height: number };
  imageUrl: string | null;
  staggerMs?: number;
  onComplete: () => void;
}

// Tuned 2026-05-12 from 1.0 → 1.5 per the parallel-critic animation
// pass: at 1.0× a typical 100×140 tile flies shards out ~140px,
// which on a 1440p table with ~300px crowded-pod cards reads as
// "shards barely clear the original tile." 1.5× pushes shards to
// ~210px outward — past the neighbor-card buffer — so the shatter
// reads as a distinct event rather than a contained fizzle.
const SHARD_FLIGHT_FACTOR = 1.5;

const SHARD_POLYGONS: readonly string[] = [
  'polygon(50% 50%, 0% 0%, 50% 0%)',
  'polygon(50% 50%, 50% 0%, 100% 0%)',
  'polygon(50% 50%, 100% 0%, 100% 50%)',
  'polygon(50% 50%, 100% 50%, 100% 100%)',
  'polygon(50% 50%, 100% 100%, 50% 100%)',
  'polygon(50% 50%, 50% 100%, 0% 100%)',
  'polygon(50% 50%, 0% 100%, 0% 50%)',
  'polygon(50% 50%, 0% 50%, 0% 0%)',
];

const SHARD_ANGLES_DEG: readonly number[] = [
  -67.5, -22.5, 22.5, 67.5, 112.5, 157.5, 202.5, 247.5,
];

interface Shard {
  clipPath: string;
  dx: number;
  dy: number;
  rotate: number;
}

function generateShards(width: number, height: number): Shard[] {
  const radius = Math.max(width, height) * SHARD_FLIGHT_FACTOR;
  return SHARD_POLYGONS.map((clipPath, i) => {
    const rad = (SHARD_ANGLES_DEG[i]! * Math.PI) / 180;
    return {
      clipPath,
      dx: Math.round(Math.cos(rad) * radius),
      dy: Math.round(Math.sin(rad) * radius),
      rotate: Math.round((Math.random() - 0.5) * 120),
    };
  });
}

export function ShatterOverlay({
  cardId,
  bbox,
  imageUrl,
  staggerMs = 0,
  onComplete,
}: Props): React.JSX.Element | null {
  const shards = useMemo(
    () => generateShards(bbox.width, bbox.height),
    [bbox.width, bbox.height, cardId],
  );

  useEffect(() => {
    const t = setTimeout(onComplete, DUST_DURATION_MS + staggerMs + 50);
    return () => clearTimeout(t);
  }, [onComplete, staggerMs]);

  if (bbox.width === 0 || bbox.height === 0) return null;

  return (
    <div
      data-testid="tile-shatter-overlay"
      data-card-id={cardId}
      data-essential-motion="true"
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{
        left: bbox.left,
        top: bbox.top,
        width: bbox.width,
        height: bbox.height,
      }}
    >
      {shards.map((shard, i) => (
        <div
          key={i}
          className="absolute inset-0"
          style={
            {
              clipPath: shard.clipPath,
              WebkitClipPath: shard.clipPath,
              backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
              backgroundColor: imageUrl ? undefined : 'rgba(40, 40, 45, 0.9)',
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
              borderRadius: '0.5rem',
              // Explicit transform-origin so each shard pivots around
              // the card center (= shard div's center, since the
              // div fills the card via inset:0). Matches the default
              // but pinning it kills future fragility if the shard
              // div ever gets clipped to its visible polygon.
              transformOrigin: '50% 50%',
              // Hint the compositor to promote each shard to its own
              // GPU layer — 8 shards × 60fps × 1000ms repaint can
              // jank on lower-end devices without this.
              willChange: 'transform, opacity',
              // Front-loaded ease-out — shards JUMP outward in the
              // first ~200ms then decelerate. Reads as "explosive
              // energy release," not a glide. Per animation-critic
              // pass 2026-05-12.
              animation: `card-shatter ${DUST_DURATION_MS}ms cubic-bezier(0.1, 0.7, 0.2, 1) forwards`,
              animationDelay: `${staggerMs}ms`,
              ['--shard-dx' as string]: `${shard.dx}px`,
              ['--shard-dy' as string]: `${shard.dy}px`,
              ['--shard-rotate' as string]: `${shard.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
