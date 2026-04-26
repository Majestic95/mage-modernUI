import { describe, it, expect } from 'vitest';
import {
  parseSchemaVersion,
  webCardListingSchema,
  webCardViewSchema,
  webErrorSchema,
  webGameClientMessageSchema,
  webGameViewSchema,
  webHealthSchema,
  webPermanentViewSchema,
  webPlayerViewSchema,
  webRoomRefSchema,
  webServerStateSchema,
  webSessionSchema,
  webStreamFrameSchema,
  webStreamHelloSchema,
  webTableListingSchema,
  webVersionSchema,
  type WebGameView,
} from './schemas';

describe('parseSchemaVersion', () => {
  it('parses well-formed values', () => {
    expect(parseSchemaVersion('1.4')).toEqual({ major: 1, minor: 4 });
    expect(parseSchemaVersion('2.0')).toEqual({ major: 2, minor: 0 });
  });
  it('returns null on malformed values', () => {
    expect(parseSchemaVersion('1')).toBeNull();
    expect(parseSchemaVersion('1.4.0')).toBeNull();
    expect(parseSchemaVersion('alpha')).toBeNull();
    expect(parseSchemaVersion('')).toBeNull();
  });
});

describe('webErrorSchema', () => {
  it('parses a complete error envelope', () => {
    const parsed = webErrorSchema.parse({
      schemaVersion: '1.12',
      code: 'INVALID_CREDENTIALS',
      message: 'Login failed.',
    });
    expect(parsed.code).toBe('INVALID_CREDENTIALS');
  });
  it('rejects missing fields', () => {
    expect(() => webErrorSchema.parse({ code: 'X' })).toThrow();
  });
});

describe('webVersionSchema', () => {
  it('parses /api/version response', () => {
    const parsed = webVersionSchema.parse({
      schemaVersion: '1.12',
      mageVersion: '1.4.58-V1',
      buildTime: '2026-04-25 22:39',
    });
    expect(parsed.mageVersion).toBe('1.4.58-V1');
  });
});

describe('webHealthSchema', () => {
  it('parses /api/health response', () => {
    const parsed = webHealthSchema.parse({
      schemaVersion: '1.12',
      status: 'ready',
    });
    expect(parsed.status).toBe('ready');
  });
});

describe('webSessionSchema', () => {
  it('parses an anonymous session', () => {
    const parsed = webSessionSchema.parse({
      schemaVersion: '1.12',
      token: 'aaaa',
      username: 'guest-deadbeef',
      isAnonymous: true,
      isAdmin: false,
      expiresAt: '2026-04-26T00:00:00Z',
    });
    expect(parsed.isAnonymous).toBe(true);
  });
});

describe('webServerStateSchema', () => {
  it('parses a fully populated state', () => {
    const parsed = webServerStateSchema.parse({
      schemaVersion: '1.12',
      gameTypes: [
        {
          name: 'Two Player Duel',
          minPlayers: 2,
          maxPlayers: 2,
          numTeams: 0,
          playersPerTeam: 0,
          useRange: false,
          useAttackOption: false,
        },
      ],
      tournamentTypes: [],
      playerTypes: ['Human'],
      deckTypes: ['Constructed - Vintage'],
      draftCubes: [],
      testMode: false,
    });
    expect(parsed.gameTypes).toHaveLength(1);
    expect(parsed.playerTypes).toContain('Human');
  });
});

describe('webCardListingSchema', () => {
  it('parses a single-card listing', () => {
    const parsed = webCardListingSchema.parse({
      schemaVersion: '1.12',
      cards: [
        {
          name: 'Lightning Bolt',
          setCode: 'LEA',
          cardNumber: '161',
          manaValue: 1,
          manaCosts: ['{R}'],
          rarity: 'COMMON',
          types: ['INSTANT'],
          subtypes: [],
          supertypes: [],
          colors: ['R'],
          power: '',
          toughness: '',
          startingLoyalty: '',
          rules: ['Lightning Bolt deals 3 damage to any target.'],
        },
      ],
      truncated: false,
    });
    expect(parsed.cards[0]?.name).toBe('Lightning Bolt');
  });
  it('parses an empty listing', () => {
    const parsed = webCardListingSchema.parse({
      schemaVersion: '1.12',
      cards: [],
      truncated: false,
    });
    expect(parsed.cards).toHaveLength(0);
  });
});

describe('webRoomRefSchema', () => {
  it('parses /api/server/main-room response', () => {
    const parsed = webRoomRefSchema.parse({
      schemaVersion: '1.12',
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      chatId: '660e8400-e29b-41d4-a716-446655440000',
    });
    expect(parsed.roomId).toMatch(/^[0-9a-f-]+$/);
  });
});

