import type { WebGameView, WebPlayerView, WebCardView } from '../api/schemas';

/**
 * Slice 70-Z.2 — pure diff between successive {@link WebGameView}
 * snapshots. The wire delivers full snapshots only (no incremental
 * events), so the animation system reconstructs gameplay events
 * client-side: cast / resolve / counter / die / exile / board wipe /
 * commander return.
 *
 * <p>Every event keys off the stable {@code WebCardView.cardId}
 * (slice 52a / schema 1.19) which is the same UUID across hand,
 * stack, battlefield, graveyard, exile, and the command zone. The
 * `id` field differs only on the stack zone; we never use it for
 * tracking.
 *
 * <p>This module is React-free — pure function plus type defs.
 * Animation hooks call it from a {@code useEffect} keyed on the new
 * gameView reference (see {@link useGameDelta}).
 *
 * <p><b>Counter detection caveat (user-confirmed 2026-04-30):</b>
 * The wire does NOT flag countered vs. resolved. For permanent-type
 * spells the heuristic "left stack but did not enter battlefield" is
 * 100% accurate (permanents always enter the battlefield on
 * successful resolution). For instants/sorceries both "resolved
 * normally" and "countered" land in the graveyard, so the diff
 * cannot tell them apart and emits {@link GameEvent.kind} =
 * {@code 'resolve_to_grave'} for either case. Documented limitation.
 */

/**
 * Card type strings as emitted by the upstream serializer. All
 * UPPERCASE per existing fixtures (see api/schemas.test.ts:265 +
 * dev/demoFixtures.ts:136). Matching is exact-case.
 */
const PERMANENT_TYPES = [
  'CREATURE',
  'PLANESWALKER',
  'ARTIFACT',
  'ENCHANTMENT',
  'BATTLE',
  'LAND',
  'TRIBAL',
] as const;

const NONPERMANENT_TYPES = ['INSTANT', 'SORCERY'] as const;

function isPermanent(card: WebCardView): boolean {
  return card.types.some((t) =>
    (PERMANENT_TYPES as readonly string[]).includes(t),
  );
}

function isInstantOrSorcery(card: WebCardView): boolean {
  return card.types.some((t) =>
    (NONPERMANENT_TYPES as readonly string[]).includes(t),
  );
}

/**
 * Cinematic threshold per user direction (slice 70-Z.2 plan):
 * commander cast OR planeswalker cast OR manaValue ≥ 7.
 */
function isCinematicCast(
  card: WebCardView,
  isCommander: boolean,
): boolean {
  if (isCommander) return true;
  if (card.types.includes('PLANESWALKER')) return true;
  if (card.manaValue >= 7) return true;
  return false;
}

/**
 * Cross-reference the cast cardId against every player's commandList.
 * A commander is identified by {@code commandList[].kind === 'commander'}
 * AND a name match (commandList carries the printed card name; the
 * cast WebCardView carries the same name). Returns true if THIS card
 * is the commander of any player at this snapshot.
 *
 * <p><b>Mirror-match note:</b> in 1v1 commander mirror matches (both
 * players play the same legend), name-match returns true regardless
 * of which seat actually controls the cast. That is the intended
 * behavior — both players' casts of the mirror commander earn the
 * cinematic flair; the {@code ownerSeat} field on the {@code cast}
 * event disambiguates downstream rendering anchors.
 */
function isCardCommander(
  card: WebCardView,
  players: readonly WebPlayerView[],
): boolean {
  for (const p of players) {
    for (const obj of p.commandList) {
      if (obj.kind === 'commander' && obj.name === card.name) return true;
    }
  }
  return false;
}

/**
 * Where a given cardId currently lives, for diff purposes. We track
 * one zone per cardId per snapshot — if a card somehow appears in
 * two zones at once (engine bug or transient), the last-seen-wins
 * order matches the deterministic iteration here.
 */
