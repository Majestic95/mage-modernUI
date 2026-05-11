/**
 * Bundle 5 / Slice 5-X.1 — lifecycle coverage for
 * {@link DamageFreezeFrame} (slice 5-C).
 *
 * <p>The damage-event derivation is already covered by
 * {@link useDamageEvents.test.ts}. This file mocks
 * {@code useDamageEvents} so events can be fired directly, then
 * asserts (a) baseline inactive sentinel, (b) local-player gate
 * (events naming only OTHER players do NOT fire), (c) active flip
 * + counter-keyed remount on hit, (d) reset after
 * {@link DAMAGE_FREEZE_FRAME_MS}, (e) timer cleanup on unmount.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DamageEvent } from '../animation/useDamageEvents';
import { DAMAGE_FREEZE_FRAME_MS } from '../animation/transitions';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type WebGameView,
} from '../api/schemas';
import { DamageFreezeFrame } from './DamageFreezeFrame';
import { useGameStore } from './store';

const damageMock = vi.hoisted(() => ({
  callback: null as ((events: DamageEvent[]) => void) | null,
}));

vi.mock('../animation/useDamageEvents', () => ({
  useDamageEvents: (onEvents: (events: DamageEvent[]) => void) => {
    damageMock.callback = onEvents;
  },
}));

function fireDamageEvents(events: DamageEvent[]) {
  act(() => {
    damageMock.callback?.(events);
  });
}

const ME = '11111111-1111-1111-1111-111111111111';
const OPP = '22222222-2222-2222-2222-222222222222';
const ATTACKER_PERM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function damage(defenderId: string): DamageEvent {
  return {
    kind: 'parcel_hit_player',
    attackerId: ATTACKER_PERM,
    defenderId,
    amount: 2,
  };
}

function makePlayer(playerId: string, name: string) {
  return webPlayerViewSchema.parse({
    playerId,
    name,
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
    commanderDamageReceived: {},
  });
}

function makeGameView(myPlayerId: string): WebGameView {
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'COMBAT',
    step: 'COMBAT_DAMAGE',
    activePlayerName: 'opp',
    priorityPlayerName: 'opp',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId,
    myHand: {},
    stack: {},
    combat: [],
    players: [makePlayer(ME, 'me'), makePlayer(OPP, 'opp')],
  });
}

describe('DamageFreezeFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    damageMock.callback = null;
    useGameStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    useGameStore.getState().reset();
  });

  it('baseline: inactive sentinel renders with data-active="false"', () => {
    const { getByTestId } = render(<DamageFreezeFrame />);
    const node = getByTestId('damage-freeze-frame');
    expect(node.dataset.active).toBe('false');
    expect(node.className).not.toContain('animate-damage-freeze-frame-edge');
  });

  it('flips to data-active="true" when an event hits the LOCAL player', () => {
    useGameStore.setState({ gameView: makeGameView(ME) });
    const { getByTestId } = render(<DamageFreezeFrame />);
    fireDamageEvents([damage(ME)]);
    const node = getByTestId('damage-freeze-frame');
    expect(node.dataset.active).toBe('true');
    expect(node.className).toContain('animate-damage-freeze-frame-edge');
  });

  it('stays inactive when an event names only an OPPONENT (local-player gate)', () => {
    useGameStore.setState({ gameView: makeGameView(ME) });
    const { getByTestId } = render(<DamageFreezeFrame />);
    fireDamageEvents([damage(OPP)]);
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('false');
  });

  it('mixed frame (one event names me, others name opps) still fires once', () => {
    useGameStore.setState({ gameView: makeGameView(ME) });
    const { getByTestId } = render(<DamageFreezeFrame />);
    fireDamageEvents([damage(OPP), damage(ME), damage(OPP)]);
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('true');
  });

  it('does NOT fire when gameView is null (pre-game / waiting state)', () => {
    const { getByTestId } = render(<DamageFreezeFrame />);
    // No setState — gameView stays null.
    fireDamageEvents([damage(ME)]);
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('false');
  });

  it('flips back to data-active="false" after DAMAGE_FREEZE_FRAME_MS elapses', () => {
    useGameStore.setState({ gameView: makeGameView(ME) });
    const { getByTestId } = render(<DamageFreezeFrame />);
    fireDamageEvents([damage(ME)]);
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('true');
    act(() => {
      vi.advanceTimersByTime(DAMAGE_FREEZE_FRAME_MS);
    });
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('false');
  });

  it('consecutive hits remount via key prop (different React key per bump)', () => {
    useGameStore.setState({ gameView: makeGameView(ME) });
    const { getByTestId } = render(<DamageFreezeFrame />);
    fireDamageEvents([damage(ME)]);
    // jsdom doesn't expose React fiber keys directly. Use the
    // node identity check: after the second hit, the active div
    // should remount (different DOM node) because key changed. We
    // grab the active node reference before + after.
    const firstActive = getByTestId('damage-freeze-frame');
    // Half-way through the bloom, fire again — counter bumps, key
    // changes, React remounts the keyframe-bearing element.
    act(() => {
      vi.advanceTimersByTime(DAMAGE_FREEZE_FRAME_MS / 2);
    });
    fireDamageEvents([damage(ME)]);
    const secondActive = getByTestId('damage-freeze-frame');
    // Different DOM identity = React remounted (key change).
    expect(secondActive).not.toBe(firstActive);
    expect(secondActive.dataset.active).toBe('true');
    // Original timer would have fired here without cancellation —
    // the fresh timer is only half-elapsed, so still active.
    act(() => {
      vi.advanceTimersByTime(DAMAGE_FREEZE_FRAME_MS / 2);
    });
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('true');
  });

  it('cleans up pending timer on unmount', () => {
    useGameStore.setState({ gameView: makeGameView(ME) });
    const { unmount, getByTestId } = render(<DamageFreezeFrame />);
    fireDamageEvents([damage(ME)]);
    expect(getByTestId('damage-freeze-frame').dataset.active).toBe('true');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    act(() => {
      vi.advanceTimersByTime(DAMAGE_FREEZE_FRAME_MS * 2);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
