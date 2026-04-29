import { AnimatePresence, motion } from 'framer-motion';
import { slow } from '../animation/debug';
import { MANA_POOL_FADE, MANA_POOL_POP } from '../animation/transitions';
import type { WebPlayerView } from '../api/schemas';

export function ManaPool({ player }: { player: WebPlayerView }) {
  const pool = player.manaPool;
  const cells: Array<[string, number, string]> = [
    ['W', pool.white, 'text-amber-100'],
    ['U', pool.blue, 'text-sky-300'],
    ['B', pool.black, 'text-zinc-300'],
    ['R', pool.red, 'text-red-400'],
    ['G', pool.green, 'text-emerald-400'],
    ['C', pool.colorless, 'text-zinc-400'],
  ];
  // Slice 58 â€” wrap symbols in AnimatePresence so each color pops in
  // (scale 0 â†’ 1) when first added and fades out when consumed. The
  // wrapper renders unconditionally even when total === 0 so
  // AnimatePresence has a stable parent to flush exits from.
  return (
    <span className="flex gap-1 font-mono text-xs">
      <AnimatePresence mode="popLayout" initial={false}>
        {cells
          .filter(([, n]) => n > 0)
          .map(([sym, n, cls]) => (
            <motion.span
              key={sym}
              className={cls}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0, transition: slow(MANA_POOL_FADE) }}
              transition={slow(MANA_POOL_POP)}
            >
              {n}
              {sym}
            </motion.span>
          ))}
      </AnimatePresence>
    </span>
  );
}
