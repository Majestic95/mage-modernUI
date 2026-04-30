import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { motion } from 'framer-motion';
import type { WebCardView, WebPermanentView } from '../api/schemas';
import { ManaCost } from './ManaCost';
import { scryfallImageUrl, type ScryfallVersion } from './scryfall';
import { slow } from '../animation/debug';
import {
  COUNTER_POP,
  DAMAGE_FLASH,
  MANA_TAP_ROTATE,
} from '../animation/transitions';

/**
 * Slice 52e — shared card-face renderer used by hand, stack, and
 * battlefield zones. Sizes share the same skeleton (Scryfall art
 * with image-fail fallback, mana cost overlay top-right, name
 * banner bottom, P/T or loyalty bottom-right) but differ on
 * dimensions, type-scale, and which extras render.
 *
 * <p>Battlefield is the most feature-rich: counter chip top-left,
 * damage chip lower-left, combat ATK/BLK badge replacing the
 * counter chip during declare-attackers/blockers, summoning-sickness
 * dashed border, tap rotation. Stack is the simplest — no P/T, no
 * extras. Hand sits in the middle.
 *
 * <p>The wrapper around the face (button, hover ring, hover card
 * detail dialog) stays at the call site — CardFace owns the visual
 * face only, not the click target.
 *
 * <p>Slice 70-I (redesign push) — width + height read from the
 * {@code --card-size-*} tokens defined in {@code tokens.css}. The
 * size constants used to be Tailwind arbitrary classes ({@code
 * w-[100px]}); they're now applied via inline style so the CSS-
 * variable indirection is observable in DevTools and a future
 * theme override can re-target them at runtime. Pixel values are
 * unchanged for the existing 'hand' / 'stack' / 'battlefield'
 * variants — non-redesign mode looks identical.
 *
 * <p>Slice 70-I — added 'focal' size variant for the central focal
 * zone topmost stack item (consumed by slice 70-N's StackZone
 * rewrite).
 */
export type CardFaceSize = 'hand' | 'stack' | 'battlefield' | 'focal';

interface CardFaceProps {
  card: WebCardView;
  size: CardFaceSize;
  /**
   * Battlefield-only — the full permanent view. When present and
   * {@code size === 'battlefield'}, drives counter chips, damage
   * chips, combat badges, summoning-sickness border, and tap
   * rotation. Ignored for hand/stack.
   */
  perm?: WebPermanentView;
  /** Battlefield-only — adds the amber combat-eligibility ring. */
  isEligibleCombat?: boolean;
  /** Battlefield-only — drives ATK / BLK badge color + text. */
  combatRole?: 'attacker' | 'blocker' | null;
  /** Battlefield-only — rotates the tile 90° + dims to 60% opacity. */
  tapped?: boolean;
  /**
   * Battlefield-only — index-based stagger delay (in seconds) applied
   * to the tap/untap spring. Used by {@code BattlefieldRowGroup} to
   * produce a wave effect on start-of-turn untap. Defaults to 0.
   */
  rotateDelay?: number;
}

interface SizeSpec {
  /**
   * Slice 70-I — CSS value for the face width. Either a
   * {@code var(--card-size-X)} reference or an explicit pixel value.
   * Applied via inline style on the wrapper {@code <motion.div>}.
   * The corresponding height is {@code width × 7/5} computed inline.
   */
  width: string;
  /**
   * Optional explicit height override. When omitted the wrapper
   * computes {@code calc(<width> * 7 / 5)} for the 5:7 portrait
   * aspect ratio. Used by 'stack' (which keeps its hand-tuned
   * 60×84 ratio = 7:5 inverted… er, 60 × 7/5 = 84, matches; so
   * 'stack' could also use the calc, but explicit pixels here
   * preserve the slice-52e visual contract verbatim).
   */
  height?: string;
  rounded: string;
  border: string;
  shadow: string;
  imageVersion: ScryfallVersion;
  fallbackTextSize: string;
  fallbackPadding: string;
  manaPos: string;
  manaPad: string;
  banner: string;
  bannerText: string;
  ptBottom: string;
  ptText: string;
  manaSize: 'sm' | 'normal';
  testid: string;
  // Pre-extraction-preserving micro-tunables. Stack used /85 mana-cost
  // backdrop and leading-tight on the name banner; hand/battlefield
  // used /80 + default leading. Bookkeeping for the slice-52e behavior-
  // preservation contract.
  manaBg: string;
  bannerLeading: string;
}

