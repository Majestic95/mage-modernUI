/**
 * Slice 70-Z.2 — gameDelta.diffGameViews coverage. Each test
 * constructs a (prev, next) snapshot pair plus an expected GameEvent
 * list, then asserts strict equality. The diff is the seam every
 * later animation slice depends on; misclassified events at this
 * layer cascade into wrong visuals. Counterspell fixtures defend
 * the user-confirmed permanents-only heuristic — the instant case
 * MUST NOT emit `countered`.
 */
import { describe, expect, it } from 'vitest';
import { diffGameViews, type GameEvent } from './gameDelta';
import {
  webCardViewSchema,
  webPermanentViewSchema,
  webPlayerViewSchema,
  webGameViewSchema,
  type WebCardView,
  type WebGameView,
  type WebPermanentView,
  type WebPlayerView,
} from '../api/schemas';

// ----- fixture builders ---------------------------------------------------

let nextCardSeq = 0;
function freshCardId(): string {
  nextCardSeq += 1;
  // Deterministic per-test cardIds keep failures readable; format
  // mimics a UUID so any future stricter validation still parses.
  const n = String(nextCardSeq).padStart(12, '0');
  return `00000000-0000-0000-0000-${n}`;
}

interface CardSpec {
  cardId?: string;
  name?: string;
  types?: string[];
  manaValue?: number;
  colors?: string[];
}

