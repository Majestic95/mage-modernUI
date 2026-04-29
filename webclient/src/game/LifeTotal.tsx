import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slow, SLOWMO } from '../animation/debug';
import {
  DELTA_FLOAT_UP,
  LIFE_FLASH_POP,
  LIFE_TOTAL_COLOR_MS,
} from '../animation/transitions';

/**
 * Slice 51 â€” animated life total. The number flashes red on damage
 * and green on gain, with a floating Â±N delta that drifts up and
 * fades out. Most-watched number in any MTG game; making it visceral
 * is the highest-leverage polish per pixel.
 *
 * <p>Tracks the previous value via {@code useRef}. On change, captures
 * a {@code delta} entry with a unique sequence id and pushes it into a
 * short-lived list â€” {@code AnimatePresence} renders the float-up +
 * fade-out, then the entry is cleared after 900ms (slightly longer
 * than the animation so the exit completes cleanly).
 *
 * <p>Stacks deltas if multiple changes land in quick succession (e.g.
 * Lightning Bolt + Shock in the same priority pass) â€” each gets its
 * own +N/-N indicator drifting up alongside the prior one.
 */
export function LifeTotal({ value }: { value: number }) {
  const prevRef = useRef(value);
  const seqRef = useRef(0);
  const [deltas, setDeltas] = useState<Array<{ id: number; amount: number }>>(
    [],
  );
  const [flash, setFlash] = useState<'gain' | 'loss' | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (value === prev) return;
    const amount = value - prev;
    prevRef.current = value;
    const id = ++seqRef.current;
    setDeltas((current) => [...current, { id, amount }]);
    setFlash(amount > 0 ? 'gain' : 'loss');
    const flashTimer = setTimeout(() => setFlash(null), 500);
    const dropTimer = setTimeout(() => {
      setDeltas((current) => current.filter((d) => d.id !== id));
    }, 900);
    return () => {
      clearTimeout(flashTimer);
      clearTimeout(dropTimer);
    };
  }, [value]);

  const numberClass =
    flash === 'gain'
      ? 'text-emerald-300'
      : flash === 'loss'
        ? 'text-rose-400'
        : 'text-zinc-100';

  return (
    <span className="relative inline-flex items-baseline gap-1">
      <span className="text-zinc-500">Life</span>{' '}
      <motion.span
        data-testid="life-total"
        key={flash ?? 'idle'}
        initial={{ scale: flash ? 1.25 : 1 }}
        animate={{ scale: 1 }}
        transition={slow(LIFE_FLASH_POP)}
        className={`font-mono transition-colors ${numberClass}`}
        style={{ transitionDuration: `${LIFE_TOTAL_COLOR_MS * SLOWMO}ms` }}
      >
        {value}
      </motion.span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 top-0 h-full w-8"
      >
        <AnimatePresence>
          {deltas.map((d) => (
            <motion.span
              key={d.id}
              initial={{ opacity: 0, y: 0, scale: 0.85 }}
              animate={{ opacity: 1, y: -18, scale: 1 }}
              exit={{ opacity: 0, y: -32 }}
              transition={slow(DELTA_FLOAT_UP)}
              className={`absolute left-0 text-xs font-bold font-mono ${
                d.amount > 0 ? 'text-emerald-300' : 'text-rose-400'
              }`}
              data-testid="life-delta"
            >
              {d.amount > 0 ? `+${d.amount}` : `${d.amount}`}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
    </span>
  );
}
