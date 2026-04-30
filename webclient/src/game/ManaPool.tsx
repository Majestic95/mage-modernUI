import { AnimatePresence, motion } from 'framer-motion';
import { slow } from '../animation/debug';
import { MANA_POOL_FADE, MANA_POOL_POP } from '../animation/transitions';
import type { WebPlayerView } from '../api/schemas';
import { ManaOrb, type ManaOrbColor } from './ManaOrb';

/**
 * Player's mana pool — one {@link ManaOrb} per non-zero color, with
 * pop-in / fade-out animation as colors enter and leave the pool.
 *
 * <p>Slice 70-C (ADR 0011 D4) — refactored to consume the new
 * {@link ManaOrb} atom. Per-color rendering moved into the orb;
 * the pool's job is just the AnimatePresence wrapper that animates
 * orbs in/out as the player's mana pool changes.
 */
export function ManaPool({ player }: { player: WebPlayerView }) {
  const pool = player.manaPool;
  const cells: Array<[ManaOrbColor, number]> = [
    ['W', pool.white],
    ['U', pool.blue],
    ['B', pool.black],
    ['R', pool.red],
    ['G', pool.green],
    ['C', pool.colorless],
  ];
  return (
    <span className="flex gap-1 items-center">
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
              {/*
                Slice 70-C critic UI-#3 — pool uses medium (24px) not
                small (16px). The 10px count text inside small was
                cramped at typical pool counts (5+) and read as a smudge
                rather than a digit. Medium gives the count a 12px
                font that scans cleanly. The cost-rendering call sites
                (ManaCost) keep their size choices.
              */}
              <ManaOrb color={color} count={n} size="medium" />
            </motion.span>
          ))}
      </AnimatePresence>
    </span>
  );
}
