import { AnimatePresence, motion } from 'framer-motion';
import { slow } from '../animation/debug';
import { MANA_POOL_FADE, MANA_POOL_POP } from '../animation/transitions';
import type { WebPlayerView } from '../api/schemas';
import { ManaOrb, type ManaOrbColor, type ManaOrbSize } from './ManaOrb';

/**
 * Player's mana pool — one {@link ManaOrb} per non-zero color, with
 * pop-in / fade-out animation as colors enter and leave the pool.
 *
 * <p>Slice 70-C (ADR 0011 D4) — refactored to consume the new
 * {@link ManaOrb} atom. Per-color rendering moved into the orb;
 * the pool's job is just the AnimatePresence wrapper that animates
 * orbs in/out as the player's mana pool changes.
 *
 * <p>Slice 70-P (picture-catalog §2.3) — accepts {@code size} +
 * {@code glow} props so the local floating placement (top-right of
 * hand region) can render glowing medium orbs while the opponent
 * inline cluster renders smaller non-glowing orbs ("Visible but
 * smaller" per §2.3). Defaults preserve the existing slice-70-C
 * behavior for the legacy in-strip mount.
 */
export function ManaPool({
  player,
  size = 'medium',
  glow = false,
  layout = 'horizontal',
  onSpend,
}: {
  player: WebPlayerView;
  /**
   * Slice 70-P — orb size variant. Defaults to {@code 'medium'}
   * which preserves the slice-70-C contract. Opponent floating
   * clusters pass {@code 'small'} per catalog §2.3 "smaller".
   */
  size?: ManaOrbSize;
  /**
   * Slice 70-P — when true, each orb renders the color-tinted
   * box-shadow halo (catalog §2.3 "Glow halo on each orb"). The
   * local floating mount in the hand region passes this; opponent
   * inline mounts leave it false to keep the cluster low-key.
   */
  glow?: boolean;
  /**
   * 2026-05-03 (user direction) — orientation of the orb cluster.
   * {@code 'horizontal'} (default) keeps slice-70-C's row layout
   * for opponent + legacy mounts. {@code 'vertical'} stacks orbs
   * one-per-row for the local floating cluster beside the portrait,
   * where vertical real estate is plentiful but horizontal is not
   * (orbs share the gap between the portrait and the side panel).
   */
  layout?: 'horizontal' | 'vertical';
  /**
   * Slice 70-X.10 (user feedback 2026-04-30) — when provided, each
   * orb renders as a clickable button that invokes this callback
   * with the clicked color. Used during gamePlayMana / gamePlayXMana
   * to spend floating mana directly from the pool. When undefined
   * (default), orbs are non-interactive display elements.
   */
  onSpend?: (color: ManaOrbColor) => void;
}) {
  const pool = player.manaPool;
  const cells: Array<[ManaOrbColor, number]> = [
    ['W', pool.white],
    ['U', pool.blue],
    ['B', pool.black],
    ['R', pool.red],
    ['G', pool.green],
    ['C', pool.colorless],
  ];
  const wrapperClass =
    layout === 'vertical'
      ? 'flex flex-col gap-1 items-center'
      : 'flex gap-1 items-center';
  return (
    <span className={wrapperClass}>
      <AnimatePresence mode="popLayout" initial={false}>
        {cells
          .filter(([, n]) => n > 0)
          .map(([color, n]) => (
            <motion.span
              key={color}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0, transition: slow(MANA_POOL_FADE) }}
              transition={slow(MANA_POOL_POP)}
            >
              <ManaOrb
                color={color}
                count={n}
                size={size}
                glow={glow}
                onClick={onSpend ? () => onSpend(color) : undefined}
              />
            </motion.span>
          ))}
      </AnimatePresence>
    </span>
  );
}
