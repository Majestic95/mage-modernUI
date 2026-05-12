import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { LIFE_FLASH_POP, LIFE_TOTAL_COLOR_MS } from '../animation/transitions';
import { slow, SLOWMO } from '../animation/debug';

/**
 * Bundle 5 polish (2026-05-12) — circular life badge for the
 * redesigned (tabletop) PlayerFrame. Renders a Hearthstone-style disc
 * overlaid on the portrait's bottom-center. When an attacker's damage
 * parcels are in flight ({@code pendingTicks > 0}) the badge LIFTS,
 * the number holds RED, and each parcel landing fires a scale +
 * brightness pulse on the digit so every life tick is visually
 * punctuated alongside the corresponding parcel impact.
 *
 * <p>Why a standalone component (vs inline in PlayerFrameRedesigned):
 * the pre-extraction inline render was a plain {@code <div>} with no
 * per-tick motion, so parcel landings ticked the displayed value
 * silently. Users perceived the life decrement as "slower than
 * parcels landing" even though the architecture was already firing
 * 1 tick per RAF completion. Adding motion in the host file was
 * unworkable (PlayerFrameRedesigned at 626 LOC, already past the 500
 * hard cap with no exception comment); extracting here keeps the
 * badge's state machine self-contained.
 *
 * <p>State sources:
 * <ul>
 *   <li>{@code displayedLife} = wireLife + pendingTicks (computed by
 *       caller from lifeDisplayStore + player.life).</li>
 *   <li>{@code pendingTicks} = count of in-flight parcels for this
 *       player (drives lift + sustained red + the {@code data-taking-
 *       damage} attribute).</li>
 *   <li>{@code perspective} = drives size (self=40px, opponent=32px)
 *       and the testid suffix preserved from the inline node.</li>
 * </ul>
 *
 * <p>Reduced-motion: lift + sustained red persist (state-conveying —
 * color isn't motion per WCAG 2.3.3 footnote); scale-pop +
 * brightness pulse are suppressed.
 */
interface Props {
  displayedLife: number;
  pendingTicks: number;
  perspective: 'self' | 'opponent';
}

const LIFT_PX = 8;
const TEXT_RED = 'rgb(248, 113, 113)';
const TEXT_WHITE = 'rgb(255, 255, 255)';
const SHADOW_REST = 'drop-shadow(0 3px 4px rgba(0,0,0,0.35))';
const SHADOW_LIFT = 'drop-shadow(0 10px 9px rgba(0,0,0,0.55))';
const LIFT_DURATION_S = 0.24;
const LIFT_EASE: readonly [number, number, number, number] = [0.2, 0, 0, 1];

export function LifeBadge({ displayedLife, pendingTicks, perspective }: Props) {
  const prevRef = useRef(displayedLife);
  const seqRef = useRef(0);
  const [tickKey, setTickKey] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (displayedLife === prevRef.current) return;
    prevRef.current = displayedLife;
    seqRef.current += 1;
    setTickKey(seqRef.current);
  }, [displayedLife]);

  const takingDamage = pendingTicks > 0;
  // Picture-catalog §2.0 — self large (40px), opponent medium (32px).
  // -bottom-{N} places the badge's center on the portrait's bottom
  // edge (badge half-height = N).
  const sizeClass =
    perspective === 'self'
      ? 'h-10 w-10 -bottom-5 text-base'
      : 'h-8 w-8 -bottom-4 text-sm';

  return (
    <motion.div
      data-testid={`life-numeral-${perspective}`}
      data-pending-ticks={pendingTicks}
      data-taking-damage={takingDamage || undefined}
      aria-hidden="true"
      animate={{
        y: takingDamage ? -LIFT_PX : 0,
        filter: takingDamage ? SHADOW_LIFT : SHADOW_REST,
      }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { duration: LIFT_DURATION_S, ease: [...LIFT_EASE] }
      }
      // Framer's style.x accepts string percentages and composes with
      // the animated style.y into a single transform. Replaces the
      // Tailwind `-translate-x-1/2` class (which would be overwritten
      // by Framer's transform output).
      style={{ x: '-50%' }}
      className={
        'absolute left-1/2 z-10 flex items-center justify-center rounded-full ' +
        'font-bold tabular-nums leading-none ring-2 ring-white bg-zinc-900 ' +
        sizeClass
      }
    >
      <motion.span
        // tickKey remounts the span on every displayedLife change so
        // the {scale, filter} initial→animate transition fires fresh
        // each parcel landing. Without the remount, Framer would
        // smoothly interpolate from the prior animate value and skip
        // the scale-pop entirely on subsequent landings.
        key={tickKey}
        initial={
          reducedMotion
            ? false
            : { scale: 1.25, filter: 'brightness(1.6)' }
        }
        animate={{ scale: 1, filter: 'brightness(1)' }}
        transition={slow(LIFE_FLASH_POP)}
        className="transition-colors"
        style={{
          color: takingDamage ? TEXT_RED : TEXT_WHITE,
          transitionDuration: `${LIFE_TOTAL_COLOR_MS * SLOWMO}ms`,
        }}
      >
        {displayedLife}
      </motion.span>
    </motion.div>
  );
}
