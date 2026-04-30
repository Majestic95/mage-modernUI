import { useEffect } from 'react';
import { ImpactParticles } from './ImpactParticles';
import { DUST_DURATION_MS, EXILE_DURATION_MS } from './transitions';

/**
 * Slice 70-Z.4 (revised after critic CRIT-1) — fixed-position
 * impact-tier overlay rendered by {@link CardAnimationLayer} at the
 * dying tile's last-known bbox. Mounts the dust-crumple or
 * bright-dissolve keyframe + per-tile particle field; auto-unmounts
 * after the keyframe completes.
 *
 * <p><b>Why an overlay (not in BattlefieldRowGroup):</b> the
 * AnimatePresence in BattlefieldRowGroup snapshots a child's exit
 * props at the LAST render where the child was present. By the time
 * the snapshot diff fires {@code creature_died}, the dying card has
 * already been removed from {@code permanents} — its motion.div's
 * exit props were captured BEFORE the event fired (with no impact
 * branch). Rendering the impact at the layer level (with the bbox
 * captured at event-handler time, when the tile is still in the DOM)
 * sidesteps the AnimatePresence freezing problem entirely.
 *
 * <p><b>Tile bbox capture:</b> CardAnimationLayer queries the
 * battlefield for {@code [data-card-id="..."]} (set by
 * BattlefieldRowGroup's motion.div, slice 70-Z.4) at event time
 * and reads the bounding rect. The dying tile is still present in
 * the DOM at that instant — React's re-render hasn't yet pruned
 * it (Zustand's subscribe fires synchronously inside set(), before
 * React schedules a re-render).
 */
export function ImpactOverlay({
  cardId,
  kind,
  bbox,
  staggerMs = 0,
  onComplete,
}: {
  cardId: string;
  kind: 'dust' | 'exile';
  bbox: { left: number; top: number; width: number; height: number };
  /**
   * Animation-delay in ms for the board-wipe wave. Per-permanent
   * ImpactOverlays in a wipe stagger by BOARD_WIPE_STAGGER_MS *
   * index so the wave reads outward from the epicenter rather than
   * firing all at once. Slice 70-Z.4 critic IMPORTANT-1 fix.
   */
  staggerMs?: number;
  onComplete: () => void;
}): React.JSX.Element {
  const durationMs =
    kind === 'dust' ? DUST_DURATION_MS : EXILE_DURATION_MS;

  useEffect(() => {
    const t = setTimeout(onComplete, durationMs + staggerMs + 50);
    return () => clearTimeout(t);
  }, [onComplete, durationMs, staggerMs]);

  const keyframeName =
    kind === 'dust' ? 'card-dust-crumple' : 'card-bright-dissolve';

  return (
    <div
      data-testid={kind === 'dust' ? 'tile-dust-overlay' : 'tile-exile-overlay'}
      data-card-id={cardId}
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{
        left: bbox.left,
        top: bbox.top,
        width: bbox.width,
        height: bbox.height,
        animation: `${keyframeName} ${durationMs}ms ease-out forwards`,
        animationDelay: `${staggerMs}ms`,
        // Tinted background so the overlay actually shows even when
        // the underlying tile has already faded. Solid block of the
        // tile-art color isn't available client-side, so use a
        // neutral dark tile shape that the keyframe transforms.
        backgroundColor:
          kind === 'dust'
            ? 'rgba(82, 82, 91, 0.85)'
            : 'rgba(216, 180, 254, 0.85)',
        borderRadius: '0.5rem',
      }}
    >
      <ImpactParticles
        kind={kind}
        cardId={cardId}
        staggerMs={staggerMs}
      />
    </div>
  );
}

