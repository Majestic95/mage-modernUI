/**
 * FB#4 — chime suppression while a skip is armed.
 *
 * <p>The hook subscribes to the game store and fires chimes on the
 * rising edge of priority/active. When the local player has any
 * `skipState` armed, both chimes must stay silent — but edge tracking
 * still updates so a chime fires correctly on the first post-skip
 * priority/turn rise once `skipState` clears.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAudioCues } from './useAudioCues';
import { useGameStore } from './store';
import { useAudioSettings } from './audioSettingsStore';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type SkipState,
  type WebGameView,
} from '../api/schemas';

const playChime = vi.hoisted(() => vi.fn());
vi.mock('./audioCues', () => ({ playChime }));

function makeGameView(opts: {
  hasPriority: boolean;
  isActive: boolean;
  skipState?: SkipState;
}): WebGameView {
  const me = webPlayerViewSchema.parse({
    playerId: 'pid-me',
    name: 'alice',
    life: 40, wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true,
    isActive: opts.isActive,
    hasPriority: opts.hasPriority,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
    skipState: opts.skipState ?? '',
  });
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
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
  });
}

describe('useAudioCues — FB#4 skip-state suppression', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useAudioSettings.setState({
      priorityEnabled: true,
      priorityVolume: 0.5,
      turnEnabled: true,
      turnVolume: 0.5,
    });
    playChime.mockClear();
  });

  afterEach(() => {
    useGameStore.getState().reset();
  });

  // The hook treats the first observed state as a prime (sets
  // initialized=true without firing) so a page refresh mid-priority
  // doesn't spuriously play. Helper: mount the hook with a known
  // resting state, then push one prime tick before the real edge.
  function mountAndPrime(restingState: {
    hasPriority: boolean;
    isActive: boolean;
    skipState?: SkipState;
  }) {
    renderHook(() => useAudioCues());
    useGameStore.setState({ gameView: makeGameView(restingState) });
    playChime.mockClear();
  }

  it('plays priority chime on rising edge when no skip is armed', () => {
    mountAndPrime({ hasPriority: false, isActive: false });
    useGameStore.setState({
      gameView: makeGameView({ hasPriority: true, isActive: false }),
    });
    expect(playChime).toHaveBeenCalledWith('priority', 0.5);
  });

  it('suppresses priority chime when skipState is armed', () => {
    mountAndPrime({
      hasPriority: false, isActive: false, skipState: 'NEXT_TURN',
    });
    useGameStore.setState({
      gameView: makeGameView({
        hasPriority: true, isActive: false, skipState: 'NEXT_TURN',
      }),
    });
    expect(playChime).not.toHaveBeenCalled();
  });

  it('suppresses turn chime when ALL_TURNS is armed', () => {
    mountAndPrime({
      hasPriority: false, isActive: false, skipState: 'ALL_TURNS',
    });
    useGameStore.setState({
      gameView: makeGameView({
        hasPriority: false, isActive: true, skipState: 'ALL_TURNS',
      }),
    });
    expect(playChime).not.toHaveBeenCalled();
  });

  it('fires the chime once on the first priority rise after a skip clears', () => {
    // Prime with skip armed + no priority.
    mountAndPrime({
      hasPriority: false, isActive: false, skipState: 'NEXT_TURN',
    });
    // Skip resolves: priority surfaces in the same frame skip clears.
    useGameStore.setState({
      gameView: makeGameView({
        hasPriority: true, isActive: false, skipState: '',
      }),
    });
    expect(playChime).toHaveBeenCalledTimes(1);
    expect(playChime).toHaveBeenCalledWith('priority', 0.5);
  });
});
