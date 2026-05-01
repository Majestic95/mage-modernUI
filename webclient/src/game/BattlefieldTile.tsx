import type { WebPermanentView } from '../api/schemas';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';

/**
 * Slice 45 â€” replaces the slice-9-era {@code PermanentChip} text-chip
 * with a card-shaped tile (5:7 aspect, ~80Ã—112). Mirrors
 * {@link HandCardFace} for the visual base â€” Scryfall art, mana cost,
 * name banner, P/T â€” and adds the battlefield-specific affordances:
 * tap rotation (90Â° clockwise), combat highlight ring, ATK/BLK
 * badges, damage chip, counter chip, summoning-sickness border.
 *
 * <p>Each tile is rendered inside a fixed 112Ã—112 square slot so the
 * tap rotation (which swaps the tile's bounding box from 80Ã—112
 * portrait to 112Ã—80 landscape) stays within the slot â€” neighbors
 * never reflow when a card taps.
 *
 * <p>The slot wrapper sits OUTSIDE {@link HoverCardDetail} on
 * purpose: HoverCardDetail's trigger span is {@code position:
 * relative}, and the slice-44a bug demonstrated that any
 * absolutely-positioned descendant collapses to the left edge of
 * that inline-flex span. The slot itself is a flex item (no
 * absolute positioning), so the bug doesn't trigger here, but
 * keeping the layout box outside HoverCardDetail also makes the
 * trigger element's bounding box exactly the tile, which gives
 * cleaner positioning for the popover.
 */
export function BattlefieldTile({
  perm,
  canAct,
  onClick,
  isEligibleCombat,
  combatRole,
  rotateDelay,
}: {
  perm: WebPermanentView;
  canAct: boolean;
  onClick: (id: string) => void;
  /**
   * Slice 26 â€” the engine has marked this permanent as a legal
   * attacker (declareAttackers) or legal blocker (declareBlockers).
   * Renders an amber highlight ring so the player can see at a
   * glance which creatures the click-to-toggle gesture applies to.
   */
  isEligibleCombat: boolean;
  /**
   * Slice 26 â€” non-null when this permanent is currently in a
   * combat group ({@code gv.combat[]}). Drives the ATK / BLK badge.
   */
  combatRole: 'attacker' | 'blocker' | null;
  /**
   * Slice 58 â€” index-based stagger delay (in seconds) applied to the
   * tap/untap rotation spring. Produces a wave on start-of-turn untap.
   */
  rotateDelay?: number;
}) {
  const tapped = perm.tapped;
  return (
    // Slice 70-K.1 (picture-catalog §2.1 + design-system §7.1
    // "Card sizing under board complexity") — slot is now
    // RESPONSIVE rather than fixed 112×112. The outer
    // BattlefieldRowGroup gives this tile a flex-shrink-able
    // container with `flex: 1 1 0` + max-width 112px; this slot
    // fills 100% of that allocation and stays square via
    // aspect-ratio: 1. Tapped rotation still fits because the
    // slot is square at any size — a (5/7 S) × S portrait card
    // and its tapped (S × 5/7 S) landscape both fit in S × S.
    //
    // CardFace's 'battlefield' variant (slice 70-I tokens) was
    // updated in lockstep to use `height: 100%, aspect-ratio:
    // 5/7, width: auto` so it fills the slot's height and
    // computes its width via aspect-ratio. With the slot as
    // S×S, card width = S × 5/7. At S=112 that's 80 — matches
    // the original pre-70-K.1 pixel sizes.
    //
    // The maxWidth: 112px on the OUTER motion.div in
    // BattlefieldRowGroup caps the per-tile growth so a row
    // with few cards doesn't blow them up to weird sizes.
    // Slice 70-K.1 critic CRITICAL-1 fix — `items-stretch` (not
    // `items-center`) so the inline-flex span inside HoverCardDetail
    // takes the slot's full cross-axis height. With `items-center`,
    // the span was content-sized (height: auto) and CardFace's
    // `height: 100%` resolved to 0 against the indefinite parent —
    // cards would render 0×0 in real browsers despite jsdom tests
    // passing. `items-stretch` is the flex default, but we need to
    // also keep `justify-center` to horizontally center the
    // narrower-than-slot portrait (5/7 of the slot width).
    <div className="aspect-square w-full flex items-stretch justify-center">
      <HoverCardDetail card={perm.card}>
        <button
          type="button"
          data-testid="permanent"
          // Slice 70-N — exposes the permanent's underlying card UUID
          // (== {@code perm.card.id}) so the StackZone combat-mode
          // arrow renderer can {@code querySelector} for the
          // attacker's bounding rect by ID. The button (not the
          // outer slot) carries the attribute so the arrow anchors
          // on the rendered card surface, not on whitespace inside
          // the slot.
          data-permanent-id={perm.card.id}
          data-tapped={tapped}
          data-combat-eligible={isEligibleCombat || undefined}
          data-combat-role={combatRole ?? undefined}
          disabled={!canAct}
          onClick={() => onClick(perm.card.id)}
          title={
            canAct
              ? `${perm.card.name} — click to tap/activate`
              : perm.card.typeLine
          }
          className={
            'select-none rounded-lg block h-full ' +
            (canAct ? 'cursor-pointer' : 'cursor-default')
          }
        >
          <BattlefieldTileFace
            perm={perm}
            isEligibleCombat={isEligibleCombat}
            combatRole={combatRole}
            tapped={tapped}
            rotateDelay={rotateDelay}
          />
        </button>
      </HoverCardDetail>
    </div>
  );
}

/**
 * Inner card layout for {@link BattlefieldTile}. Layered:
 *   - Scryfall art covering the body via {@code normal} version
 *   - Mana cost overlay top-right
 *   - Name banner across the bottom
 *   - P/T overlay bottom-right (creatures) / loyalty (planeswalkers)
 *   - Counter chip top-left (when {@code card.counters} non-empty)
 *   - Damage chip lower-left (when {@code damage > 0})
 *   - Combat ATK / BLK badge top-left (over the counter chip slot;
 *     they shouldn't both be present in practice â€” combat badges
 *     only appear during declare-blockers/attackers, counters can
 *     appear any time but the visual collision is mild)
 *   - Combat-eligible amber ring on the outer card box
 *   - Tap state: rotate 90Â° clockwise + opacity 60%
 *   - Summoning sickness: subtle dashed zinc border (replaces the
 *     legacy italic text styling â€” italics don't carry meaning on
 *     a card-art tile)
 *
 * <p>Falls back to a name-only silhouette when Scryfall has no art
 * (token, ad-hoc emblem, etc.) â€” same defensive pattern as
 * {@link HandCardFace}.
 */
function BattlefieldTileFace({
  perm,
  isEligibleCombat,
  combatRole,
  tapped,
  rotateDelay,
}: {
  perm: WebPermanentView;
  isEligibleCombat: boolean;
  combatRole: 'attacker' | 'blocker' | null;
  tapped: boolean;
  rotateDelay?: number;
}) {
  return (
    <CardFace
      card={perm.card}
      size="battlefield"
      perm={perm}
      isEligibleCombat={isEligibleCombat}
      combatRole={combatRole}
      tapped={tapped}
      rotateDelay={rotateDelay}
    />
  );
}
