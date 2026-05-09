import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { SkipState } from '../api/schemas';
import { useGameStore } from './store';
import { buildDemoGameView } from './devFixtures';
import { usePriorityStopsSettings } from './priorityStopsSettings';
import { useStopOnCombatSteps } from './useStopOnCombatSteps';
import { GameStream } from './stream';

const SELF_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function setSelf(opts: {
  step: string;
  isActive: boolean;
  skipState: SkipState;
}) {
  const gv = buildDemoGameView();
  useGameStore.setState({
    gameView: {
      ...gv,
      myPlayerId: SELF_ID,
      step: opts.step,
      players: gv.players.map((p) => {
        if (p.playerId === SELF_ID) {
          return {
            ...p,
            isActive: opts.isActive,
            skipState: opts.skipState,
          };
        }
        return p;
      }),
    },
  });
}

function makeStream() {
  return new GameStream({
    gameId: '00000000-0000-0000-0000-000000000000',
    token: 'test-token',
  });
}

function Harness({ stream }: { stream: GameStream | null }) {
  useStopOnCombatSteps(stream);
  return null;
}

describe('useStopOnCombatSteps', () => {
  beforeEach(() => {
    usePriorityStopsSettings.setState({ stopOnEachCombatStep: true });
    useGameStore.setState({ gameView: null });
  });
  afterEach(() => {
    useGameStore.setState({ gameView: null });
    vi.restoreAllMocks();
  });

  it('dispatches PASS_PRIORITY_CANCEL_ALL_ACTIONS when entering BEGIN_COMBAT with macro armed (active player)', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    const stream = makeStream();
    setSelf({
      step: 'BEGIN_COMBAT',
      isActive: true,
      skipState: 'NEXT_MAIN',
    });
    render(<Harness stream={stream} />);
    expect(sendSpy).toHaveBeenCalledWith('PASS_PRIORITY_CANCEL_ALL_ACTIONS');
  });

  it('dispatches the cancel even when self is NOT the active player (defender priority per CR 117.3)', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    setSelf({
      step: 'DECLARE_BLOCKERS',
      isActive: false,
      skipState: 'NEXT_MAIN',
    });
    render(<Harness stream={makeStream()} />);
    expect(sendSpy).toHaveBeenCalledWith('PASS_PRIORITY_CANCEL_ALL_ACTIONS');
  });

  it('does NOTHING when toggle is off', () => {
    usePriorityStopsSettings.setState({ stopOnEachCombatStep: false });
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    setSelf({
      step: 'BEGIN_COMBAT',
      isActive: true,
      skipState: 'NEXT_MAIN',
    });
    render(<Harness stream={makeStream()} />);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does NOTHING on DECLARE_ATTACKERS (engine already stops there)', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    setSelf({
      step: 'DECLARE_ATTACKERS',
      isActive: true,
      skipState: 'NEXT_MAIN',
    });
    render(<Harness stream={makeStream()} />);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does NOTHING on PRECOMBAT_MAIN (not a combat step)', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    setSelf({
      step: 'PRECOMBAT_MAIN',
      isActive: true,
      skipState: 'NEXT_MAIN',
    });
    render(<Harness stream={makeStream()} />);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does NOTHING when no macro is armed (skipState is empty string)', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    setSelf({
      step: 'BEGIN_COMBAT',
      isActive: true,
      skipState: '',
    });
    render(<Harness stream={makeStream()} />);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('fires once per distinct combat step, not on every re-render at the same step', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    const stream = makeStream();
    setSelf({
      step: 'BEGIN_COMBAT',
      isActive: true,
      skipState: 'NEXT_MAIN',
    });
    const { rerender } = render(<Harness stream={stream} />);
    rerender(<Harness stream={stream} />);
    rerender(<Harness stream={stream} />);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('fires on each of the 5 combat steps that need stops', () => {
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerAction')
      .mockImplementation(() => {});
    const stream = makeStream();
    const { rerender } = render(<Harness stream={stream} />);
    for (const step of [
      'BEGIN_COMBAT',
      'DECLARE_BLOCKERS',
      'FIRST_COMBAT_DAMAGE',
      'COMBAT_DAMAGE',
      'END_COMBAT',
    ]) {
      setSelf({
        step,
        isActive: true,
        skipState: 'NEXT_MAIN',
      });
      rerender(<Harness stream={stream} />);
    }
    expect(sendSpy).toHaveBeenCalledTimes(5);
    for (const call of sendSpy.mock.calls) {
      expect(call[0]).toBe('PASS_PRIORITY_CANCEL_ALL_ACTIONS');
    }
  });
});