const SIZE_SPECS: Record<CardFaceSize, SizeSpec> = {
  hand: {
    // Slice 70-I — was w-[100px] h-[140px]; now reads --card-size-large
    // = 100px (preserves pixel value).
    width: 'var(--card-size-large)',
    rounded: 'rounded-lg',
    border: 'border-zinc-700',
    shadow: 'shadow-lg shadow-black/50',
    imageVersion: 'normal',
    fallbackTextSize: 'text-[10px]',
    fallbackPadding: 'px-2',
    manaPos: 'top-1 right-1',
    manaPad: 'px-1 py-0.5',
    banner: 'px-1.5 py-0.5',
    bannerText: 'text-[10px]',
    ptBottom: 'bottom-5 right-1',
    ptText: 'text-[10px] text-zinc-200',
    manaSize: 'sm',
    testid: 'hand-card-face',
    manaBg: 'bg-zinc-950/80',
    bannerLeading: '',
  },
  stack: {
    // Slice 70-I — stack stays at hand-tuned 60×84 (not migrated to a
    // token because stack zone is rewritten in slice 70-N to consume
    // 'focal' size instead; this entry is preserved for the pre-70-N
    // layout's continuing visual contract).
    width: '60px',
    height: '84px',
    rounded: 'rounded',
    border: 'border-zinc-700',
    shadow: 'shadow',
    imageVersion: 'normal',
    fallbackTextSize: 'text-[8px]',
    fallbackPadding: 'px-1',
    manaPos: 'top-0.5 right-0.5',
    manaPad: 'px-0.5',
    banner: 'px-1 py-0.5',
    bannerText: 'text-[9px]',
    ptBottom: 'bottom-4 right-0.5',
    ptText: 'text-[10px] text-zinc-100',
    manaSize: 'sm',
    testid: 'stack-tile-face',
    manaBg: 'bg-zinc-950/85',
    bannerLeading: 'leading-tight',
  },
  battlefield: {
    // Slice 70-I — was w-[80px] h-[112px]; now reads --card-size-medium
    // = 80px (preserves pixel value).
    width: 'var(--card-size-medium)',
    rounded: 'rounded-lg',
    border: 'border-zinc-700',
    shadow: 'shadow-md shadow-black/50',
    imageVersion: 'normal',
    fallbackTextSize: 'text-[9px]',
    fallbackPadding: 'px-1.5',
    manaPos: 'top-0.5 right-0.5',
    manaPad: 'px-1 py-0.5',
    banner: 'px-1 py-0.5',
    bannerText: 'text-[9px]',
    ptBottom: 'bottom-4 right-0.5',
    ptText: 'text-[10px] text-zinc-100',
    manaSize: 'sm',
    testid: 'battlefield-tile-face',
    manaBg: 'bg-zinc-950/80',
    bannerLeading: '',
  },
  // Slice 70-I — central focal zone topmost stack item. Consumed by
  // slice 70-N's StackZone rewrite. Renders at --card-size-focal
  // (170px width, 238px height) with feature-size visual treatment:
  // larger banner text, bigger mana cost, prominent name. P/T renders
  // (focal cards may be creature spells just like hand cards). Test
  // ID matches the picture-catalog §3.1 entry.
  focal: {
    width: 'var(--card-size-focal)',
    rounded: 'rounded-lg',
    border: 'border-zinc-700',
    shadow: 'shadow-xl shadow-black/60',
    imageVersion: 'normal',
    fallbackTextSize: 'text-sm',
    fallbackPadding: 'px-3',
    manaPos: 'top-2 right-2',
    manaPad: 'px-1.5 py-0.5',
    banner: 'px-2 py-1',
    bannerText: 'text-sm',
    ptBottom: 'bottom-7 right-2',
    ptText: 'text-sm text-zinc-100',
    manaSize: 'normal',
    testid: 'focal-card-face',
    manaBg: 'bg-zinc-950/85',
    bannerLeading: '',
  },
};