function makeCard(spec: CardSpec = {}): WebCardView {
  return webCardViewSchema.parse({
    id: spec.cardId ?? freshCardId(),
    cardId: spec.cardId ?? freshCardId(),
    name: spec.name ?? 'Test Card',
    displayName: spec.name ?? 'Test Card',
    expansionSetCode: 'TST',
    cardNumber: '1',
    manaCost: '',
    manaValue: spec.manaValue ?? 0,
    typeLine: (spec.types ?? ['CREATURE']).join(' '),
    supertypes: [],
    types: spec.types ?? ['CREATURE'],
    subtypes: [],
    colors: spec.colors ?? [],
    rarity: 'COMMON',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

function makePerm(card: WebCardView): WebPermanentView {
  return webPermanentViewSchema.parse({
    card,
    controllerName: 'alice',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
  });
}

interface PlayerSpec {
  name?: string;
  battlefield?: WebPermanentView[];
  graveyard?: WebCardView[];
  exile?: WebCardView[];
  commander?: { name: string; cardId: string };
}

function makePlayer(seat: number, spec: PlayerSpec = {}): WebPlayerView {
  const battlefield: Record<string, WebPermanentView> = {};
  for (const p of spec.battlefield ?? []) {
    battlefield[p.card.id] = p;
  }
  const graveyard: Record<string, WebCardView> = {};
  for (const c of spec.graveyard ?? []) {
    graveyard[c.id] = c;
  }
  const exile: Record<string, WebCardView> = {};
  for (const c of spec.exile ?? []) {
    exile[c.id] = c;
  }
  return webPlayerViewSchema.parse({
    playerId: `seat-${seat}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,
    name: spec.name ?? `seat${seat}`,
    life: 40,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
    handCount: 0,
    graveyard,
    exile,
    sideboard: {},
    battlefield,
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: spec.commander
      ? [
          {
            id: spec.commander.cardId,
            kind: 'commander',
            name: spec.commander.name,
            expansionSetCode: 'TST',
            imageFileName: '',
            imageNumber: 0,
            rules: [],
          },
        ]
      : [],
  });
}

interface GVSpec {
  myHand?: WebCardView[];
  stack?: WebCardView[];
  players: WebPlayerView[];
  /**
   * Optional override for the active player's name. Defaults to the
   * first player's name so the local-cast tests (seat 0) get a clean
   * activeSeat = 0 derivation. Opponent-cast fixtures override this.
   */
  activePlayerName?: string;
}

function makeGameView(spec: GVSpec): WebGameView {
  const myHand: Record<string, WebCardView> = {};
  for (const c of spec.myHand ?? []) myHand[c.id] = c;
  const stack: Record<string, WebCardView> = {};
  for (const c of spec.stack ?? []) stack[c.id] = c;
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: spec.activePlayerName ?? spec.players[0]?.name ?? '',
    priorityPlayerName: spec.activePlayerName ?? spec.players[0]?.name ?? '',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: spec.players[0]?.playerId ?? '',
    myHand,
    stack,
    combat: [],
    players: spec.players,
  });
}

// ----- tests --------------------------------------------------------------

describe('diffGameViews — null prev (game start)', () => {
  it('emits nothing on first snapshot', () => {
    const next = makeGameView({ players: [makePlayer(0)] });
    expect(diffGameViews(null, next)).toEqual([]);
  });
});

describe('diffGameViews — cast events', () => {
  it('emits a non-cinematic cast for an ordinary CMC-3 sorcery from hand', () => {
    const card = makeCard({
      name: 'Anticipate',
      types: ['INSTANT'],
      manaValue: 2,
      colors: ['U'],
    });
    const prev = makeGameView({
      myHand: [card],
      players: [makePlayer(0)],
    });
    const next = makeGameView({
      stack: [card],
      players: [makePlayer(0)],
    });
    const events = diffGameViews(prev, next);
    expect(events).toEqual<GameEvent[]>([
      {
        kind: 'cast',
        cardId: card.cardId,
        cinematic: false,
        colors: ['U'],
        from: 'hand',
        ownerSeat: 0,
      },
    ]);
  });

  it('emits a cinematic cast for a planeswalker', () => {
    const card = makeCard({
      name: 'Liliana, Dreadhorde General',
      types: ['PLANESWALKER'],
      manaValue: 6,
      colors: ['B'],
    });
    const prev = makeGameView({
      myHand: [card],
      players: [makePlayer(0)],
    });
    const next = makeGameView({
      stack: [card],
      players: [makePlayer(0)],
    });
    const evts = diffGameViews(prev, next);
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ kind: 'cast', cinematic: true });
  });

  it('emits a cinematic cast for any spell with manaValue ≥ 7', () => {
    const card = makeCard({
      name: 'Expropriate',
      types: ['SORCERY'],
      manaValue: 7,
      colors: ['U'],
    });
    const prev = makeGameView({
      myHand: [card],
      players: [makePlayer(0)],
    });
    const next = makeGameView({
      stack: [card],
      players: [makePlayer(0)],
    });
    const evts = diffGameViews(prev, next);
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({ kind: 'cast', cinematic: true });
  });

  it('emits a cinematic cast for the commander even at low CMC', () => {
    const card = makeCard({
      name: 'Edric, Spymaster of Trest',
      types: ['CREATURE'],
      manaValue: 3,
      colors: ['G', 'U'],
    });
    const prev = makeGameView({
      myHand: [card],
      players: [
        makePlayer(0, {
          commander: { name: card.name, cardId: card.cardId },
        }),
      ],
    });
    const next = makeGameView({
      stack: [card],
      players: [
        makePlayer(0, {
          commander: { name: card.name, cardId: card.cardId },
        }),
      ],
    });
    const evts = diffGameViews(prev, next);
    expect(evts).toEqual<GameEvent[]>([
      {
        kind: 'cast',
        cardId: card.cardId,
        cinematic: true,
        colors: ['G', 'U'],
        from: 'hand',
        ownerSeat: 0,
      },
    ]);
  });

  it('marks an opponent-cast spell as from="unknown" (their hand is opaque)', () => {
    const card = makeCard({
      name: 'Counterspell',
      types: ['INSTANT'],
      manaValue: 2,
      colors: ['U'],
    });
    // Card materializes on the stack with no prior known zone — that's
    // an opponent casting from their hand. Diff should still emit
    // 'cast' but with from='unknown' and ownerSeat = the active
    // player's seat (the only signal we have for opponent attribution).
    const prev = makeGameView({
      players: [makePlayer(0, { name: 'alice' }), makePlayer(1, { name: 'bob' })],
      activePlayerName: 'bob',
    });
    const next = makeGameView({
      stack: [card],
      players: [makePlayer(0, { name: 'alice' }), makePlayer(1, { name: 'bob' })],
      activePlayerName: 'bob',
    });
    const evts = diffGameViews(prev, next);
    expect(evts).toEqual<GameEvent[]>([
      {
        kind: 'cast',
        cardId: card.cardId,
        cinematic: false,
        colors: ['U'],
        from: 'unknown',
        ownerSeat: 1,
      },
    ]);
  });
});

describe('diffGameViews — resolution / counter', () => {
  it('emits resolve_to_board when a permanent leaves stack and enters battlefield', () => {
    const card = makeCard({
      name: 'Bear Cub',
      types: ['CREATURE'],
      manaValue: 2,
    });
    const prev = makeGameView({
      stack: [card],
      players: [makePlayer(0)],
    });
    const next = makeGameView({
      players: [makePlayer(0, { battlefield: [makePerm(card)] })],
    });
    expect(diffGameViews(prev, next)).toEqual<GameEvent[]>([
      { kind: 'resolve_to_board', cardId: card.cardId, ownerSeat: 0 },
    ]);
  });

  it('emits resolve_to_grave (NOT countered) for a resolved instant', () => {
    // Slice 70-Z.2 critic-prevented bug: instants resolving normally
    // look identical to instants countered. User direction: do not
    // emit `countered` for non-permanents — the heuristic is unsafe.
    const card = makeCard({
      name: 'Lightning Bolt',
      types: ['INSTANT'],
      manaValue: 1,
      colors: ['R'],
    });
    const prev = makeGameView({
      stack: [card],
      players: [makePlayer(0)],
    });
    const next = makeGameView({
      players: [makePlayer(0, { graveyard: [card] })],
    });
    const evts = diffGameViews(prev, next);
    expect(evts).toEqual<GameEvent[]>([
      { kind: 'resolve_to_grave', cardId: card.cardId, ownerSeat: 0 },
    ]);
    // Defense-in-depth: assert no `countered` event ever leaked.
    expect(evts.some((e) => e.kind === 'countered')).toBe(false);
  });

  it('emits countered for a permanent that leaves stack without entering battlefield', () => {
    const card = makeCard({
      name: 'Grave Titan',
      types: ['CREATURE'],
      manaValue: 6,
    });
    const prev = makeGameView({
      stack: [card],
      players: [makePlayer(0)],
    });
    const next = makeGameView({
      // Counterspell sends the spell to its OWNER's graveyard; for
      // the diff, the discriminator is "left stack, did not enter
      // battlefield" — graveyard owner is incidental.
      players: [makePlayer(0, { graveyard: [card] })],
    });
    expect(diffGameViews(prev, next)).toEqual<GameEvent[]>([
      { kind: 'countered', cardId: card.cardId },
    ]);
  });
});

describe('diffGameViews — battlefield destruction', () => {
  it('emits creature_died when a creature leaves battlefield to graveyard', () => {
    const card = makeCard({ name: 'Bear Cub', types: ['CREATURE'] });
    const perm = makePerm(card);
    const prev = makeGameView({
      players: [makePlayer(0, { battlefield: [perm] })],
    });
    const next = makeGameView({
      players: [makePlayer(0, { graveyard: [card] })],
    });
    expect(diffGameViews(prev, next)).toEqual<GameEvent[]>([
      { kind: 'creature_died', cardId: card.cardId, ownerSeat: 0 },
    ]);
  });

  it('does NOT emit creature_died for a non-creature destruction', () => {
    // An artifact destroyed by Naturalize goes to graveyard but
    // doesn't get the dust crumple per user direction (creature-
    // specific). It still glides via the standard B path.
    const card = makeCard({ name: 'Sol Ring', types: ['ARTIFACT'] });
    const perm = makePerm(card);
    const prev = makeGameView({
      players: [makePlayer(0, { battlefield: [perm] })],
    });
    const next = makeGameView({
      players: [makePlayer(0, { graveyard: [card] })],
    });
    expect(diffGameViews(prev, next)).toEqual([]);
  });

  it('emits permanent_exiled for any permanent type going to exile', () => {
    const card = makeCard({ name: 'Sol Ring', types: ['ARTIFACT'] });
    const perm = makePerm(card);
    const prev = makeGameView({
      players: [makePlayer(0, { battlefield: [perm] })],
    });
    const next = makeGameView({
      players: [makePlayer(0, { exile: [card] })],
    });
    expect(diffGameViews(prev, next)).toEqual<GameEvent[]>([
      { kind: 'permanent_exiled', cardId: card.cardId, ownerSeat: 0 },
    ]);
  });
});

describe('diffGameViews — board wipe synthesis', () => {
  it('synthesizes board_wipe when ≥2 permanents are destroyed in one snapshot', () => {
    const c1 = makeCard({ name: 'Bear Cub', types: ['CREATURE'] });
    const c2 = makeCard({ name: 'Grizzly Bears', types: ['CREATURE'] });
    const c3 = makeCard({ name: 'Wolverine', types: ['CREATURE'] });
    const prev = makeGameView({
      players: [
        makePlayer(0, { battlefield: [makePerm(c1), makePerm(c2)] }),
        makePlayer(1, { battlefield: [makePerm(c3)] }),
      ],
    });
    const next = makeGameView({
      players: [
        makePlayer(0, { graveyard: [c1, c2] }),
        makePlayer(1, { graveyard: [c3] }),
      ],
    });
    const evts = diffGameViews(prev, next);
    const wipe = evts.find((e) => e.kind === 'board_wipe');
    expect(wipe).toBeTruthy();
    if (wipe?.kind !== 'board_wipe') return;
    expect(wipe.cardIds).toHaveLength(3);
    // Epicenter = seat with most destructions (seat 0: 2; seat 1: 1).
    expect(wipe.epicenterSeat).toBe(0);
    expect(evts.filter((e) => e.kind === 'creature_died')).toHaveLength(3);
  });

  it('does NOT synthesize board_wipe for a single death', () => {
    const c1 = makeCard({ name: 'Bear Cub', types: ['CREATURE'] });
    const prev = makeGameView({
      players: [makePlayer(0, { battlefield: [makePerm(c1)] })],
    });
    const next = makeGameView({
      players: [makePlayer(0, { graveyard: [c1] })],
    });
    const evts = diffGameViews(prev, next);
    expect(evts.some((e) => e.kind === 'board_wipe')).toBe(false);
    expect(evts.filter((e) => e.kind === 'creature_died')).toHaveLength(1);
  });

  it('mixes creature_died and permanent_exiled into the same wipe', () => {
    // A spell like Farewell exiles permanents AND triggers death-
    // adjacent effects. The synthesized wipe should bundle both event
    // streams since the visual ripple is per-spell, not per-zone.
    const cr = makeCard({ name: 'Bear', types: ['CREATURE'] });
    const ar = makeCard({ name: 'Sol Ring', types: ['ARTIFACT'] });
    const en = makeCard({ name: 'Rhystic Study', types: ['ENCHANTMENT'] });
    const prev = makeGameView({
      players: [
        makePlayer(0, {
          battlefield: [makePerm(cr), makePerm(ar), makePerm(en)],
        }),
      ],
    });
    const next = makeGameView({
      players: [
        makePlayer(0, { graveyard: [cr], exile: [ar, en] }),
      ],
    });
    const evts = diffGameViews(prev, next);
    expect(evts.some((e) => e.kind === 'board_wipe')).toBe(true);
    expect(evts.filter((e) => e.kind === 'creature_died')).toHaveLength(1);
    expect(evts.filter((e) => e.kind === 'permanent_exiled')).toHaveLength(2);
  });
});

describe('diffGameViews — commander returned', () => {
  it('emits commander_returned when a commander leaves battlefield without entering grave/exile', () => {
    const cardId = freshCardId();
    const card = makeCard({
      cardId,
      name: 'Atraxa, Praetors\' Voice',
      types: ['CREATURE'],
    });
    const perm = makePerm(card);
    const prev = makeGameView({
      players: [
        makePlayer(0, {
          battlefield: [perm],
          commander: { name: card.name, cardId: card.cardId },
        }),
      ],
    });
    const next = makeGameView({
      // Card no longer on battlefield. Not in graveyard or exile —
      // engine moved it back to command zone. commandList in `next`
      // still names the commander (it always does).
      players: [
        makePlayer(0, {
          commander: { name: card.name, cardId: card.cardId },
        }),
      ],
    });
    expect(diffGameViews(prev, next)).toEqual<GameEvent[]>([
      { kind: 'commander_returned', cardId: card.cardId, ownerSeat: 0 },
    ]);
  });

  it('does NOT emit commander_returned for a non-commander permanent disappearing (token)', () => {
    // A token leaving the battlefield ceases to exist (Magic SBA
    // 704.5d). It's not in any zone next snapshot. The diff should
    // emit nothing — commander_returned is reserved for the actual
    // commander redirect.
    const card = makeCard({
      name: 'Saproling token',
      types: ['CREATURE'],
    });
    const perm = makePerm(card);
    const prev = makeGameView({
      players: [makePlayer(0, { battlefield: [perm] })],
    });
    const next = makeGameView({ players: [makePlayer(0)] });
    expect(diffGameViews(prev, next)).toEqual([]);
  });
});

describe('diffGameViews — order + deduplication', () => {
  it('emits no events when snapshots are equivalent', () => {
    const card = makeCard({ name: 'Forest', types: ['LAND'] });
    const players = [makePlayer(0, { battlefield: [makePerm(card)] })];
    const prev = makeGameView({ players });
    const next = makeGameView({ players });
    expect(diffGameViews(prev, next)).toEqual([]);
  });
});
