/**
 * Bundle 5 / Slice 5-E — coverage for {@link diffLethalEvents}.
 *
 * Locks the threshold-crossing semantics required by CR 704.5b:
 *   - Lethal at >= 21 (not > 21).
 *   - Crossing event fires EXACTLY ONCE per (player, commander)
 *     pair across consecutive frames (so a stable 22 across
 *     multiple frames doesn't re-trigger the cinematic).
 *   - Multi-commander partner-pairings track each commander
 *     independently.
 */
import { describe, it, expect } from 'vitest';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type WebGameView,
  type WebPlayerView,
} from '../api/schemas';
import {
  LETHAL_COMMANDER_DAMAGE_THRESHOLD,
  diffLethalEvents,
} from './useCommanderLethalEvents';

function makePlayer(
  playerId: string,
  damageMap: Record<string, number>,
): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId,
    name: `player-${playerId.slice(0, 4)}`,
    life: 40,
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
    commanderDamageReceived: damageMap,
  });
}

function makeGameView(players: readonly WebPlayerView[]): WebGameView {
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
    combat: [],
    players,
  });
}

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CMDR_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CMDR_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('diffLethalEvents', () => {
  it('threshold is exactly 21 (CR 704.5b)', () => {
    expect(LETHAL_COMMANDER_DAMAGE_THRESHOLD).toBe(21);
  });

  it('returns [] when prev is null (first frame)', () => {
    const next = makeGameView([makePlayer(ALICE, { [CMDR_A]: 25 })]);
    expect(diffLethalEvents(null, next)).toEqual([]);
  });

  it('emits event when (player, commander) crosses 20 → 21', () => {
    const prev = makeGameView([makePlayer(ALICE, { [CMDR_A]: 20 })]);
    const next = makeGameView([makePlayer(ALICE, { [CMDR_A]: 21 })]);
    const events = diffLethalEvents(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'commander_lethal',
      defenderId: ALICE,
      commanderId: CMDR_A,
      damage: 21,
    });
  });

  it('emits event when (player, commander) crosses 0 → 30 (one-shot Voltron kill)', () => {
    const prev = makeGameView([makePlayer(ALICE, {})]);
    const next = makeGameView([makePlayer(ALICE, { [CMDR_A]: 30 })]);
    expect(diffLethalEvents(prev, next)).toHaveLength(1);
  });

  it('does NOT re-fire when value stays >= 21 across consecutive frames', () => {
    // Stable 22 across two frames — engine ticks happening between
    // damage and player-elimination shouldn't re-trigger the
    // cinematic.
    const prev = makeGameView([makePlayer(ALICE, { [CMDR_A]: 22 })]);
    const next = makeGameView([makePlayer(ALICE, { [CMDR_A]: 22 })]);
    expect(diffLethalEvents(prev, next)).toEqual([]);
  });

  it('does NOT re-fire when value goes from 25 → 30 (already lethal)', () => {
    const prev = makeGameView([makePlayer(ALICE, { [CMDR_A]: 25 })]);
    const next = makeGameView([makePlayer(ALICE, { [CMDR_A]: 30 })]);
    expect(diffLethalEvents(prev, next)).toEqual([]);
  });

  it('does NOT fire below threshold (20 → 20)', () => {
    const prev = makeGameView([makePlayer(ALICE, { [CMDR_A]: 18 })]);
    const next = makeGameView([makePlayer(ALICE, { [CMDR_A]: 20 })]);
    expect(diffLethalEvents(prev, next)).toEqual([]);
  });

  it('partner pairing — each commander tracked independently', () => {
    // Alice has been hit by both partners; one crosses lethal,
    // the other is still in the teens.
    const prev = makeGameView([
      makePlayer(ALICE, { [CMDR_A]: 19, [CMDR_B]: 14 }),
    ]);
    const next = makeGameView([
      makePlayer(ALICE, { [CMDR_A]: 21, [CMDR_B]: 18 }),
    ]);
    const events = diffLethalEvents(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.commanderId).toBe(CMDR_A);
  });

  it('multi-lethal in one frame: two players killed by separate commanders', () => {
    const prev = makeGameView([
      makePlayer(ALICE, { [CMDR_A]: 20 }),
      makePlayer(BOB, { [CMDR_B]: 19 }),
    ]);
    const next = makeGameView([
      makePlayer(ALICE, { [CMDR_A]: 22 }),
      makePlayer(BOB, { [CMDR_B]: 21 }),
    ]);
    const events = diffLethalEvents(prev, next);
    expect(events).toHaveLength(2);
    // Sorted by defenderId — ALICE (1...) before BOB (2...).
    expect(events[0]?.defenderId).toBe(ALICE);
    expect(events[1]?.defenderId).toBe(BOB);
  });

  it('handles missing commanderDamageReceived (defaults to {})', () => {
    // Defensive — older 1.34 server payloads default to empty;
    // diff function must not crash.
    const prev = makeGameView([makePlayer(ALICE, {})]);
    const next = makeGameView([makePlayer(ALICE, {})]);
    expect(diffLethalEvents(prev, next)).toEqual([]);
  });
});
