import { AnimatePresence, motion } from 'framer-motion';
import { slow } from '../animation/debug';
import { MANA_POOL_FADE, MANA_POOL_POP } from '../animation/transitions';
import type { WebPlayerView } from '../api/schemas';

export function ManaPool({ player }: { player: WebPlayerView }) {
  const pool = player.manaPool;
  // Slice 70-A (ADR 0011 D4) — migrate from literal Tailwind color
  // classes to the design-system mana tokens. Tailwind v4's @theme
  // block in index.css generates `text-mana-*` utilities from the
  // --color-mana-* tokens, so the existing className-based ergonomic
  // is preserved. See docs/design/design-system.md §1.5 for hue
  // rationale (e.g., black → lavender so it reads on dark BG).
  const cells: Array<[string, number, string]> = [
    ['W', pool.white, 'text-mana-white'],
    ['U', pool.blue, 'text-mana-blue'],
    ['B', pool.black, 'text-mana-black'],
    ['R', pool.red, 'text-mana-red'],
    ['G', pool.green, 'text-mana-green'],
    ['C', pool.colorless, 'text-mana-colorless'],
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
