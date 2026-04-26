import { describe, it, expect } from 'vitest';
import {
  parseSchemaVersion,
  webCardListingSchema,
  webErrorSchema,
  webHealthSchema,
  webRoomRefSchema,
  webServerStateSchema,
  webSessionSchema,
  webTableListingSchema,
  webVersionSchema,
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
      schemaVersion: '1.8',
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
      schemaVersion: '1.8',
      mageVersion: '1.4.58-V1',
      buildTime: '2026-04-25 22:39',
    });
    expect(parsed.mageVersion).toBe('1.4.58-V1');
  });
});

describe('webHealthSchema', () => {
  it('parses /api/health response', () => {
    const parsed = webHealthSchema.parse({
      schemaVersion: '1.8',
      status: 'ready',
    });
    expect(parsed.status).toBe('ready');
  });
});

describe('webSessionSchema', () => {
  it('parses an anonymous session', () => {
    const parsed = webSessionSchema.parse({
      schemaVersion: '1.8',
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
      schemaVersion: '1.8',
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
      schemaVersion: '1.8',
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
      schemaVersion: '1.8',
      cards: [],
      truncated: false,
    });
    expect(parsed.cards).toHaveLength(0);
  });
});

describe('webRoomRefSchema', () => {
  it('parses /api/server/main-room response', () => {
    const parsed = webRoomRefSchema.parse({
      schemaVersion: '1.8',
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      chatId: '660e8400-e29b-41d4-a716-446655440000',
    });
    expect(parsed.roomId).toMatch(/^[0-9a-f-]+$/);
  });
});

describe('webTableListingSchema', () => {
  it('parses a listing with one fully-shaped table', () => {
    const parsed = webTableListingSchema.parse({
      schemaVersion: '1.8',
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