export function CardFace(props: CardFaceProps): JSX.Element {
  const { card, size, perm, isEligibleCombat, combatRole, tapped, rotateDelay } =
    props;
  const spec = SIZE_SPECS[size];
  const [imageFailed, setImageFailed] = useState(false);
  const url = scryfallImageUrl(card, spec.imageVersion);
  const isCreature = !!(card.power || card.toughness);
  const isPlaneswalker = !!card.startingLoyalty;
  // Stack tiles never show P/T — the stack zone is for spells/abilities,
  // not creatures-as-creatures. Hand + battlefield render P/T or loyalty.
  const showPT = size !== 'stack' && (isCreature || isPlaneswalker);

  // Battlefield-only state derived from perm. For hand/stack the
  // perm prop is ignored.
  const isBattlefield = size === 'battlefield' && perm !== undefined;
  const sick = isBattlefield ? perm!.summoningSickness : false;
  const counterEntries = isBattlefield ? Object.entries(card.counters) : [];
  const hasCounters = counterEntries.length > 0;
  const counterText = counterEntries
    .map(([type, n]) => `${type}: ${n}`)
    .join(', ');
  const damage = isBattlefield ? perm!.damage : 0;
  const role = isBattlefield ? (combatRole ?? null) : null;

  // Slice 59 — transient flash state for damage and counter increases.
  // Pattern mirrors LifeCounter (slice 70-C, was LifeTotal): useRef tracks prev value,
  // useEffect detects an INCREASE (not decrease — heal/counter-removal
  // shouldn't fire), useState bumps a key counter to force a fresh
  // motion.div remount. The damage flash self-unmounts via
  // onAnimationComplete; the counter pop relies on the key remount
  // pattern — no setTimeout needed in either path.
  const prevDamageRef = useRef(damage);
  const [damageFlashKey, setDamageFlashKey] = useState(0);
  useEffect(() => {
    if (damage > prevDamageRef.current) {
      setDamageFlashKey((k) => k + 1);
    }
    prevDamageRef.current = damage;
  }, [damage]);

  const counterTotal = counterEntries.reduce((sum, [, n]) => sum + n, 0);
  const prevCounterTotalRef = useRef(counterTotal);
  const [counterPopKey, setCounterPopKey] = useState(0);
  useEffect(() => {
    if (counterTotal > prevCounterTotalRef.current) {
      setCounterPopKey((k) => k + 1);
    }
    prevCounterTotalRef.current = counterTotal;
  }, [counterTotal]);

  // Battlefield-specific border + ring + tap transform.
  const sickBorder =
    isBattlefield && sick ? 'border-zinc-500/70 border-dashed' : spec.border;
  const combatRing =
    isBattlefield && isEligibleCombat ? 'ring-2 ring-amber-400/60' : '';
  const tapClass = isBattlefield && tapped ? 'opacity-60' : '';
  // Slice 58 — Framer Motion now drives the rotation with a spring
  // (overshoot + settle) instead of a linear CSS transition. The
  // initial value matches the current tapped state so a permanent
  // that ETBs already tapped renders rotated without animating.
  const rotateInitial = isBattlefield ? (tapped ? 90 : 0) : 0;
  const rotateAnimate = isBattlefield ? (tapped ? 90 : 0) : 0;
  const rotateTransition = isBattlefield
    ? slow({ ...MANA_TAP_ROTATE, delay: rotateDelay ?? 0 })
    : undefined;

  // Fallback gradient — hand / battlefield / focal use the three-stop
  // variant with the via-zinc-850 mid-tone; stack uses the simpler
  // two-stop because at 60×84 the extra stop is invisible. Preserves
  // the exact pre-extraction visuals. Slice 70-I — focal joins the
  // three-stop set since it's a feature-size card and benefits from
  // the same mid-tone depth as hand/battlefield.
  const fallbackGradient =
    size === 'stack'
      ? 'bg-gradient-to-b from-zinc-800 to-zinc-900'
      : 'bg-gradient-to-b from-zinc-800 via-zinc-850 to-zinc-900';

  // Slice 70-I — inline style for width + height. spec.width is
  // either a pixel value ('60px') or a CSS-var reference
  // ('var(--card-size-large)'). Height defaults to width × 7/5
  // (5:7 portrait aspect ratio) unless the spec explicitly sets it
  // (only 'stack' overrides today, preserving its 60×84 ratio).
  const sizeStyle: CSSProperties = {
    width: spec.width,
    height: spec.height ?? `calc(${spec.width} * 7 / 5)`,
  };

  return (
    <motion.div
      data-testid={spec.testid}
      data-card-face-size={size}
      className={
        'relative ' +
        spec.rounded +
        ' overflow-hidden border ' +
        sickBorder +
        ' bg-zinc-900 ' +
        spec.shadow +
        (combatRing ? ' ' + combatRing : '') +
        (tapClass ? ' ' + tapClass : '')
      }
      style={sizeStyle}
      initial={{ rotate: rotateInitial }}
      animate={{ rotate: rotateAnimate }}
      transition={rotateTransition}
    >
      {url && !imageFailed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div
          className={
            'absolute inset-0 ' +
            fallbackGradient +
            ' flex items-center justify-center ' +
            spec.fallbackPadding
          }
        >
          <span
            className={
              spec.fallbackTextSize +
              ' text-zinc-500 italic text-center leading-tight'
            }
          >
            {card.name}
          </span>
        </div>
      )}
      {/* Mana cost overlay (top-right) */}
      {card.manaCost && (
        <div
          className={
            'absolute ' +
            spec.manaPos +
            ' ' +
            spec.manaBg +
            ' backdrop-blur-sm rounded ' +
            spec.manaPad
          }
        >
          <ManaCost cost={card.manaCost} size={spec.manaSize} />
        </div>
      )}
      {/* Counter chip (top-left). Hidden during combat so the
          ATK/BLK badge can take that slot. Slice 59 — scale-pops on
          counter total increase. The key={`counter-${counterPopKey}`}
          forces a fresh motion component on each pop, so the
          initial: scale 1.3 → animate: scale 1 runs once per increase.
          The counterPopKey > 0 conditional ensures the FIRST render
          (when the chip first mounts) doesn't pop — only subsequent
          increases. */}
      {isBattlefield && hasCounters && role === null && (
        <motion.div
          key={`counter-${counterPopKey}`}
          data-testid="permanent-counters"
          data-counter-pop-key={counterPopKey}
          initial={counterPopKey > 0 ? { scale: 1.3 } : { scale: 1 }}
          animate={{ scale: 1 }}
          transition={slow(COUNTER_POP)}
          className="absolute top-0.5 left-0.5 bg-amber-500/30 text-amber-100 text-[9px] font-mono px-1 rounded max-w-[60px] truncate"
          title={counterText}
        >
          {counterText}
        </motion.div>
      )}
      {/* Combat ATK / BLK badge (top-left, replaces counter chip
          during combat). Slice 26 colors preserved. */}
      {isBattlefield && role === 'attacker' && (
        <span
          data-testid="combat-badge-attacker"
          className="absolute top-0.5 left-0.5 text-[9px] font-semibold bg-red-500/40 text-red-100 px-1 rounded"
          title="Attacking"
        >
          ATK
        </span>
      )}
      {isBattlefield && role === 'blocker' && (
        <span
          data-testid="combat-badge-blocker"
          className="absolute top-0.5 left-0.5 text-[9px] font-semibold bg-sky-500/40 text-sky-100 px-1 rounded"
          title="Blocking"
        >
          BLK
        </span>
      )}
      {/* Damage chip (lower-left, above the name banner). */}
      {isBattlefield && damage > 0 && (
        <div
          data-testid="permanent-damage"
          className="absolute bottom-5 left-0.5 bg-red-500/30 text-red-200 text-[10px] font-mono px-1 rounded"
          title={`${damage} damage marked`}
        >
          {`-${damage}`}
        </div>
      )}
      {/* Name banner across the bottom */}
      <div
        className={
          'absolute inset-x-0 bottom-0 bg-zinc-950/85 backdrop-blur-sm ' +
          spec.banner
        }
      >
        <p
          className={(
            spec.bannerText +
            ' font-medium text-zinc-100 truncate ' +
            spec.bannerLeading
          ).trim()}
        >
          {card.name}
        </p>
      </div>
      {/* P/T or loyalty (bottom-right, above the name banner). Stack
          tiles skip this — the stack is for spells/abilities. */}
      {showPT && (
        <div
          className={
            'absolute ' +
            spec.ptBottom +
            ' bg-zinc-950/85 backdrop-blur-sm rounded px-1 py-0.5 font-mono ' +
            spec.ptText
          }
        >
          {isPlaneswalker
            ? card.startingLoyalty
            : `${card.power}/${card.toughness}`}
        </div>
      )}
      {/* Slice 59 — damage flash overlay. Mounts when damageFlashKey
          increments (from a damage increase), pulses 0 → 0.4 → 0
          opacity over 250ms, then self-unmounts via the
          onAnimationComplete callback. pointer-events-none so it
          doesn't block clicks during its lifetime; rounded-[inherit]
          so it respects the parent CardFace's rounded corners. Sits
          INSIDE the rotating motion.div so a tapped creature taking
          damage flashes with the card's rotation. */}
      {damageFlashKey > 0 && (
        <motion.div
          key={`damage-flash-${damageFlashKey}`}
          data-testid="damage-flash"
          data-damage-flash-key={damageFlashKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.4, 0] }}
          transition={slow(DAMAGE_FLASH)}
          onAnimationComplete={() => {
            // Self-cleanup so the overlay unmounts after the flash —
            // otherwise it would stay mounted at opacity 0 forever,
            // accumulating one motion.div per damage event over the
            // course of a game.
            //
            // Compare-and-set: only zero out if THIS key is still the
            // current one. Guards the rapid-double-damage race where a
            // second flash mounts (key=2) before the first finishes;
            // the stale onAnimationComplete from key=1 would otherwise
            // wipe out the active key=2 overlay's state.
            const thisKey = damageFlashKey;
            setDamageFlashKey((k) => (k === thisKey ? 0 : k));
          }}
          className="absolute inset-0 bg-red-500 pointer-events-none rounded-[inherit]"
          aria-hidden="true"
        />
      )}
    </motion.div>
  );
}
