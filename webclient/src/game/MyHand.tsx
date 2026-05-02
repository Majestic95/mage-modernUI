import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { WebCardView, WebPlayerView } from '../api/schemas';
import { slow, SLOWMO } from '../animation/debug';
import { filterCommanders } from './commanderPredicates';
import {
  HAND_HOVER_LIFT_MS,
  LAYOUT_GLIDE,
} from '../animation/transitions';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';
import { ManaPool } from './ManaPool';
import type { ManaOrbColor } from './ManaOrb';
import { hasAnyMana } from './manaPoolUtil';
import { CLICK_RESOLUTION, REDESIGN } from '../featureFlags';
import { useDialogTargets } from './useDialogTargets';
import type { GameStream } from './stream';

export function MyHand({
  hand,
  player,
  canAct,
  onObjectClick,
  isMyTurn,
  hasPriority,
  onPointerDown,
  draggedCardId,
  onSpendMana,
  stream,
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
  /**
   * Slice 70-X.10 (user feedback 2026-04-30) — when the engine has
   * a gamePlayMana / gamePlayXMana dialog active, GameTable passes
   * a handler that dispatches the player's manaType response. The
   * floating mana pool then renders each orb as a clickable button
   * so the player can spend pool mana directly (vs the prior
   * battlefield-source-only payment path).
   */
  onSpendMana?: (color: ManaOrbColor) => void;
  /**
   * Slice 70-Y.1 — passed to {@link useDialogTargets} so hand cards
   * pulse + click-route through the dialog response channel when the
   * engine fires a discard / hand-target prompt. Optional so legacy
   * tests / non-game contexts still work.
   */
  stream?: GameStream | null;
}) {
  // Bug fix (2026-05-02) — hand reorder via drag-and-drop. Pure
  // client-side UX: maintains a per-render-instance ordering of card
  // ids that survives hand-shape changes (cards drawn appear at the
  // end; cards leaving the hand are dropped from the order). The
  // user can drag any hand card and release on another to move the
  // dragged card to the target's position. Works regardless of
  // priority — reorder is personal, not a game action.
  const handIds = Object.keys(hand);
  const [cardOrder, setCardOrder] = useState<string[]>(() => handIds);
  useEffect(() => {
    setCardOrder((prev) => {
      const inHand = new Set(handIds);
      const kept = prev.filter((id) => inHand.has(id));
      const keptSet = new Set(kept);
      const added = handIds.filter((id) => !keptSet.has(id));
      const next = added.length === 0 && kept.length === prev.length ? prev : [...kept, ...added];
      return next;
    });
  }, [handIds.join('|')]);
  const onReorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    // Swap semantics: dropping A onto B trades their positions.
    // Cleaner than "insert-before-target" because the latter is a
    // no-op when source is already adjacent-left of target — the
    // user's gesture should always have a visible effect.
    setCardOrder((prev) => {
      const fromIdx = prev.indexOf(fromId);
      const toIdx = prev.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
      return next;
    });
  };
  const cards = cardOrder
    .map((id) => hand[id])
    .filter((c): c is WebCardView => !!c);
  // Slice 70-Y.1 — when the click-resolution flag is on, derive the
  // engine's eligible-cards set so hand cards in scope pulse and
  // route clicks through the dialog response channel. When the flag
  // is off OR no dialog is active, this is just an empty set and
  // hand-card render is unchanged from the legacy behavior.
  const dialogState = useDialogTargets(stream ?? null);
  const dialogActive = CLICK_RESOLUTION && dialogState.active;
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
  // LEGACY-BRANCH-FORK — slice 70-X.13 (Wave 4) cleanup marker.
  // Pairs with LEGACY-BRANCH-END below. See PlayerArea.tsx for the
  // full mechanical-cleanup procedure when REDESIGN flips on.
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
            // Slice 70-Z polish rounds 20 + 22 (user direction
            // 2026-04-30) — mana pool moved UP via negative top so
            // it clears the local PlayerFrame corner mount that
            // sits in the same screen quadrant. Round 20: top-1
            // → -top-5 (cleared the PRIORITY pill). Round 22: the
            // -top-5 lift wasn't enough to escape the portrait
            // itself — orbs visibly overlapped the portrait's top
            // edge. -top-20 (-80px) lifts the orbs roughly the
            // portrait-diameter above MyHand-top, putting them
            // clearly above the corner mount's full footprint
            // (portrait + PRIORITY pill + life badge). Right
            // anchor unchanged (catalog §2.3 "TOP-RIGHT of the
            // hand region").
            className="absolute right-2 -top-20 z-10"
          >
            <ManaPool
              player={player!}
              size="medium"
              glow
              onSpend={onSpendMana}
            />
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
        {/* Slice 70-Z polish (user direction 2026-04-30) — local
            command zone. The player's commander card sits to the
            LEFT of the hand fan, persistently visible at hand-card
            size. Wherever the commander appears (here, on the
            stack, on the battlefield, in graveyard/exile, mid-
            return-glide), CardFace's commanderColorsForCard hook
            paints a color-identity halo bloom behind it
            automatically.

            Anchored absolute bottom-left of the hand region so
            the fan's pl- doesn't shift with hand size. Aligned
            with the fan baseline so it reads as part of the same
            row. */}
        {player && (
          <CommandZoneSlot
            player={player}
            canAct={canAct}
            onObjectClick={onObjectClick}
          />
        )}
        <div className="relative h-[280px] pt-2 pl-[140px] pr-[200px]">
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
                    draggedCardId={draggedCardId}
                    onObjectClick={onObjectClick}
                    onPointerDown={onPointerDown}
                    onReorder={onReorder}
                    tooltip={cardTooltip(card)}
                    targetableForDialog={
                      dialogActive &&
                      dialogState.eligibleCardIds.has(card.id)
                    }
                  />
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </div>
    );
  }

  // LEGACY-BRANCH-END — slice 70-X.13 (Wave 4). Delete to function close.
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
                  draggedCardId={draggedCardId}
                  onObjectClick={onObjectClick}
                  onPointerDown={onPointerDown}
                  onReorder={onReorder}
                  tooltip={cardTooltip(card)}
                  targetableForDialog={
                    dialogActive &&
                    dialogState.eligibleCardIds.has(card.id)
                  }
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
  draggedCardId,
  onObjectClick,
  onPointerDown,
  onReorder,
  tooltip,
  targetableForDialog,
}: {
  card: WebCardView;
  index: number;
  total: number;
  canAct: boolean;
  isDragging: boolean;
  /**
   * Bug fix (2026-05-02) — id of the card currently in flight
   * for drag-to-play / drag-to-reorder. Reorder fires when the
   * user releases the pointer on a DIFFERENT hand card while a
   * drag is in progress, regardless of priority.
   */
  draggedCardId: string | null;
  onObjectClick: (id: string) => void;
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  onReorder: (fromId: string, toId: string) => void;
  tooltip: string;
  /**
   * Slice 70-Y.1 — when true, this hand card is in the engine's
   * eligible-cards set for an active gameTarget (discard, return-from-
   * hand, reveal). The card pulses purple via the
   * card-targeted-pulse keyframe, and clicks during this state route
   * through clickRouter target mode to dispatch the dialog response
   * (not the default cast path).
   */
  targetableForDialog: boolean;
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
          // Bug fix (2026-05-02) — replace disabled={!canAct} with
          // aria-disabled. The native disabled attribute fully
          // suppresses pointer/click events, which prevented the user
          // from drag-reordering their hand on opponents' turns
          // ("frozen-when-not-priority" complaint). Reorder is a
          // personal layout choice, not a game action — it should
          // work whenever, the same way you can rearrange real cards
          // in your hand at any time. Cast clicks remain gated on
          // canAct internally below; aria-disabled keeps the SR
          // announcement intact.
          aria-disabled={!canAct || undefined}
          onClick={() => {
            if (!canAct) return;
            onObjectClick(card.id);
          }}
          onPointerDown={(ev) => onPointerDown(card.id, ev)}
          onPointerUp={() => {
            if (draggedCardId && draggedCardId !== card.id) {
              onReorder(draggedCardId, card.id);
            }
          }}
          onMouseEnter={() => setLifted(true)}
          onMouseLeave={() => setLifted(false)}
          onFocus={() => setLifted(true)}
          onBlur={() => setLifted(false)}
          title={tooltip}
          className={
            'select-none ' +
            // Slice 70-X.5 (user feedback 2026-04-30) — hand cards
            // stay fully opaque even when !canAct. The cursor change
            // (grab → default) + the tooltip ("Waiting for opponent"
            // / "Wait for your turn") already convey the disabled
            // state; the prior opacity-70 made the entire hand look
            // washed-out / see-through during opponents' turns,
            // which obscured card art and read as a rendering bug.
            // Drag opacity-30 stays — that state is "card lifted
            // off, in flight" and benefits from translucency.
            (canAct
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default') +
            (isDragging ? ' opacity-30' : '')
          }
        >
          <motion.div
            layoutId={layoutId}
            data-layout-id={layoutId}
            transition={{ layout: slow(LAYOUT_GLIDE) }}
          >
            <HandCardFace
              card={card}
              targetableForDialog={targetableForDialog}
            />
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
function HandCardFace({
  card,
  targetableForDialog,
}: {
  card: WebCardView;
  targetableForDialog?: boolean;
}) {
  return (
    <CardFace
      card={card}
      size="hand"
      targetableForDialog={targetableForDialog}
    />
  );
}

/**
 * Slice 70-Z polish (user direction 2026-04-30) — local command
 * zone. Renders the local player's commander to the LEFT of the
 * hand fan at the same baseline, persistent regardless of zone.
 * The commander art comes from a stub WebCardView synthesized from
 * the player's commandList entry; CardFace's universal commander
 * halo (commanderColorsForCard hook) paints the color-identity
 * bloom behind it automatically.
 *
 * <p>Wraps in HoverCardDetail so the player can hover and inspect
 * the commander's rules text — same affordance as opponent
 * commander labels (slice 70-Z polish for cross-pod intel).
 */
function CommandZoneSlot({
  player,
  canAct,
  onObjectClick,
}: {
  player: WebPlayerView;
  canAct: boolean;
  onObjectClick: (id: string) => void;
}) {
  const commanders = filterCommanders(player.commandList);
  if (commanders.length === 0) return null;
  return (
    <div
      data-testid="local-command-zone"
      // Anchored to MyHand's bottom-left. The hand-fan container
      // above already has pl-[140px] reserved on its inner row so
      // the fan doesn't overlap this slot.
      className="absolute left-3 bottom-0 z-10 flex gap-2 items-end pointer-events-auto"
    >
      {commanders.map((entry) => (
        <CommandZoneCard
          key={entry.id}
          entry={entry}
          ownerPlayerId={player.playerId}
          canAct={canAct}
          onObjectClick={onObjectClick}
        />
      ))}
    </div>
  );
}

function CommandZoneCard({
  entry,
  ownerPlayerId,
  canAct,
  onObjectClick,
}: {
  entry: WebPlayerView['commandList'][number];
  ownerPlayerId: string;
  canAct: boolean;
  onObjectClick: (id: string) => void;
}) {
  // Synthesize a minimal WebCardView from the commandList entry so
  // CardFace can render the standard hand-size variant. Slice
  // 70-X.2 — use entry.cardNumber (collector-number string from
  // schema 1.24) for the Scryfall lookup; fall back to imageNumber
  // for 1.23-or-older servers during rolling upgrade. xmage's
  // MageObject.imageNumber defaults to 0 for ordinary cards, so
  // imageNumber alone yielded broken URLs like /cards/woc/0 → 404.
  const collectorNumber =
    entry.cardNumber || (entry.imageNumber ? String(entry.imageNumber) : '');
  const stub: WebCardView = {
    id: entry.id,
    cardId: entry.id,
    name: entry.name,
    displayName: entry.name,
    expansionSetCode: entry.expansionSetCode,
    cardNumber: collectorNumber,
    manaCost: '',
    manaValue: 0,
    typeLine: '',
    supertypes: [],
    types: ['CREATURE'],
    subtypes: [],
    colors: [],
    rarity: '',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [...entry.rules],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    sourceLabel: '',
  };
  // Slice 70-X.11 (user feedback 2026-04-30) — wire the visual
  // command-zone slot to xmage's actual command zone. Click → dispatch
  // sendObjectClick(commander.id) via the same click router as a
  // hand-card cast. Engine's HumanPlayer.priorityPlay evaluates
  // cast-from-command-zone (with auto +2 mana commander tax) and
  // either begins the cast flow OR sends a gameError if it's not a
  // legal moment. The "send to command zone vs graveyard on death"
  // replacement effect is automatic upstream — fires its own
  // gameAsk dialog when the commander would die.
  return (
    <HoverCardDetail card={stub}>
      <button
        type="button"
        data-testid="command-zone-card"
        data-player-id={ownerPlayerId}
        data-card-id={entry.id}
        disabled={!canAct}
        onClick={() => onObjectClick(entry.id)}
        title={
          canAct
            ? `${entry.name} — click to cast from command zone`
            : entry.name
        }
        className={
          'block ' +
          (canAct ? 'cursor-pointer' : 'cursor-default')
        }
      >
        <CardFace card={stub} size="hand" />
      </button>
    </HoverCardDetail>
  );
}
