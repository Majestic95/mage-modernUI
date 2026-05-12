import { useEffect } from 'react';
import { ImpactParticles } from './ImpactParticles';
import { ShatterOverlay } from './ShatterOverlay';
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
  imageUrl = null,
  staggerMs = 0,
  onComplete,
}: {
  cardId: string;
  kind: 'dust' | 'exile';
  bbox: { left: number; top: number; width: number; height: number };
  /**
   * Card-art image URL captured at event time (only used by the
   * 'dust' kind, which delegates to ShatterOverlay so the shards
   * paint the actual card art). Null for 'exile' or when the
   * dying tile's `<img>` could not be resolved — ShatterOverlay
   * falls back to a neutral dark fill in that case.
   */
  imageUrl?: string | null;
  /**
   * Animation-delay in ms for the board-wipe wave. Per-permanent
   * ImpactOverlays in a wipe stagger by BOARD_WIPE_STAGGER_MS *
   * index so the wave reads outward from the epicenter rather than
   * firing all at once. Slice 70-Z.4 critic IMPORTANT-1 fix.
   */
  staggerMs?: number;
  onComplete: () => void;
}): React.JSX.Element {
  // Unconditional useEffect (rules-of-hooks). When kind='dust' we
  // delegate to ShatterOverlay which owns its own completion timer,
  // so the effect short-circuits. When kind='exile' the effect
  // drives the dissolve+particle completion.
  const durationMs =
    kind === 'dust' ? DUST_DURATION_MS : EXILE_DURATION_MS;

  useEffect(() => {
    if (kind === 'dust') return;
    const t = setTimeout(onComplete, durationMs + staggerMs + 50);
    return () => clearTimeout(t);
  }, [kind, onComplete, durationMs, staggerMs]);

  // Creature-death path delegates to ShatterOverlay (2026-05-12) —
  // the dust-particle visual was too small to read on a crowded
  // 1440p tabletop; shatter splits the card's actual art into 8
  // polygonal shards flying outward. Exile path retains the
  // bright-dissolve keyframe + radial particle field (still reads
  // well because exile is rarer + the magical-removal palette pops
  // against any background).
  if (kind === 'dust') {
    return (
      <ShatterOverlay
        cardId={cardId}
        bbox={bbox}
        imageUrl={imageUrl}
        staggerMs={staggerMs}
        onComplete={onComplete}
      />
    );
  }

  return (
    <div
      data-testid="tile-exile-overlay"
      data-card-id={cardId}
      data-essential-motion="true"
      aria-hidden="true"
      className="pointer-events-none fixed"
      style={{
        left: bbox.left,
        top: bbox.top,
        width: bbox.width,
        height: bbox.height,
        animation: `card-bright-dissolve ${durationMs}ms ease-out forwards`,
        animationDelay: `${staggerMs}ms`,
        // Bright white-violet — distinct from death's earthy/shatter
        // palette. Reads as "magical removal" vs "physical destruction."
        backgroundColor: 'rgba(216, 180, 254, 0.85)',
        borderRadius: '0.5rem',
      }}
    >
      <ImpactParticles
        kind="exile"
        cardId={cardId}
        staggerMs={staggerMs}
      />
    </div>
  );
}

