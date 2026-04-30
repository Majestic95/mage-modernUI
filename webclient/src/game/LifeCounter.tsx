import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slow, SLOWMO } from '../animation/debug';
import {
  LIFE_FLOATING_NUMBER,
  LIFE_FLASH_POP,
  LIFE_TOTAL_COLOR_MS,
} from '../animation/transitions';

/**
 * Slice 70-C (ADR 0011 D4) — atom for a player's numeric life total.
 *
 * Renamed from {@code LifeTotal} (slice 51) to align with
 * design-system §7.4 vocabulary. Existing display-only behavior is
 * preserved verbatim; the new {@code interactive} prop adds +/-
 * buttons used by the {@code CommanderDamageTracker} (slice 70-F)
 * for manual adjustment.
 *
 * <p>Display-only mode (default): flashes red on damage / green on
 * gain, with a floating ±N delta drifting up via
 * {@link LIFE_FLOATING_NUMBER} ({@link DELTA_FLOAT_UP} alias).
 * Stacks deltas if multiple changes land in quick succession (e.g.
 * Lightning Bolt + Shock in the same priority pass) — each gets its
 * own ±N indicator alongside the prior one.
 *
 * <p>Interactive mode: shows the value with - and + buttons. Per
 * spec §7.4 there is NO animation in interactive mode — the
 * commander-damage tracker is a manual-adjust tool, not a live game
 * feed. Caller passes {@code onAdjust(delta)} to receive ±1 events.
 */
interface Props {
  value: number;
  /** Adds +/- buttons + suppresses the flash + floating-delta. */
  interactive?: boolean;
  /** Required when {@code interactive}; receives ±1 per click. */
  onAdjust?: (delta: number) => void;
  /** Optional aria label for the value (default: "Life"). */
  label?: string;
  /**
   * Optional override for the value's data-testid. Defaults to
   * {@code "life-counter-value"}. Slice 70-D's PlayerFrame may host a
   * self-life-counter and one-or-more opponent-commander-damage
   * counters simultaneously; per-instance test IDs prevent
   * {@code getByTestId} ambiguity (critic Tech-N7).
   */
  testId?: string;
}

export function LifeCounter({
  value,
  interactive = false,
  onAdjust,
  label = 'Life',
  testId = 'life-counter-value',
}: Props) {
  const prevRef = useRef(value);
  const seqRef = useRef(0);
  const [deltas, setDeltas] = useState<Array<{ id: number; amount: number }>>(
    [],
  );
  const [flash, setFlash] = useState<'gain' | 'loss' | null>(null);

  useEffect(() => {
    // Interactive mode skips animation entirely per spec §7.4.
    // Critic Tech-C2 — also reset flash + deltas so a switch
    // display→interactive→display doesn't leave the value stuck on a
    // stale tint. The earlier implementation only updated prevRef,
    // which meant a leftover `flash` value persisted into the next
    // display render.
    if (interactive) {
      prevRef.current = value;
      setFlash(null);
      setDeltas([]);
      return;
    }
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
  }, [value, interactive]);

  if (interactive) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        data-testid="life-counter-interactive"
      >
        <button
          type="button"
          aria-label={`Decrement ${label}`}
          onClick={() => onAdjust?.(-1)}
          className={
            'h-6 w-6 inline-flex items-center justify-center rounded ' +
            'text-text-secondary hover:text-text-primary ' +
            'bg-surface-card hover:bg-surface-card-hover'
          }
        >
          −
        </button>
        <span
          data-testid={testId}
          className="font-mono text-text-primary min-w-[2ch] text-center"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increment ${label}`}
          onClick={() => onAdjust?.(1)}
          className={
            'h-6 w-6 inline-flex items-center justify-center rounded ' +
            'text-text-secondary hover:text-text-primary ' +
            'bg-surface-card hover:bg-surface-card-hover'
          }
        >
          +
        </button>
      </span>
    );
  }

  // Display-only mode: preserves the slice 51 behavior verbatim.
  // Token migration only — colors moved off literal Tailwind classes
  // so a future palette change at the token layer propagates.
  const numberClass =
    flash === 'gain'
      ? 'text-status-success'
      : flash === 'loss'
        ? 'text-status-danger'
        : 'text-text-primary';

  return (
    <span className="relative inline-flex items-baseline gap-1">
      <span className="text-text-secondary">{label}</span>{' '}
      <motion.span
        data-testid={testId}
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
              transition={slow(LIFE_FLOATING_NUMBER)}
              className={`absolute left-0 text-xs font-bold font-mono ${
                d.amount > 0 ? 'text-status-success' : 'text-status-danger'
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
