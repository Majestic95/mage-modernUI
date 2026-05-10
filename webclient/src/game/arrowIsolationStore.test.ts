import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  webGameViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';
import { useGameStore } from './store';
import { useArrowIsolation } from './arrowIsolationStore';

function makePlayer() {
  return webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
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
    manaPool: {
      red: 0,
      green: 0,
      blue: 0,
      white: 0,
      black: 0,
      colorless: 0,
    },
    controlled: true,
    isHuman: true,
    isActive: true,
    hasPriority: true,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
  });
}

function setPhase(phase: string) {
  const me = makePlayer();
  useGameStore.setState({
    gameView: webGameViewSchema.parse({
      turn: 1,
      phase,
      step: phase,
      activePlayerName: 'alice',
      priorityPlayerName: 'alice',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: me.playerId,
      myHand: {},
      stack: {},
      combat: [],
      players: [me],
    }),
  });
}

beforeEach(() => {
  useArrowIsolation.getState().clearPin();
  useGameStore.getState().reset();
});

afterEach(() => {
  // Reset between tests so pinned state from one test doesn't bleed
  // into the next. The store is module-singleton; act on it via its
  // own clearPin action to keep the test surface honest.
  useArrowIsolation.getState().clearPin();
  useGameStore.getState().reset();
});

describe('arrowIsolationStore', () => {
  it('starts with no pin', () => {
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('togglePin sets the pin when none is active', () => {
    useArrowIsolation.getState().togglePin('p1');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p1');
  });

  it('togglePin on the same defender unpins (toggle semantics)', () => {
    useArrowIsolation.getState().togglePin('p1');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p1');
    useArrowIsolation.getState().togglePin('p1');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('togglePin on a different defender swaps the pin', () => {
    useArrowIsolation.getState().togglePin('p1');
    useArrowIsolation.getState().togglePin('p2');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p2');
  });

  it('clearPin removes an active pin', () => {
    useArrowIsolation.getState().togglePin('p1');
    useArrowIsolation.getState().clearPin();
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('clearPin is idempotent when no pin is active', () => {
    expect(() =>
      useArrowIsolation.getState().clearPin(),
    ).not.toThrow();
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('togglePin ignores empty defenderId (defensive)', () => {
    useArrowIsolation.getState().togglePin('');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });
});

describe('arrowIsolationStore — phase-driven auto-clear (slice 1-B fix)', () => {
  it('pin clears when phase transitions out of COMBAT', () => {
    setPhase('COMBAT');
    useArrowIsolation.getState().togglePin('p1');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p1');
    setPhase('POSTCOMBAT_MAIN');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('pin survives phase changes within COMBAT (begin → declare → damage etc.)', () => {
    // The store watches the `phase` string; the engine's combat
    // sub-steps share `phase === 'COMBAT'` even as `step` walks
    // through BEGIN_COMBAT / DECLARE_ATTACKERS / etc. The pin's
    // lifetime spans the whole combat phase.
    setPhase('COMBAT');
    useArrowIsolation.getState().togglePin('p1');
    setPhase('COMBAT'); // identical phase value — no clear.
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p1');
  });

  it('pin survives a stack push during combat (CombatArrows unmount, phase stays COMBAT)', () => {
    // Slice 1-B fix scenario: StackZoneRedesigned unmounts
    // CombatArrows when a stack appears, but `gameView.phase` stays
    // at 'COMBAT'. The pin must NOT clear in this transition since
    // it's still the same combat — just temporarily paused for a
    // priority window. CombatArrows remounts on stack resolution
    // and the pin is still active.
    setPhase('COMBAT');
    useArrowIsolation.getState().togglePin('p1');
    // No phase change, just a re-set with the same value (simulates
    // a gameUpdate frame during a stack push).
    setPhase('COMBAT');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p1');
  });

  it('pin does not auto-clear when entering combat from a non-combat phase', () => {
    // First-ever transition into COMBAT must NOT trigger a clear
    // (no pin is active yet, so it's a no-op either way; pinning
    // the invariant defensively).
    setPhase('PRECOMBAT_MAIN');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
    setPhase('COMBAT');
    useArrowIsolation.getState().togglePin('p1');
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe('p1');
  });
});
