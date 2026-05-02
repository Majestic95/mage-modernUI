import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { CardFace } from '../game/CardFace';
import { CINEMATIC_HOLD_MS } from './transitions';
import { endCinematicCast } from './animationState';
import type { WebCardView } from '../api/schemas';

/**
 * Slice 70-Z.3 — MTGA-style casting-pose overlay. When a cinematic
 * cast fires (commander, planeswalker, or manaValue ≥ 7), this
 * overlay mounts at viewport center at 1.5× scale with
 * {@code layoutId={card.cardId}}. Framer Motion interpolates the
 * card from its prior layoutId-tracked position (the hand bbox or
 * the opponent-portrait region) to centerscreen via the existing
 * LAYOUT_GLIDE spring, then the overlay holds for CINEMATIC_HOLD_MS
 * (250ms) and unmounts. The StackZone focal-tile mounts AFTER the
 * unmount (gated by {@link useIsCinematicCastActive}) so Framer
 * picks up the layoutId trail again and glides centerscreen → stack
 * focal.
 *
 * <p><b>Why no layout glide on the OVERLAY:</b> the overlay is a
 * fixed-position {@code motion.div} at viewport center; layoutId
 * does the cross-component matching, but the overlay's own
 * {@code style.left/top} is constant. Framer animates the offset
 * from the prior bbox to the overlay's resolved position
 * (centerscreen) using LAYOUT_GLIDE, then once arrived, the
 * overlay sits still until unmount.
 *
 * <p><b>Hold timing:</b> the overlay schedules its own dismount
 * via {@code setTimeout(CINEMATIC_HOLD_MS)}. Framer's LAYOUT_GLIDE
 * spring takes ~300-400ms to settle independently; the perceived
 * "pose hold" is the brief window where the card visibly stops at
 * centerscreen before unmounting. Total visible duration is the
 * spring travel + 250ms hold ≈ 600ms.
 *
 * <p><b>Reduced motion:</b> {@link CardAnimationLayer} checks
 * {@code prefers-reduced-motion} at the cast-event-handler level
 * and SKIPS mounting this overlay entirely; the layoutId graph
 * still glides hand → stack via {@code LAYOUT_GLIDE} (essential
 * motion). Inside this component, no additional reduced-motion
 * gates are needed.
 */
export function CastingPoseOverlay({
  card,
  targetCenter,
}: {
  card: WebCardView;
  /**
   * Centerpoint of the central focal zone in viewport coordinates.
   * Slice 70-Z.3 critic IMP-5 fix: positioning the overlay at
   * viewport center mis-aligns it with the StackZone focal tile
   * (which sits in the grid's central column, offset by side-panel
   * width). Anchoring to the focal zone bbox keeps the cinematic
   * pose lined up with where the focal tile will resolve. When
   * null, falls back to viewport center via CSS.
   */
  targetCenter: { x: number; y: number } | null;
}): React.JSX.Element | null {
  useEffect(() => {
    // CINEMATIC_HOLD_MS counts from the moment the overlay reaches
    // centerscreen, but timing the hold from mount-time produces
    // an indistinguishable perceptual result and is far simpler
    // than waiting for the layout-glide settle event. The Framer
    // spring takes ~300-400ms; the 250ms hold then covers the
    // visible "pause" window.
    const t = setTimeout(() => endCinematicCast(card.cardId), CINEMATIC_HOLD_MS);
    return () => {
      clearTimeout(t);
      // If the overlay unmounts early (e.g. game ended mid-cast),
      // still clear the cinematic state so StackZone doesn't sit
      // on a perma-skipped focal tile.
      endCinematicCast(card.cardId);
    };
  }, [card.cardId]);

  if (!card.cardId) return null;

  return (
    <motion.div
      data-testid="casting-pose-overlay"
      data-card-id={card.cardId}
      data-essential-motion="true"
      layoutId={card.cardId}
      // 1.5× scale per user direction — the focal "casting pose"
      // reads larger than its eventual stack-focal resting size so
      // the cinematic moment dominates the screen briefly.
      initial={{ scale: 1.5 }}
      animate={{ scale: 1.5 }}
      // Slice 70-Z.3 critic NTH-7 — `exit` prop removed: the layer
      // mounts overlays directly without `<AnimatePresence>`, so
      // the exit transition would never fire. Removed to avoid
      // dead code that misleads future maintainers.
      // Pointer-events-none so the underlying StackZone or focal
      // tile receives any clicks even though the overlay paints
      // over them visually for the brief hold window. Position via
      // fixed coords (viewport-anchored) when targetCenter is
      // provided; falls back to viewport-center CSS when not.
      className={
        targetCenter
          ? 'pointer-events-none fixed -translate-x-1/2 -translate-y-1/2'
          : 'pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
      }
      style={
        targetCenter
          ? { left: targetCenter.x, top: targetCenter.y }
          : undefined
      }
      aria-hidden="true"
    >
      <CardFace card={card} size="focal" />
    </motion.div>
  );
}
