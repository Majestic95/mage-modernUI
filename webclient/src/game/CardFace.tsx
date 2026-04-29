import { useState, type JSX } from 'react';
import { motion } from 'framer-motion';
import type { WebCardView, WebPermanentView } from '../api/schemas';
import { ManaCost, scryfallImageUrl, type ScryfallVersion } from '../pages/Game';
import { slow } from '../animation/debug';
import { MANA_TAP_ROTATE } from '../animation/transitions';

/**
 * Slice 52e — shared card-face renderer used by hand, stack, and
 * battlefield zones. Three sizes share the same skeleton (Scryfall
 * art with image-fail fallback, mana cost overlay top-right, name
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
 */
export type CardFaceSize = 'hand' | 'stack' | 'battlefield';

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
  width: string;
  height: string;
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
    width: 'w-[100px]',
    height: 'h-[140px]',
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
    width: 'w-[60px]',
    height: 'h-[84px]',
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
    width: 'w-[80px]',
    height: 'h-[112px]',
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

  // Fallback gradient — hand + battlefield use the three-stop variant
  // with the via-zinc-850 mid-tone; stack uses the simpler two-stop
  // because at 60×84 the extra stop is invisible. Preserves the
  // exact pre-extraction visuals.
  const fallbackGradient =
    size === 'stack'
      ? 'bg-gradient-to-b from-zinc-800 to-zinc-900'
      : 'bg-gradient-to-b from-zinc-800 via-zinc-850 to-zinc-900';

  return (
    <motion.div
      data-testid={spec.testid}
      data-card-face-size={size}
      className={
        'relative ' +
        spec.width +
        ' ' +
        spec.height +
        ' ' +
        spec.rounded +
        ' overflow-hidden border ' +
        sickBorder +
        ' bg-zinc-900 ' +
        spec.shadow +
        (combatRing ? ' ' + combatRing : '') +
        (tapClass ? ' ' + tapClass : '')
      }
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
          ATK/BLK badge can take that slot. */}
      {isBattlefield && hasCounters && role === null && (
        <div
          data-testid="permanent-counters"
          className="absolute top-0.5 left-0.5 bg-amber-500/30 text-amber-100 text-[9px] font-mono px-1 rounded max-w-[60px] truncate"
          title={counterText}
        >
          {counterText}
        </div>
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
    </motion.div>
  );
}