type ZoneLocation =
  | { zone: 'stack' }
  | { zone: 'battlefield'; ownerSeat: number }
  | { zone: 'graveyard'; ownerSeat: number }
  | { zone: 'exile'; ownerSeat: number }
  | { zone: 'hand' }
  | { zone: 'commandzone'; ownerSeat: number };

interface SnapshotIndex {
  /** cardId → zone location at this snapshot. */
  byCardId: Map<string, ZoneLocation>;
  /** cardId → the card payload (for type / manaValue lookups). */
  cards: Map<string, WebCardView>;
  /** cardId → owner seat, where determinable. -1 if not. */
  owners: Map<string, number>;
}

function indexSnapshot(gv: WebGameView): SnapshotIndex {
  const byCardId = new Map<string, ZoneLocation>();
  const cards = new Map<string, WebCardView>();
  const owners = new Map<string, number>();

  // Stack — keyed by stack-id which differs from cardId in this zone.
  // Iterate values to read each card's cardId.
  for (const card of Object.values(gv.stack)) {
    if (!card.cardId) continue;
    byCardId.set(card.cardId, { zone: 'stack' });
    cards.set(card.cardId, card);
  }

  // Per-player zones — battlefield / graveyard / exile / commandList.
  gv.players.forEach((p, seat) => {
    for (const perm of Object.values(p.battlefield)) {
      const id = perm.card.cardId;
      if (!id) continue;
      byCardId.set(id, { zone: 'battlefield', ownerSeat: seat });
      cards.set(id, perm.card);
      owners.set(id, seat);
    }
    for (const card of Object.values(p.graveyard)) {
      if (!card.cardId) continue;
      byCardId.set(card.cardId, { zone: 'graveyard', ownerSeat: seat });
      cards.set(card.cardId, card);
      owners.set(card.cardId, seat);
    }
    for (const card of Object.values(p.exile)) {
      if (!card.cardId) continue;
      byCardId.set(card.cardId, { zone: 'exile', ownerSeat: seat });
      cards.set(card.cardId, card);
      owners.set(card.cardId, seat);
    }
    // commandList is a different shape (WebCommandObjectView, not
    // WebCardView) and uses `id`, not `cardId`. We do NOT track its
    // entries in byCardId because the id space is disjoint from cards.
    // Instead, when a card leaves the battlefield and re-enters
    // commandList, we rely on isCardCommander() at diff time.
  });

  // Local hand — only the current player's hand is enumerable
  // (others expose only handCount). We index it so cast events can
  // be enriched with from='hand'. Opponents' casts get from='unknown'.
  for (const card of Object.values(gv.myHand)) {
    if (!card.cardId) continue;
    byCardId.set(card.cardId, { zone: 'hand' });
    cards.set(card.cardId, card);
  }

  return { byCardId, cards, owners };
}

/**
 * Discriminated union of gameplay events the diff emits. Consumers
 * (CardAnimationLayer in slice 70-Z.3+) subscribe by kind.
 *
 * <p>{@code resolve_to_grave} fires for instants/sorceries that left
 * the stack (resolved or countered — see counter caveat above).
 * {@code countered} fires only for permanent-type spells where the
 * heuristic is unambiguous.
 */
export type GameEvent =
  | {
      kind: 'cast';
      cardId: string;
      cinematic: boolean;
      colors: readonly string[];
      from: 'hand' | 'unknown';
      /**
       * Seat of the player casting the spell. -1 when undeterminable
       * (rare — only when the snapshot has no activePlayerName match).
       * Slice 70-Z.3 ribbon trail uses this to anchor opponent-cast
       * trajectories to the correct pod's portrait rather than the
       * local hand. Slice 70-Z.2 critic UI/UX-I3 — added pre-emptively
       * so the cast event shape doesn't churn between slices.
       */
      ownerSeat: number;
    }
  | { kind: 'resolve_to_board'; cardId: string; ownerSeat: number }
  | { kind: 'resolve_to_grave'; cardId: string; ownerSeat: number }
  | { kind: 'countered'; cardId: string }
  | { kind: 'creature_died'; cardId: string; ownerSeat: number }
  | { kind: 'permanent_exiled'; cardId: string; ownerSeat: number }
  | {
      kind: 'board_wipe';
      cardIds: readonly string[];
      epicenterSeat: number;
    }
  | { kind: 'commander_returned'; cardId: string; ownerSeat: number };

