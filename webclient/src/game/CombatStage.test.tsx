import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  webGameViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';
import { useGameStore } from './store';
import {
  resetCombatStageStore,
  useCombatStageStore,
} from './combatStageStore';
import { CombatStage } from './CombatStage';

/**
 * Bundle 2 / Slice 2-A — CombatStage component contract.
 *
 * <p>Verifies the vignette div mounts with the correct testid + data
 * attribute + class state. The opacity transition is CSS-driven and
 * verified via computed-style assertions where jsdom supports them.
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

describe('CombatStage (slice 2-A)', () => {
  it('mounts the vignette div with stage-inactive state at baseline', () => {
    const { getByTestId } = render(<CombatStage />);
    const vignette = getByTestId('combat-stage-vignette');
    expect(vignette).toBeInTheDocument();
    expect(vignette.getAttribute('data-stage-active')).toBe('false');
    expect(vignette.className).not.toContain('is-active');
  });

  it('vignette flips to is-active when phase enters COMBAT', () => {
    const { getByTestId, rerender } = render(<CombatStage />);
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    rerender(<CombatStage />);
    expect(
      getByTestId('combat-stage-vignette').className,
    ).not.toContain('is-active');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    expect(getByTestId('combat-stage-vignette').className).toContain(
      'is-active',
    );
    expect(
      getByTestId('combat-stage-vignette').getAttribute('data-stage-active'),
    ).toBe('true');
  });

  it('vignette flips back to inactive when phase exits COMBAT', () => {
    const { getByTestId, rerender } = render(<CombatStage />);
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    expect(getByTestId('combat-stage-vignette').className).toContain(
      'is-active',
    );
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    rerender(<CombatStage />);
    expect(
      getByTestId('combat-stage-vignette').className,
    ).not.toContain('is-active');
  });

  it('vignette is aria-hidden + pointer-events-none (decorative)', () => {
    const { getByTestId } = render(<CombatStage />);
    const vignette = getByTestId('combat-stage-vignette');
    expect(vignette.getAttribute('aria-hidden')).toBe('true');
    expect(vignette.className).toContain('pointer-events-none');
  });

  it('slice 2-B — frame mounts only when stageActive=true', () => {
    const { queryByTestId, rerender } = render(<CombatStage />);
    // Baseline: no game view → stageActive=false → no frame.
    expect(queryByTestId('combat-stage-frame')).toBeNull();
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    rerender(<CombatStage />);
    expect(queryByTestId('combat-stage-frame')).toBeNull();
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    expect(queryByTestId('combat-stage-frame')).not.toBeNull();
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    rerender(<CombatStage />);
    expect(queryByTestId('combat-stage-frame')).toBeNull();
  });

  it('slice 2-B — slate-pulse element mounts only when stageActive=true', () => {
    const { queryByTestId, rerender } = render(<CombatStage />);
    expect(queryByTestId('combat-stage-slate-pulse')).toBeNull();
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    expect(queryByTestId('combat-stage-slate-pulse')).not.toBeNull();
  });

  it('slice 2-B — slate-pulse element keyed by slatePulseCounter (data-attribute reflects counter)', () => {
    const { getByTestId, rerender } = render(<CombatStage />);
    // First transition: PRECOMBAT → COMBAT increments counter to 1.
    setPhaseAndStep('PRECOMBAT_MAIN', 'PRECOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    expect(
      getByTestId('combat-stage-slate-pulse').getAttribute(
        'data-pulse-counter',
      ),
    ).toBe('1');
    // Exit + re-enter increments counter twice more → 3.
    setPhaseAndStep('POSTCOMBAT_MAIN', 'POSTCOMBAT_MAIN');
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    expect(
      getByTestId('combat-stage-slate-pulse').getAttribute(
        'data-pulse-counter',
      ),
    ).toBe('3');
  });

  it('slice 2-B — frame + slate-pulse are aria-hidden + pointer-events-none', () => {
    const { getByTestId, rerender } = render(<CombatStage />);
    setPhaseAndStep('COMBAT', 'BEGIN_COMBAT');
    rerender(<CombatStage />);
    const frame = getByTestId('combat-stage-frame');
    const pulse = getByTestId('combat-stage-slate-pulse');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.className).toContain('pointer-events-none');
    expect(pulse.getAttribute('aria-hidden')).toBe('true');
    expect(pulse.className).toContain('pointer-events-none');
  });

  it('stack-push during combat (no phase change) does NOT cause vignette flicker', () => {
    const { getByTestId, rerender } = render(<CombatStage />);
    setPhaseAndStep('COMBAT', 'DECLARE_ATTACKERS');
    rerender(<CombatStage />);
    expect(getByTestId('combat-stage-vignette').className).toContain(
      'is-active',
    );
    // Re-emit the same phase+step (simulates a stack-push frame that
    // doesn't change phase). The store's setState guard prevents a
    // re-render of CombatStage because stageActive doesn't change.
    setPhaseAndStep('COMBAT', 'DECLARE_ATTACKERS');
    rerender(<CombatStage />);
    expect(getByTestId('combat-stage-vignette').className).toContain(
      'is-active',
    );
    // stageActive stayed true throughout — counter for slatePulse is
    // also stable.
    expect(useCombatStageStore.getState().stageActive).toBe(true);
  });
});
