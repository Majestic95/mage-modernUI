import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WebCardView, WebPlayerView } from '../api/schemas';
import { slow, SLOWMO } from '../animation/debug';
import {
  HAND_HOVER_LIFT_MS,
  LAYOUT_GLIDE,
} from '../animation/transitions';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';
import { ManaPool } from './ManaPool';
import { hasAnyMana } from './manaPoolUtil';
import { REDESIGN } from '../featureFlags';

export function MyHand({
  hand,
  player,
  canAct,
  onObjectClick,
  isMyTurn,
  hasPriority,
  onPointerDown,
  draggedCardId,
}: {
  hand: Record<string, WebCardView>;
  /**
   * Slice 70-P (picture-catalog §2.3) — local player view, threaded
   * through so the floating mana pool can mount in the hand region's
   * top-right corner. Optional so legacy tests that don't care about
   * mana pool placement don't need to construct a full player.
   */
  player?: WebPlayerView;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  isMyTurn: boolean;
  hasPriority: boolean;
  /**
   * Slice 36 â€” bound on each hand-card button to start the drag-
   * to-play gesture. The Battlefield owner decides whether the
   * press becomes a drag (5px movement threshold) or stays a
   * click; both paths route through {@code onObjectClick}.
   */
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  /**
   * Slice 36 â€” id of the card currently being dragged, if any.
   * The matching hand chip dims so the user can see which one is
   * "in flight". Other chips render normally.
   */
  draggedCardId: string | null;
}) {
  const cards = Object.values(hand);
  // Slice 23: clearer reason when hand is disabled.
  // - !hasPriority â†’ engine isn't waiting on you
  // - hasPriority && !isMyTurn â†’ you can react with instants but
  //   not play lands / sorceries; the user-typical click on a
  //   Forest is silently rejected by upstream because it's not
  //   their main phase.
  // The hint text spells out the rule so the user doesn't have to
  // internalize Magic's priority/timing system to understand why.
  const disabledHint = !hasPriority
    ? 'Waiting for opponent'
    : !isMyTurn
      ? 'Wait for your turn â€” most cards are sorcery-speed'
      : '';

  const cardTooltip = (card: WebCardView) => {
    if (canAct && isMyTurn) return `${card.name} â€” click to play/cast`;
    if (canAct && !isMyTurn) {
      // Instant-speed only on opponent's turn. Today we don't
      // distinguish instants in the UI; the engine will gameError
      // on illegal sorcery-speed clicks. Hint accordingly.
      return `${card.name} â€” only instants are playable on opponent's turn`;
    }
    return card.typeLine;
  };

  // Slice 70-P (picture-catalog §4) — REDESIGN drops the panel
  // chrome (border, padding, background tile, "Your hand (N)"
  // header) so the hand fan floats over the battlefield's bottom
  // edge per spec §4.1 ("Background: Transparent (no panel fill,
  // no border)") + §4.2 ("Drop the 'Your hand (N)' header").
  // Disabled-hint copy moves to the bottom-right corner as a faint
  // pill since §4.2 says it can stay "as a faint pill near the End
  // Step button OR drop entirely; the End Step button being
  // disabled IS the signal." Keeping a faint inline hint preserves
  // the slice-23 affordance without the prominent label box.
  if (REDESIGN) {
    // Slice 70-P critic Tech adjacent — gate the floating-pool
    // wrapper on hasAnyMana so an empty pool produces NO DOM at
    // all (catalog §2.3 "Empty pool: Don't render anything").
    // Without the gate, the absolute-positioned wrapper still
    // mounts as a 1px shell.
    const showPool = !!player && hasAnyMana(player.manaPool);
    return (
      <div data-testid="my-hand" className="relative">
        {/* Picture-catalog §2.3 — local mana pool floats at the
            TOP-RIGHT of the hand region (NOT inside the player
            frame). Renders glowing medium orbs per §2.3 "Glow
            halo on each orb." Slice 70-P critic UI/UX-C1 fix —
            glow={true} wires the spec-mandated halo through to
            ManaOrb's box-shadow. */}
        {showPool && (
          <div
            data-testid="hand-mana-pool"
            // Slice 70-Z polish round 20 (user direction 2026-04-30) —
            // mana pool moved UP via negative top so it clears the
            // local PlayerFrame corner mount's PRIORITY pill that
            // sits in the same screen quadrant. Was top-1 (4px); now
            // -top-5 (-20px) gives ~24px vertical clearance above
            // the pill at typical viewport sizes. Right anchor (and
            // the floating-pool semantics) unchanged.
            className="absolute right-2 -top-5 z-10"
          >
            <ManaPool player={player!} size="medium" glow />
          </div>
        )}
        {disabledHint && (
          <span
            data-testid="hand-disabled-hint"
            className="absolute right-2 bottom-1 text-[10px] text-zinc-500 italic z-10 pointer-events-none"
          >
            {disabledHint}
          </span>
        )}
        {/* Slice 70-Z polish round 17 — right gutter expanded from
            150px to 200px to reserve room for the local PlayerFrame
            corner mount (Battlefield round-17 change places the
            local portrait at the bottom-right of the battlefield
            region, just left of the side panel's ActionButton).
            The fan now stops short of the portrait area so the
            portrait is fully visible — no card overlap.
            Slice 70-P critic UI/UX-I1 — gutter also includes the
            floating mana pool (top-right of hand region, ~136px
            wide for a 5-orb pool). 200px covers both.
            Slice 70-Z polish round 14 — container height h-[280px]
            fits 80%-bigger hand cards (180px wide × 252px tall via
            --card-size-large) plus hover-lift headroom. The
            container itself is fixed at viewport bottom (mounted
            by GameTable). */}
        <div className="relative h-[280px] pt-2 pr-[200px]">
          {cards.length === 0 ? (
            <span className="absolute left-3 top-3 text-xs text-zinc-600 italic">
              Empty hand.
            </span>
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              {cards.map((card, idx) => {
                const isDragging = draggedCardId === card.id;
                return (
                  <HandCardSlot
                    key={card.id}
                    card={card}
                    index={idx}
                    total={cards.length}
                    canAct={canAct}
                    isDragging={isDragging}
                    onObjectClick={onObjectClick}
                    onPointerDown={onPointerDown}
                    tooltip={cardTooltip(card)}
                  />
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>
    );
  }

  // Legacy branch — unchanged from slice 57.
  return (
    <div
      data-testid="my-hand"
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
    >
      <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wide flex items-baseline justify-between">
        <span>Your hand ({cards.length})</span>
        {disabledHint && (
          <span
            data-testid="hand-disabled-hint"
            className="text-[10px] normal-case tracking-normal text-zinc-500 italic"
          >
            {disabledHint}
          </span>
        )}
      </div>
      {/* Slice 44 â€” arc-fan hand layout per ADR 0005 Â§5. Cards are
          absolute-positioned along an arc with subtle per-card
          rotation, hover lifts the focused card to 0Â° + scale 1.15
          + raises z-index. Pointer-events DnD from slice 36 still
          works because the underlying button keeps the same
          handlers and testid. The wrapper is `h-44` so the lift
          has room without pushing layout.*/}
      {/*
        Slice 57 (UX audit fix C) â€” h-44 (176px) was 20px short for
        the 140px card + 56px hover-lift (= 196px needed). The
        lifted card was clipping at the top against the MyHand border.
        h-52 = 208px gives 12px overhead headroom plus pt-14 ensures
        the lift origin sits below the section header so a hovered
        card can fully float above without intersecting the "Your hand"
        label.
      */}
      <div className="relative h-52 pt-2">
        {cards.length === 0 ? (
          <span className="absolute left-3 top-3 text-xs text-zinc-600 italic">
            Empty hand.
          </span>
        ) : (
          // Slice 54 â€” wrap in AnimatePresence so a card removed from
          // the hand (cast / discard / shuffle-into-library) gets its
          // exit phase. Without this, Framer never sees the source
          // bbox and the layoutId={card.cardId} match (slices 52a-c)
          // can't fire â€” the stack tile pops up from above instead of
          // gliding from the hand position.
          <AnimatePresence mode="popLayout" initial={false}>
            {cards.map((card, idx) => {
              const isDragging = draggedCardId === card.id;
              return (
                <HandCardSlot
                  key={card.id}
                  card={card}
                  index={idx}
                  total={cards.length}
                  canAct={canAct}
                  isDragging={isDragging}
                  onObjectClick={onObjectClick}
                  onPointerDown={onPointerDown}
                  tooltip={cardTooltip(card)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* ---------- hand fan layout (slice 44) ---------- */

/**
 * Compute the resting-state transform + z-index for one card in the
 * arc fan. Cards spread symmetrically around center; angle and
 * x-offset scale linearly with distance from center; y-offset is a
 * shallow downward arc so the leftmost / rightmost cards droop
 * slightly (matches the way real hands of cards sit). Hover state
 * overrides this in the slot itself.
 */
function fanGeometry(index: number, total: number): {
  x: number;
  y: number;
  rot: number;
} {
  if (total <= 1) return { x: 0, y: 0, rot: 0 };
  const fromCenter = index - (total - 1) / 2;
  // Slice 70-Z polish rounds 15 + 16 (user feedback 2026-04-30) —
  // fanning distance bumped twice. Round 15: +40% (80 → 112). Round
  // 16: another +25% (112 → 140). High-hand-size tightening floor
  // 40 → 70; tightening step 6 → 10 (proportional). Card overlap
  // at the redesigned 180px card width drops from ~55% to ~22% —
  // each card's mana cost / name / art reads clearly at a glance,
  // with just enough overlap to keep the fan silhouette intact.
  const spreadPx = total > 5 ? Math.max(70, 140 - (total - 5) * 10) : 140;
  const maxAngle = 12;
  const x = fromCenter * spreadPx;
  const y = Math.abs(fromCenter) * 3;
  const rot = (fromCenter / ((total - 1) / 2)) * maxAngle;
  return { x, y, rot };
}

/**
 * One card in the hand fan. Wraps the existing
 * {@link HoverCardDetail} (rich popover) and adds an inner local
 * hover state for the lift / un-rotate / scale-up animation.
 */
function HandCardSlot({
  card,
  index,
  total,
  canAct,
  isDragging,
  onObjectClick,
  onPointerDown,
  tooltip,
}: {
  card: WebCardView;
  index: number;
  total: number;
  canAct: boolean;
  isDragging: boolean;
  onObjectClick: (id: string) => void;
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  tooltip: string;
}) {
  const [lifted, setLifted] = useState(false);
  const { x, y, rot } = fanGeometry(index, total);
  // Hover lift cancels the rotation, raises the card, scales it up,
  // and bumps z so it sits above siblings. Transform applied to the
  // OUTER absolute-positioned wrapper rather than the button â€” the
  // button is wrapped by HoverCardDetail's `relative inline-flex`
  // span, which would otherwise become the positioned ancestor and
  // collapse every card to the left edge of its own tiny span (the
  // bug fix from slice 44 follow-up).
  const transform = lifted
    ? `translate(-50%, 0) translateX(${x}px) translateY(-56px) rotate(0deg) scale(1.15)`
    : `translate(-50%, 0) translateX(${x}px) translateY(${y}px) rotate(${rot}deg)`;
  // Slice 52c â€” layoutId pinned to an INNER motion.div so the
  // fan-arc CSS transform on the OUTER div doesn't conflict with
  // Framer's layout-tracking. Framer reads the motion element's
  // bounding-client-rect to compute glide trajectories â€” putting
  // layoutId on the outer (fan-positioned) div would make Framer
  // think every hand card is already at the rotated/translated
  // position, and the cross-zone glide would start from the wrong
  // spot. The inner motion.div sits inside the button at the
  // visible 100Ã—140 face position, so its bbox matches what the
  // user actually sees.
  //
  // Empty cardId â†’ omit layoutId (defensive default; see slice 52b).
  const layoutId = card.cardId ? card.cardId : undefined;
  return (
    <div
      className="absolute left-1/2 top-2 transition-transform ease-out origin-bottom"
      style={{
        transform,
        // Slice 57 â€” z-index ladder (audit finding 8): hand-lift caps
        // at 20 so it stays UNDER ActionPanel (z-30), drag preview
        // (z-40 â†’ z-50), modals (z-50), and hover popover portals.
        // Pre-fix this was 100 â€” paints over ActionPanel + GameDialog.
        zIndex: lifted ? 20 : index,
        transitionDuration: `${HAND_HOVER_LIFT_MS * SLOWMO}ms`,
      }}
    >
      <HoverCardDetail card={card}>
        <button
          type="button"
          data-testid="hand-card"
          data-card-id={card.id}
          data-dragging={isDragging || undefined}
          data-lifted={lifted || undefined}
          disabled={!canAct}
          onClick={() => onObjectClick(card.id)}
          onPointerDown={(ev) => canAct && onPointerDown(card.id, ev)}
          onMouseEnter={() => setLifted(true)}
          onMouseLeave={() => setLifted(false)}
          onFocus={() => setLifted(true)}
          onBlur={() => setLifted(false)}
          title={tooltip}
          className={
            'select-none ' +
            (canAct
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default opacity-70') +
            (isDragging ? ' opacity-30' : '')
          }
        >
          <motion.div
            layoutId={layoutId}
            data-layout-id={layoutId}
            transition={{ layout: slow(LAYOUT_GLIDE) }}
          >
            <HandCardFace card={card} />
          </motion.div>
        </button>
      </HoverCardDetail>
    </div>
  );
}

/**
 * Card-shaped tile (5:7 aspect) for the hand fan. Layered:
 *   - Scryfall art via `normal` version covering the upper body
 *   - Mana cost overlay top-right
 *   - Name banner across the bottom (over the art's bottom edge)
 *   - P/T overlay bottom-right for creatures, loyalty for walkers
 *
 * Falls back to a name-only card silhouette when Scryfall has no
 * matching print (token, ad-hoc emblem, etc.) â€” same defensive
 * pattern as the slice-43 thumbnail.
 */
function HandCardFace({ card }: { card: WebCardView }) {
  return <CardFace card={card} size="hand" />;
}