describe('webTableListingSchema', () => {
  it('parses a listing with one fully-shaped table', () => {
    const parsed = webTableListingSchema.parse({
      schemaVersion: '1.12',
      tables: [
        {
          tableId: '770e8400-e29b-41d4-a716-446655440000',
          tableName: "alice's table",
          gameType: 'Two Player Duel',
          deckType: 'Constructed - Vintage',
          tableState: 'WAITING',
          createTime: '2026-04-25T22:30:00Z',
          controllerName: 'alice',
          skillLevel: 'CASUAL',
          isTournament: false,
          passworded: false,
          spectatorsAllowed: true,
          rated: false,
          limited: false,
          seats: [
            { playerName: 'alice', playerType: 'HUMAN', occupied: true },
            { playerName: '', playerType: '', occupied: false },
          ],
        },
      ],
    });
    expect(parsed.tables[0]?.seats).toHaveLength(2);
  });
});

/* ---------- WebSocket stream schemas (Phase 3 / ADR 0007) ---------- */

const FOREST: ReturnType<typeof webCardViewSchema.parse> = webCardViewSchema.parse({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Forest',
  displayName: 'Forest',
  expansionSetCode: 'M21',
  cardNumber: '281',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Forest',
  supertypes: ['BASIC'],
  types: ['LAND'],
  subtypes: ['Forest'],
  colors: [],
  rarity: 'COMMON',
  power: '',
  toughness: '',
  startingLoyalty: '',
  rules: ['({T}: Add {G}.)'],
  faceDown: false,
  counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
});

function basicGameView(): WebGameView {
  const me = webPlayerViewSchema.parse({
    playerId: '22222222-2222-2222-2222-222222222222',
    name: 'alice',
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 53,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true,
    isHuman: true,
    isActive: true,
    hasPriority: true,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
  });
  const ai = { ...me, playerId: '33333333-3333-3333-3333-333333333333',
    name: 'COMPUTER_MONTE_CARLO', controlled: false, isHuman: false,
    isActive: false, hasPriority: false };
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: 'alice',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 5,
    gameCycle: 2,
    myPlayerId: me.playerId,
    myHand: { [FOREST.id]: FOREST },
    stack: {},
    combat: [],
    players: [me, ai],
  });
}

describe('webStreamFrameSchema', () => {
  it('parses an envelope with arbitrary data payload', () => {
    const env = webStreamFrameSchema.parse({
      schemaVersion: '1.12',
      method: 'streamHello',
      messageId: 0,
      objectId: '550e8400-e29b-41d4-a716-446655440000',
      data: {
        gameId: '550e8400-e29b-41d4-a716-446655440000',
        username: 'alice',
        mode: 'live',
      },
    });
    expect(env.method).toBe('streamHello');
    // Data is unknown at the envelope level — caller validates by method.
    const hello = webStreamHelloSchema.parse(env.data);
    expect(hello.username).toBe('alice');
  });
  it('accepts null objectId', () => {
    expect(() =>
      webStreamFrameSchema.parse({
        schemaVersion: '1.12',
        method: 'streamError',
        messageId: 0,
        objectId: null,
        data: { code: 'BAD_REQUEST', message: 'oops' },
      }),
    ).not.toThrow();
  });
});

describe('webCardViewSchema', () => {
  it('parses the 20-field shape', () => {
    expect(FOREST.name).toBe('Forest');
    expect(FOREST.types).toContain('LAND');
  });
  it('rejects when a required field is missing', () => {
    expect(() =>
      webCardViewSchema.parse({ ...FOREST, name: undefined }),
    ).toThrow();
  });
});

describe('webPermanentViewSchema', () => {
  it('composes a card with battlefield-only state', () => {
    const perm = webPermanentViewSchema.parse({
      card: FOREST,
      controllerName: 'alice',
      tapped: true,
      flipped: false,
      transformed: false,
      phasedIn: true,
      summoningSickness: false,
      damage: 0,
      attachments: [],
      attachedTo: '',
      attachedToPermanent: false,
    });
    expect(perm.card.name).toBe('Forest');
    expect(perm.tapped).toBe(true);
  });
});

describe('webGameViewSchema', () => {
  it('accepts a realistic two-player snapshot', () => {
    const gv = basicGameView();
    expect(gv.players).toHaveLength(2);
    expect(gv.myHand[FOREST.id]?.name).toBe('Forest');
    expect(gv.combat).toEqual([]);
  });
  it('treats stack and combat as empty by default', () => {
    const gv = basicGameView();
    expect(Object.keys(gv.stack)).toHaveLength(0);
  });
});

describe('webGameClientMessageSchema', () => {
  it('parses a wrapped frame with null gameView (gameError shape)', () => {
    const wrap = webGameClientMessageSchema.parse({
      gameView: null,
      message: 'oops',
      targets: [],
      cardsView1: {},
      min: 0,
      max: 0,
      flag: false,
      choice: null,
    });
    expect(wrap.gameView).toBeNull();
    expect(wrap.message).toBe('oops');
  });
  it('parses a populated dialog frame', () => {
    const wrap = webGameClientMessageSchema.parse({
      gameView: basicGameView(),
      message: 'Pick a target.',
      targets: ['44444444-4444-4444-4444-444444444444'],
      cardsView1: { [FOREST.id]: FOREST },
      min: 0,
      max: 0,
      flag: true,
      choice: null,
    });
    expect(wrap.targets).toHaveLength(1);
    expect(wrap.flag).toBe(true);
  });
});
