/**
 * Bundle 5 / Slice 5-A — coverage for {@link diffDamageEvents} +
 * the {@link useDamageEvents} hook lifecycle.
 *
 * The pure {@code diffDamageEvents} helper is the load-bearing
 * derivation; the hook itself is a thin Zustand-subscribe wrapper
 * (mirrors useGameDelta) so the unit tests focus on the diff
 * function.
 */
import { describe, it, expect } from 'vitest';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  webCombatGroupViewSchema,
  webPermanentViewSchema,
  webCardViewSchema,
  type WebGameView,
  type WebPlayerView,
  type WebCombatGroupView,
} from '../api/schemas';
import { diffDamageEvents } from './useDamageEvents';

function makeCard(id: string) {
  return webCardViewSchema.parse({
    id,
    cardId: id,
    name: 'Bear',
    displayName: 'Bear',
    expansionSetCode: 'TST',
    cardNumber: '1',
    manaCost: '',
    manaValue: 0,
    typeLine: 'CREATURE',
    supertypes: [],
    types: ['CREATURE'],
    subtypes: [],
    colors: [],
    rarity: 'COMMON',
    power: '2',
    toughness: '2',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

function makePerm(id: string, controllerName: string) {
  return webPermanentViewSchema.parse({
    card: makeCard(id),
    controllerName,
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

function makePlayer(playerId: string, name: string, life: number): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId,
    name,
    life,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [],
    teamId: null,
    colorIdentity: [],
    connectionState: 'connected',
    skipState: '',
    displayCardName: '',
    displayCardSetCode: '',
    displayCardNumber: '',
    commanderDamageReceived: {},
  });
}

function makeCombatGroup(
  defenderId: string,
  attackerIds: readonly string[],
): WebCombatGroupView {
  const attackers: Record<string, ReturnType<typeof makePerm>> = {};
  for (const id of attackerIds) {
    attackers[id] = makePerm(id, 'attacker');
  }
  return webCombatGroupViewSchema.parse({
    defenderId,
    defenderName: 'defender',
    attackers,
    blockers: {},
    blocked: false,
  });
}

function makeGameView(
  players: readonly WebPlayerView[],
  combat: readonly WebCombatGroupView[],
): WebGameView {
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'COMBAT',
    step: 'COMBAT_DAMAGE',
    activePlayerName: 'attacker',
    priorityPlayerName: 'attacker',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: players[0]!.playerId,
    myHand: {},
    stack: {},
    combat,
    players,
  });
}

const ATTACKER_ID = '11111111-1111-1111-1111-111111111111';
const DEFENDER_ID = '22222222-2222-2222-2222-222222222222';
const ATTACKER_PERM_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ATTACKER_PERM_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('diffDamageEvents', () => {
  it('returns [] when prev is null (first frame, no baseline)', () => {
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 40),
      ],
      [],
    );
    expect(diffDamageEvents(null, next)).toEqual([]);
  });

  it('returns [] when no life delta', () => {
    const players = [
      makePlayer(ATTACKER_ID, 'attacker', 40),
      makePlayer(DEFENDER_ID, 'defender', 40),
    ];
    const combat = [makeCombatGroup(DEFENDER_ID, [ATTACKER_PERM_A])];
    const prev = makeGameView(players, combat);
    const next = makeGameView(players, combat);
    expect(diffDamageEvents(prev, next)).toEqual([]);
  });

  it('returns [] when life decreases but no combat (instant damage etc.)', () => {
    const prev = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 40),
      ],
      [],
    );
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 37),
      ],
      [],
    );
    // Conservative attribution: no combat groups → no parcels.
    // (Future slice may revisit if non-combat parcels read better.)
    expect(diffDamageEvents(prev, next)).toEqual([]);
  });

  it('emits one event when one attacker hits the defender', () => {
    const combat = [makeCombatGroup(DEFENDER_ID, [ATTACKER_PERM_A])];
    const prev = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 40),
      ],
      combat,
    );
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 38),
      ],
      combat,
    );
    const events = diffDamageEvents(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'parcel_hit_player',
      attackerId: ATTACKER_PERM_A,
      defenderId: DEFENDER_ID,
      amount: 2,
    });
  });

  it('emits one event per attacker when multiple attackers hit one defender', () => {
    const combat = [
      makeCombatGroup(DEFENDER_ID, [ATTACKER_PERM_A, ATTACKER_PERM_B]),
    ];
    const prev = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 40),
      ],
      combat,
    );
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 35),
      ],
      combat,
    );
    const events = diffDamageEvents(prev, next);
    expect(events).toHaveLength(2);
    // Each event carries the same total life delta (we don't try to
    // apportion proportionally).
    expect(events[0]?.amount).toBe(5);
    expect(events[1]?.amount).toBe(5);
    expect(events.map((e) => e.attackerId).sort()).toEqual(
      [ATTACKER_PERM_A, ATTACKER_PERM_B].sort(),
    );
  });

  it('sorts events deterministically by (defenderId, attackerId)', () => {
    const combat = [
      makeCombatGroup(DEFENDER_ID, [ATTACKER_PERM_B, ATTACKER_PERM_A]),
    ];
    const prev = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 40),
      ],
      combat,
    );
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 35),
      ],
      combat,
    );
    const events = diffDamageEvents(prev, next);
    // attackerId ordering: 'aaaa...' < 'bbbb...' regardless of
    // insertion order in the attackers map.
    expect(events[0]?.attackerId).toBe(ATTACKER_PERM_A);
    expect(events[1]?.attackerId).toBe(ATTACKER_PERM_B);
  });

  it('skips life increases (life gain emits no events)', () => {
    const combat = [makeCombatGroup(DEFENDER_ID, [ATTACKER_PERM_A])];
    const prev = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 38),
      ],
      combat,
    );
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 40),
      ],
      combat,
    );
    expect(diffDamageEvents(prev, next)).toEqual([]);
  });

  it('skips players whose ID is not in the prev frame (new player joined)', () => {
    const combat = [makeCombatGroup(DEFENDER_ID, [ATTACKER_PERM_A])];
    const prev = makeGameView(
      [makePlayer(ATTACKER_ID, 'attacker', 40)],
      combat,
    );
    const next = makeGameView(
      [
        makePlayer(ATTACKER_ID, 'attacker', 40),
        makePlayer(DEFENDER_ID, 'defender', 30),
      ],
      combat,
    );
    // No prev baseline for DEFENDER_ID → no event (defensive).
    expect(diffDamageEvents(prev, next)).toEqual([]);
  });
});
