import { afterEach, describe, expect, it } from 'vitest';
import { useLifeDisplayStore } from './lifeDisplayStore';

const PLAYER_A = '11111111-1111-1111-1111-111111111111';
const PLAYER_B = '22222222-2222-2222-2222-222222222222';

afterEach(() => {
  useLifeDisplayStore.getState().reset();
});

describe('lifeDisplayStore', () => {
  it('starts with zero pending ticks for any player', () => {
    const state = useLifeDisplayStore.getState();
    expect(state.pendingTicksByPlayerId).toEqual({});
  });

  it('enqueueTicks adds count to a player', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 5);
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({
      [PLAYER_A]: 5,
    });
  });

  it('enqueueTicks accumulates across multiple calls (multi-attacker frame)', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 1);
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 5);
    expect(
      useLifeDisplayStore.getState().pendingTicksByPlayerId[PLAYER_A],
    ).toBe(6);
  });

  it('enqueueTicks isolates per-player counts', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 3);
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_B, 7);
    const state = useLifeDisplayStore.getState();
    expect(state.pendingTicksByPlayerId[PLAYER_A]).toBe(3);
    expect(state.pendingTicksByPlayerId[PLAYER_B]).toBe(7);
  });

  it('enqueueTicks ignores zero / negative count (no-op)', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 0);
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, -3);
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({});
  });

  it('enqueueTicks ignores empty playerId (no-op)', () => {
    useLifeDisplayStore.getState().enqueueTicks('', 5);
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({});
  });

  it('tickLand decrements the count by 1', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 3);
    useLifeDisplayStore.getState().tickLand(PLAYER_A);
    expect(
      useLifeDisplayStore.getState().pendingTicksByPlayerId[PLAYER_A],
    ).toBe(2);
  });

  it('tickLand removes the player entry when count reaches 0', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 1);
    useLifeDisplayStore.getState().tickLand(PLAYER_A);
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({});
  });

  it('tickLand on a player with zero pending is a no-op (defensive clamp)', () => {
    useLifeDisplayStore.getState().tickLand(PLAYER_A);
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({});
  });

  it('reset clears all pending ticks across all players', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 5);
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_B, 3);
    useLifeDisplayStore.getState().reset();
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({});
  });

  it('full lifecycle: enqueue 5, tick 5 times, lands at 0', () => {
    useLifeDisplayStore.getState().enqueueTicks(PLAYER_A, 5);
    for (let i = 0; i < 5; i++) {
      useLifeDisplayStore.getState().tickLand(PLAYER_A);
    }
    expect(useLifeDisplayStore.getState().pendingTicksByPlayerId).toEqual({});
  });
});
