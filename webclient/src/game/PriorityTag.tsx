/**
 * Slice 70-C (ADR 0011 D4) — atom for the floating "PRIORITY" pill
 * that appears near the player frame of whoever currently holds
 * priority.
 *
 * Per design-system §7.13: small pill, `--color-accent-primary`
 * background, "PRIORITY" text, fades in/out per
 * {@link PRIORITY_TAG_FADE} (slice 70-B motion preset).
 *
 * <p>Consumer responsibility: wrap in {@code <AnimatePresence>} so
 * the exit animation runs when the tag unmounts. The atom owns the
 * fade transition; the parent owns the conditional render.
 *
 * <p>Design-system §6.3 / slice 70-B contract: this is a
 * NON-essential animation. Reduced-motion silences the fade by
 * default — the tag still mounts/unmounts, just without the fade.
 * Consumers do NOT mark the tag with `data-essential-motion`.
 */
import { motion } from 'framer-motion';
import { PRIORITY_TAG_FADE } from '../animation/transitions';
import { slow } from '../animation/debug';

export function PriorityTag() {
  return (
    <motion.span
      data-testid="priority-tag"
      // Critic UX-C2 — no role="status" / aria-live here. During
      // stack resolution priority can cycle 8-12 times in seconds; an
      // SR announcement per mount/unmount produces useless spam. The
      // parent PlayerArea's aria-label already includes "has priority"
      // when the player holds it (see PlayerArea.tsx ariaLabel
      // synthesis), so SR users get the signal once at the seat
      // level. Sighted users still see the visual fade.
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={slow(PRIORITY_TAG_FADE)}
      className={
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ' +
        'bg-accent-primary text-text-on-accent tracking-wide'
      }
    >
      PRIORITY
    </motion.span>
  );
}