/**
 * Compute the event list between two snapshots. {@code prev} is null
 * on game-start (first snapshot — emits nothing; the initial state
 * is the baseline). Order of emitted events: per-card transitions
 * first (cast → resolve → die / exile / counter / commander_returned),
 * then derived events (board_wipe synthesized last from the
 * destruction events).
 */
export function diffGameViews(
  prev: WebGameView | null,
  next: WebGameView,
): GameEvent[] {
  if (prev === null) return [];
  const before = indexSnapshot(prev);
  const after = indexSnapshot(next);

  // Resolve activePlayer's seat once for opponent-cast attribution.
  // The activePlayerName in the snapshot is the only signal we have
  // for which seat is doing things this priority window; -1 means
  // we couldn't match it (defensive fallback).
  const activeSeat = next.players.findIndex(
    (p) => p.name === next.activePlayerName,
  );

  const events: GameEvent[] = [];
  const destroyEvents: (
    | { kind: 'creature_died'; cardId: string; ownerSeat: number }
    | { kind: 'permanent_exiled'; cardId: string; ownerSeat: number }
  )[] = [];

  // Walk every cardId observed in either snapshot. Use the union so
  // a card that JUST appeared (cast from off-screen, e.g. an
  // opponent's spell cast directly without a hand we can see) still
  // gets a 'cast' event.
  const allIds = new Set<string>([
    ...before.byCardId.keys(),
    ...after.byCardId.keys(),
  ]);

  for (const cardId of allIds) {
    const wasIn = before.byCardId.get(cardId);
    const isIn = after.byCardId.get(cardId);

    // Card disappeared from all observed zones. For permanents
    // (commanders specifically) this can mean "went to command zone"
    // — commandList is not indexed by cardId, so we check explicitly.
    if (wasIn && !isIn) {
      // Was on battlefield, now nowhere we can see → check command
      // zone via the snapshot's commandList. Match by name (the only
      // discriminator that crosses the battlefield/commandList split).
      if (wasIn.zone === 'battlefield') {
        const card = before.cards.get(cardId);
        if (card && isCardCommander(card, next.players)) {
          events.push({
            kind: 'commander_returned',
            cardId,
            ownerSeat: wasIn.ownerSeat,
          });
        }
      }
      continue;
    }

    // Card appeared from nowhere we previously tracked — most often
    // 'cast' (entered stack). Less often a card materializing
    // directly on the battlefield via a token-creation effect; that
    // path doesn't have a stack moment so 'cast' is the wrong event.
    if (!wasIn && isIn) {
      if (isIn.zone === 'stack') {
        const card = after.cards.get(cardId);
        if (!card) continue;
        const cinematic = isCinematicCast(
          card,
          isCardCommander(card, next.players),
        );
        events.push({
          kind: 'cast',
          cardId,
          cinematic,
          colors: card.colors,
          from: 'unknown',
          ownerSeat: activeSeat,
        });
      }
      continue;
    }

    if (!wasIn || !isIn) continue;

    // Hand → stack. Local-player cast — same as 'unknown' source but
    // we know it came from our hand. Seat = local player (the only
    // hand we can see). Find by myPlayerId match.
    if (wasIn.zone === 'hand' && isIn.zone === 'stack') {
      const card = after.cards.get(cardId);
      if (!card) continue;
      const cinematic = isCinematicCast(
        card,
        isCardCommander(card, next.players),
      );
      const localSeat = next.players.findIndex(
        (p) => p.playerId === next.myPlayerId,
      );
      events.push({
        kind: 'cast',
        cardId,
        cinematic,
        colors: card.colors,
        from: 'hand',
        ownerSeat: localSeat,
      });
      continue;
    }

    // Stack → battlefield. Permanent-type spell resolving onto the
    // battlefield. Always emit resolve_to_board regardless of which
    // player owns the new permanent.
    if (wasIn.zone === 'stack' && isIn.zone === 'battlefield') {
      events.push({
        kind: 'resolve_to_board',
        cardId,
        ownerSeat: isIn.ownerSeat,
      });
      continue;
    }

    // Stack → graveyard. Two cases:
    //  - Instant/sorcery resolved → resolve_to_grave (B glide)
    //  - Permanent countered → countered (cinematic-A then C dust)
    // The discriminator is the card's type.
    if (wasIn.zone === 'stack' && isIn.zone === 'graveyard') {
      const card = after.cards.get(cardId) ?? before.cards.get(cardId);
      if (!card) continue;
      if (isPermanent(card) && !isInstantOrSorcery(card)) {
        events.push({ kind: 'countered', cardId });
      } else {
        events.push({
          kind: 'resolve_to_grave',
          cardId,
          ownerSeat: isIn.ownerSeat,
        });
      }
      continue;
    }

    // Battlefield → graveyard. Death (creature) or destruction (any
    // other permanent). Currently we only emit the dust crumple for
    // creatures per user direction; non-creature destructions snap to
    // graveyard via the standard B glide. Future: extend palette
    // for artifact/enchantment destructions if user requests.
    if (wasIn.zone === 'battlefield' && isIn.zone === 'graveyard') {
      const card = before.cards.get(cardId) ?? after.cards.get(cardId);
      if (!card) continue;
      if (card.types.includes('CREATURE')) {
        const evt = {
          kind: 'creature_died' as const,
          cardId,
          ownerSeat: isIn.ownerSeat,
        };
        events.push(evt);
        destroyEvents.push(evt);
      }
      continue;
    }

    // Battlefield → exile. Fire bright dissolve for any permanent
    // type (creatures, artifacts, enchantments — all use the same
    // exile palette per the catalog).
    if (wasIn.zone === 'battlefield' && isIn.zone === 'exile') {
      const evt = {
        kind: 'permanent_exiled' as const,
        cardId,
        ownerSeat: isIn.ownerSeat,
      };
      events.push(evt);
      destroyEvents.push(evt);
      continue;
    }
  }

  // Synthesize board_wipe when ≥2 destruction events fire in one
  // snapshot. Epicenter seat = the seat with the most destructions
  // (ties broken by lowest seat index — explicit sort, not iteration-
  // order-dependent, per slice 70-Z.2 critic UI/UX-I4).
  if (destroyEvents.length >= 2) {
    const seatCounts = new Map<number, number>();
    for (const e of destroyEvents) {
      seatCounts.set(e.ownerSeat, (seatCounts.get(e.ownerSeat) ?? 0) + 1);
    }
    const ranked = Array.from(seatCounts.entries()).sort(
      ([seatA, countA], [seatB, countB]) =>
        countB - countA || seatA - seatB,
    );
    const epicenterSeat = ranked[0]?.[0] ?? -1;
    events.push({
      kind: 'board_wipe',
      cardIds: destroyEvents.map((e) => e.cardId),
      epicenterSeat,
    });
  }

  return events;
}

/**
 * Slice 70-Z.2 export — the type union for consumers. Exported
 * separately so tests + animation layer + event bus can share one
 * type without circular imports.
 */
export type GameEventKind = GameEvent['kind'];

/**
 * Module-internal helpers exposed for unit testing only. Not part
 * of the public API.
 */
export const __testing = {
  isPermanent,
  isInstantOrSorcery,
  isCinematicCast,
  isCardCommander,
  indexSnapshot,
};
