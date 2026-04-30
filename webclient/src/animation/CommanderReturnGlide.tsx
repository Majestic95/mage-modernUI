import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { CardFace } from '../game/CardFace';
import { COMMANDER_RETURN_MS } from './transitions';
import type { WebCardView } from '../api/schemas';

/**
 * Slice 70-Z.3 — commander-return-to-command-zone glide. When the
 * snapshot diff emits {@code commander_returned} (a commander left
 * the battlefield WITHOUT entering graveyard or exile), a single
 * card-sized {@code motion.div} mounts at the player's portrait
 * position with {@code layoutId={cardId}}. Framer interpolates
 * from the cardId's last tracked bbox (the battlefield tile) to
 * this overlay's portrait-centered position via the existing
 * LAYOUT_GLIDE spring, with an explicit 600ms duration override
 * so the trip is "slow enough to appreciate" per user direction.
 *
 * <p>Both the card payload and the destination bbox are passed in
 * as props from {@code CardAnimationLayer}, which resolves them at
 * event-handler time — keeping this component pure (no
 * useEffect-driven setState pattern).
 *
 * <p>After {@link COMMANDER_RETURN_MS} (600ms), the overlay calls
 * {@code onComplete} so the parent can drop it from its render
 * tree. The card is gone from the layoutId graph; the existing
 * {@code animate-player-active-halo} on the portrait acts as
 * arrival confirmation if the player is the active player.
 *
 * <p><b>Reduced motion:</b> {@link CardAnimationLayer} skips this
 * mount entirely under {@code prefers-reduced-motion} — the
 * commander_returned event still fires for state correctness, but
 * no visual glide plays.
 */
export function CommanderReturnGlide({
  cardId,
  card,
  targetCenter,
  onComplete,
}: {
  cardId: string;
  /**
   * The card payload to render mid-flight. Provided by the parent;
   * can be a stub (name + types) since the destination glide is
   * brief and image fidelity isn't critical.
   */
  card: WebCardView;
  /**
   * Destination position in viewport coordinates (the portrait
   * center). Computed by the parent at event-handler time.
   */
  targetCenter: { x: number; y: number };
  onComplete: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onComplete, COMMANDER_RETURN_MS);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <motion.div
      data-testid="commander-return-glide"
      data-card-id={cardId}
      layoutId={cardId}
      // Tween override — slower than LAYOUT_GLIDE's spring would
      // settle by default. Tween easing reads as "deliberate flight"
      // vs the spring's "alive bounce."
      transition={{
        layout: {
          duration: COMMANDER_RETURN_MS / 1000,
          ease: [0.25, 0.1, 0.25, 1],
        },
      }}
      style={{
        position: 'fixed',
        left: targetCenter.x,
        top: targetCenter.y,
        transform: 'translate(-50%, -50%)',
      }}
      aria-hidden="true"
      className="pointer-events-none"
    >
      {/* Slice 70-Z.3 critic CRIT-2 fix — `size="battlefield"` is a
          fluid variant that fills its parent slot; outside a sized
          slot it collapses to 0×0 (height: 100% against an unsized
          parent resolves to 0). `size="focal"` has fixed dimensions
          (var(--card-size-focal)) so the card actually renders
          during the 600ms glide. */}
      <CardFace card={card} size="focal" />
    </motion.div>
  );
}

