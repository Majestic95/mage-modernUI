/**
 * Bundle 5 / Slice 5-X.1 — hook-lifecycle coverage for
 * {@link usePortraitBloom} (slice 5-B).
 *
 * <p>The pure damage-event derivation is already covered by
 * {@link useDamageEvents.test.ts}. This file mocks
 * {@code useDamageEvents} so events can be fired directly into the
 * hook, isolating the slice's own state-machine: counter bump on
 * matching events, no-op on non-matching events, active-flag reset
 * after {@link PORTRAIT_BLOOM_MS}, timer cancellation on consecutive
 * hits, and timer cleanup on unmount.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DamageEvent } from '../animation/useDamageEvents';
import { PORTRAIT_BLOOM_MS } from '../animation/transitions';
import { usePortraitBloom } from './usePortraitBloom';

// `vi.mock` is hoisted to file top, so the mocked callback ref must
// be hoisted alongside. Tests fire events into the hook via
// `fireDamageEvents(...)` below — same path the real
// `useDamageEvents` would invoke after a frame-diff.
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

const TARGET_PLAYER = '11111111-1111-1111-1111-111111111111';
const OTHER_PLAYER = '22222222-2222-2222-2222-222222222222';
const ATTACKER_PERM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function damage(defenderId: string, amount = 2): DamageEvent {
  return {
    kind: 'parcel_hit_player',
    attackerId: ATTACKER_PERM,
    defenderId,
    amount,
  };
}

function Harness({ playerId }: { playerId: string }) {
  const { counter, active } = usePortraitBloom(playerId);
  return (
    <div
      data-testid="harness"
      data-counter={counter}
      data-active={active ? 'true' : 'false'}
    />
  );
}

describe('usePortraitBloom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    damageMock.callback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('baseline: counter=0, active=false at mount with no events', () => {
    const { getByTestId } = render(<Harness playerId={TARGET_PLAYER} />);
    const node = getByTestId('harness');
    expect(node.dataset.counter).toBe('0');
    expect(node.dataset.active).toBe('false');
  });

  it('bumps counter + flips active when event matches playerId', () => {
    const { getByTestId } = render(<Harness playerId={TARGET_PLAYER} />);
    fireDamageEvents([damage(TARGET_PLAYER)]);
    const node = getByTestId('harness');
    expect(node.dataset.counter).toBe('1');
    expect(node.dataset.active).toBe('true');
  });

  it('does NOT bump when event names a different defender', () => {
    const { getByTestId } = render(<Harness playerId={TARGET_PLAYER} />);
    fireDamageEvents([damage(OTHER_PLAYER)]);
    const node = getByTestId('harness');
    expect(node.dataset.counter).toBe('0');
    expect(node.dataset.active).toBe('false');
  });

  it('flips active back to false after PORTRAIT_BLOOM_MS elapses', () => {
    const { getByTestId } = render(<Harness playerId={TARGET_PLAYER} />);
    fireDamageEvents([damage(TARGET_PLAYER)]);
    expect(getByTestId('harness').dataset.active).toBe('true');
    act(() => {
      vi.advanceTimersByTime(PORTRAIT_BLOOM_MS);
    });
    expect(getByTestId('harness').dataset.active).toBe('false');
    // Counter does NOT reset when the bloom decays — only re-trigger
    // bumps it (the keyframe-keyed element is unmounted when active
    // is false anyway).
    expect(getByTestId('harness').dataset.counter).toBe('1');
  });

  it('consecutive hits within the bloom window restart the timer + bump counter twice', () => {
    const { getByTestId } = render(<Harness playerId={TARGET_PLAYER} />);
    fireDamageEvents([damage(TARGET_PLAYER)]);
    expect(getByTestId('harness').dataset.counter).toBe('1');
    // Half-way through the first bloom, fire again.
    act(() => {
      vi.advanceTimersByTime(PORTRAIT_BLOOM_MS / 2);
    });
    fireDamageEvents([damage(TARGET_PLAYER)]);
    expect(getByTestId('harness').dataset.counter).toBe('2');
    expect(getByTestId('harness').dataset.active).toBe('true');
    // Advance by another PORTRAIT_BLOOM_MS / 2 — the first hit's
    // original timer would have fired here had it not been cleared.
    // The second hit's fresh timer is only half-elapsed, so active
    // should STILL be true.
    act(() => {
      vi.advanceTimersByTime(PORTRAIT_BLOOM_MS / 2);
    });
    expect(getByTestId('harness').dataset.active).toBe('true');
    // Now finish the second timer.
    act(() => {
      vi.advanceTimersByTime(PORTRAIT_BLOOM_MS / 2);
    });
    expect(getByTestId('harness').dataset.active).toBe('false');
  });

  it('a frame with mixed defenders (one matches, one does not) triggers exactly one bloom', () => {
    const { getByTestId } = render(<Harness playerId={TARGET_PLAYER} />);
    fireDamageEvents([damage(OTHER_PLAYER), damage(TARGET_PLAYER, 5)]);
    expect(getByTestId('harness').dataset.counter).toBe('1');
    expect(getByTestId('harness').dataset.active).toBe('true');
  });

  it('cleans up pending timer on unmount (no stray setState warning)', () => {
    const { unmount, getByTestId } = render(
      <Harness playerId={TARGET_PLAYER} />,
    );
    fireDamageEvents([damage(TARGET_PLAYER)]);
    expect(getByTestId('harness').dataset.active).toBe('true');
    // Spy console.error so any stray "setState on unmounted" warning
    // would be visible (React 18 no longer logs this but the timer-
    // cleanup contract is still load-bearing for correctness).
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    // Advance past the bloom — the cleared timer must NOT fire.
    act(() => {
      vi.advanceTimersByTime(PORTRAIT_BLOOM_MS * 2);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
