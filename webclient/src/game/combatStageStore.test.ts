import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  webGameViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';
import { useGameStore } from './store';
import {
  resetCombatStageStore,
  useCombatStageStore,
} from './combatStageStore';

/**
 * Bundle 2 / Slice 2-A — combatStageStore coordinator contract.
 *
 * <p>Tests verify the module-level subscription correctly derives
 * stageActive + currentSubStep + slatePulseCounter from the game-view
 * stream, AND that stack-push frames during combat don't cause
 * stageActive flicker (the key load-bearing property).
 *
 * <p>The subscription itself can't be torn down between tests; tests
 * use {@link resetCombatStageStore} to reset the store + the module's
 * lastPhase tracker before each test, then mutate {@code useGameStore}
 * directly to drive the subscription.
 */

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

function setPhaseAndStep(phase: string, step: string) {
  const me = makePlayer();
  useGameStore.setState({
    gameView: webGameViewSchema.parse({
      turn: 1,
      phase,
      step,
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
  useGameStore.getState().reset();
  resetCombatStageStore();
});

afterEach(() => {
  useGameStore.getState().reset();
  resetCombatStageStore();
});

describe('combatStageStore', () => {
  it('starts inactive with null sub-step and zero pulse counter', () => {
    const s = useCombatStageStore.getState();
    expect(s.stageActive).toBe(false);
    expect(s.currentSubStep).toBeNull();
    expect(s.slatePulseCounter).toBe(0);
  });

  it('stageActive flips true when phase enters COMBAT', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    expect(useCombatStageStore.getState().stageActive).toBe(false);
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().stageActive).toBe(true);
  });

  it('stageActive flips false when phase exits COMBAT', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().stageActive).toBe(true);
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    expect(useCombatStageStore.getState().stageActive).toBe(false);
  });

  it('currentSubStep tracks gameView.step while in combat', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().currentSubStep).toBe('BEGIN_COMBAT');
    setPhaseAndStep('COMBAT', 'DECLARE_ATTACKERS');
    expect(useCombatStageStore.getState().currentSubStep).toBe(
      'DECLARE_ATTACKERS',
    );
    setPhaseAndStep('COMBAT', 'DECLARE_BLOCKERS');
    expect(useCombatStageStore.getState().currentSubStep).toBe(
      'DECLARE_BLOCKERS',
    );
    setPhaseAndStep('COMBAT', 'FIRST_COMBAT_DAMAGE');
    expect(useCombatStageStore.getState().currentSubStep).toBe(
      'FIRST_COMBAT_DAMAGE',
    );
    setPhaseAndStep('COMBAT', 'COMBAT_DAMAGE');
    expect(useCombatStageStore.getState().currentSubStep).toBe('COMBAT_DAMAGE');
    setPhaseAndStep('COMBAT', 'END_COMBAT');
    expect(useCombatStageStore.getState().currentSubStep).toBe('END_COMBAT');
  });

  it('currentSubStep returns null outside combat even if step is a non-combat name', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    expect(useCombatStageStore.getState().currentSubStep).toBeNull();
    setPhaseAndStep('BEGINNING', 'UPKEEP');
    expect(useCombatStageStore.getState().currentSubStep).toBeNull();
  });

  it('currentSubStep returns null when step is unrecognized', () => {
    setPhaseAndStep('COMBAT', 'WAT_IS_THIS');
    expect(useCombatStageStore.getState().stageActive).toBe(true);
    expect(useCombatStageStore.getState().currentSubStep).toBeNull();
  });

  it('does NOT fire a spurious slate pulse on first observation', () => {
    // The first ever observation of phase: 'COMBAT' must NOT count as
    // a transition — without the lastPhase=='' guard, a fresh lab mount
    // that seeds with combat would immediately fire a pulse before any
    // user action.
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(0);
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(0);
  });

  it('increments slatePulseCounter on COMBAT entry transition', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    const before = useCombatStageStore.getState().slatePulseCounter;
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(before + 1);
  });

  it('increments slatePulseCounter on COMBAT exit transition', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    const after_entry = useCombatStageStore.getState().slatePulseCounter;
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(
      after_entry + 1,
    );
  });

  it('increments slatePulseCounter twice on entry → exit → re-entry', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    // 3 transitions: PRECOMBAT→COMBAT (1), COMBAT→POSTCOMBAT (2),
    // POSTCOMBAT→COMBAT (3). All three are "into or out of combat" so
    // all three count.
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(3);
  });

  it('does NOT increment slatePulseCounter on phase changes that do not involve COMBAT', () => {
    setPhaseAndStep('BEGINNING', 'UPKEEP');
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    setPhaseAndStep('END', 'CLEANUP');
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(0);
  });

  it('stack-push during combat (step change to same value) does not flicker stageActive', () => {
    // Stack pushes don't change `phase` or `step`; the subscriber's
    // setState guard ensures no update fires when both derived values
    // are unchanged. We simulate this by calling setState with the
    // same gameView shape twice — if there's no flicker, the second
    // call is a no-op.
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'DECLARE_ATTACKERS');
    expect(useCombatStageStore.getState().stageActive).toBe(true);
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(1);
    // Re-emit the same state (simulating a stack push that updates
    // some other unrelated field but keeps phase+step the same).
    setPhaseAndStep('COMBAT', 'DECLARE_ATTACKERS');
    expect(useCombatStageStore.getState().stageActive).toBe(true);
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(1);
  });

  it('resetCombatStageStore zeroes state AND clears lastPhase tracker', () => {
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().stageActive).toBe(true);
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(1);
    resetCombatStageStore();
    expect(useCombatStageStore.getState().stageActive).toBe(false);
    expect(useCombatStageStore.getState().currentSubStep).toBeNull();
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(0);
    // lastPhase should also be cleared — the next observation of
    // phase: 'COMBAT' should NOT fire a spurious pulse (because the
    // tracker is back to its empty-string baseline).
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    expect(useCombatStageStore.getState().slatePulseCounter).toBe(0);
  });
});
