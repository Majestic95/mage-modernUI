/**
 * Bundle 5 / Slice 5-X.1 — lifecycle coverage for
 * {@link CommanderLethalSequence} (slice 5-E).
 *
 * <p>The threshold-crossing diff is covered by
 * {@link useCommanderLethalEvents.test.ts}. This file mocks
 * {@code useCommanderLethalEvents} so events can be fired
 * directly, then asserts the cinematic sequence: baseline inactive
 * sentinel, banner + aria-live render on event, defender name in
 * both, sequence clears after {@link LETHAL_AUTHORITY_TOTAL_MS},
 * multi-event stagger (second event delayed by
 * {@link LETHAL_AUTHORITY_STAGGER_MS}), and unmount cancels
 * pending timers.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderLethalEvent } from '../animation/useCommanderLethalEvents';
import {
  LETHAL_AUTHORITY_STAGGER_MS,
  LETHAL_AUTHORITY_TOTAL_MS,
} from '../animation/transitions';
import { CommanderLethalSequence } from './CommanderLethalSequence';

const lethalMock = vi.hoisted(() => ({
  callback: null as ((events: CommanderLethalEvent[]) => void) | null,
}));

vi.mock('../animation/useCommanderLethalEvents', () => ({
  useCommanderLethalEvents: (
    onEvents: (events: CommanderLethalEvent[]) => void,
  ) => {
    lethalMock.callback = onEvents;
  },
}));

function fireEvents(events: CommanderLethalEvent[]) {
  act(() => {
    lethalMock.callback?.(events);
  });
}

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CMDR_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CMDR_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function lethal(
  defenderId: string,
  defenderName: string,
  commanderId: string,
  damage: number,
): CommanderLethalEvent {
  return {
    kind: 'commander_lethal',
    defenderId,
    commanderId,
    damage,
    defenderName,
  };
}

describe('CommanderLethalSequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lethalMock.callback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('baseline: inactive sentinel renders with data-active="false"', () => {
    const { getByTestId, queryByTestId } = render(<CommanderLethalSequence />);
    const sentinel = getByTestId('commander-lethal-sequence');
    expect(sentinel.dataset.active).toBe('false');
    expect(queryByTestId('commander-lethal-banner')).toBeNull();
    expect(queryByTestId('commander-lethal-announcement')).toBeNull();
  });

  it('flips active + renders banner after the queued setTimeout(0) fires', () => {
    const { getByTestId, queryByTestId } = render(<CommanderLethalSequence />);
    fireEvents([lethal(ALICE, 'alice', CMDR_A, 21)]);
    // The component schedules setTimeout(fn, 0) even for the first
    // event. We must advance the fake clock to let it fire.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(getByTestId('commander-lethal-sequence').dataset.active).toBe(
      'true',
    );
    expect(queryByTestId('commander-lethal-banner')).not.toBeNull();
  });

  it('banner text contains the defender name', () => {
    const { getByTestId } = render(<CommanderLethalSequence />);
    fireEvents([lethal(ALICE, 'alice', CMDR_A, 21)]);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const banner = getByTestId('commander-lethal-banner');
    expect(banner.textContent).toContain('alice');
  });

  it('aria-live announcement says "Lethal commander damage to {name}"', () => {
    const { getByTestId } = render(<CommanderLethalSequence />);
    fireEvents([lethal(ALICE, 'alice', CMDR_A, 21)]);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const announcement = getByTestId('commander-lethal-announcement');
    expect(announcement.getAttribute('aria-live')).toBe('assertive');
    expect(announcement.textContent).toContain(
      'Lethal commander damage to alice',
    );
  });

  it('sequence clears after LETHAL_AUTHORITY_TOTAL_MS', () => {
    const { getByTestId, queryByTestId } = render(<CommanderLethalSequence />);
    fireEvents([lethal(ALICE, 'alice', CMDR_A, 21)]);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(getByTestId('commander-lethal-sequence').dataset.active).toBe(
      'true',
    );
    act(() => {
      vi.advanceTimersByTime(LETHAL_AUTHORITY_TOTAL_MS);
    });
    expect(getByTestId('commander-lethal-sequence').dataset.active).toBe(
      'false',
    );
    expect(queryByTestId('commander-lethal-banner')).toBeNull();
  });

  it('multi-event stagger: second event fires LETHAL_AUTHORITY_STAGGER_MS after first', () => {
    const { getByTestId } = render(<CommanderLethalSequence />);
    fireEvents([
      lethal(ALICE, 'alice', CMDR_A, 21),
      lethal(BOB, 'bob', CMDR_B, 22),
    ]);
    // First event scheduled at delay=0, second at
    // delay=LETHAL_AUTHORITY_STAGGER_MS.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(getByTestId('commander-lethal-banner').textContent).toContain(
      'alice',
    );
    // Advance past the stagger boundary so the second startTimeout
    // fires. The first banner is still in flight (total > stagger),
    // so the active sequence flips to bob — banner text changes.
    act(() => {
      vi.advanceTimersByTime(LETHAL_AUTHORITY_STAGGER_MS);
    });
    expect(getByTestId('commander-lethal-banner').textContent).toContain(
      'bob',
    );
  });

  it('newer sequence preserved when an older end-timeout fires (id-guarded clear)', () => {
    // Slice 5-E's guard: `setActive((cur) => (cur && cur.id === id ? null : cur))`.
    // When sequence #0's end-timer fires AFTER sequence #1 has taken
    // over the active slot, the clear must NOT wipe sequence #1.
    const { getByTestId } = render(<CommanderLethalSequence />);
    fireEvents([
      lethal(ALICE, 'alice', CMDR_A, 21),
      lethal(BOB, 'bob', CMDR_B, 22),
    ]);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // Advance to just past sequence #0's end-timeout but BEFORE
    // sequence #1's end-timeout. Sequence #1 started at t=stagger,
    // so #1's end is at stagger + total. Sequence #0's end is at
    // 0 + total = total. As long as stagger < total, #0's end fires
    // first.
    expect(LETHAL_AUTHORITY_STAGGER_MS).toBeLessThan(LETHAL_AUTHORITY_TOTAL_MS);
    act(() => {
      vi.advanceTimersByTime(LETHAL_AUTHORITY_TOTAL_MS + 1);
    });
    // Sequence #1 should still be visible — #0's clear was guarded
    // by id match and saw cur.id !== 0, so it skipped.
    expect(getByTestId('commander-lethal-sequence').dataset.active).toBe(
      'true',
    );
    expect(getByTestId('commander-lethal-banner').textContent).toContain(
      'bob',
    );
  });

  it('cleans up pending timers on unmount', () => {
    const { unmount } = render(<CommanderLethalSequence />);
    fireEvents([
      lethal(ALICE, 'alice', CMDR_A, 21),
      lethal(BOB, 'bob', CMDR_B, 22),
    ]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    // Both pending startTimeouts (delay=0 and delay=stagger) plus any
    // end-timeouts must be cleared. Advancing should produce no
    // setState-on-unmounted warnings.
    act(() => {
      vi.advanceTimersByTime(LETHAL_AUTHORITY_TOTAL_MS * 3);
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
