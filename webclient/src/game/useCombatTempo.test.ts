import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useCombatTempo,
  TEMPO_WARM_MS,
  TEMPO_HOT_MS,
  TEMPO_CAP_MS,
} from './useCombatTempo';

/**
 * Bundle 3-C — locks in the timer's reset-on-step-change behavior,
 * the three-bucket intensity ladder, and the cap. The hook is the
 * sole engine of the banner's tempo bar; if the cap or thresholds
 * drift, the bar's color grading drifts with them, and the user's
 * "hot vs calm" intuition silently breaks.
 */

describe('useCombatTempo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0ms / calm / 0 progress', () => {
    const { result } = renderHook(() => useCombatTempo('BEGIN_COMBAT'));
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.intensity).toBe('calm');
    expect(result.current.progress).toBe(0);
  });

  it('ticks 1000ms per second and stays calm under 30s', () => {
    const { result } = renderHook(() => useCombatTempo('DECLARE_ATTACKERS'));
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(result.current.elapsedMs).toBe(15_000);
    expect(result.current.intensity).toBe('calm');
  });

  it('crosses into warm at exactly 30s', () => {
    const { result } = renderHook(() => useCombatTempo('DECLARE_ATTACKERS'));
    act(() => {
      vi.advanceTimersByTime(TEMPO_WARM_MS - 1_000);
    });
    expect(result.current.intensity).toBe('calm');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.elapsedMs).toBe(TEMPO_WARM_MS);
    expect(result.current.intensity).toBe('warm');
  });

  it('crosses into hot at exactly 90s', () => {
    const { result } = renderHook(() => useCombatTempo('DECLARE_BLOCKERS'));
    act(() => {
      vi.advanceTimersByTime(TEMPO_HOT_MS - 1_000);
    });
    expect(result.current.intensity).toBe('warm');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.intensity).toBe('hot');
  });

  it('caps elapsedMs + progress at the configured cap', () => {
    const { result } = renderHook(() => useCombatTempo('DECLARE_ATTACKERS'));
    act(() => {
      vi.advanceTimersByTime(TEMPO_CAP_MS + 30_000);
    });
    expect(result.current.elapsedMs).toBe(TEMPO_CAP_MS);
    expect(result.current.progress).toBe(1);
    expect(result.current.intensity).toBe('hot');
  });

  it('resets to 0 when step changes (engine moves us to next sub-step)', () => {
    const { result, rerender } = renderHook(
      ({ step }: { step: string }) => useCombatTempo(step),
      { initialProps: { step: 'DECLARE_ATTACKERS' } },
    );
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(result.current.elapsedMs).toBe(45_000);
    expect(result.current.intensity).toBe('warm');
    rerender({ step: 'DECLARE_BLOCKERS' });
    // Effect cleanup + new effect body run synchronously after the
    // rerender. The timer is fresh.
    expect(result.current.elapsedMs).toBe(0);
    expect(result.current.intensity).toBe('calm');
  });

  it('cleans up the interval on unmount (no leak when banner closes)', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useCombatTempo('BEGIN_COMBAT'));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('progress scales linearly between 0 and the cap', () => {
    const { result } = renderHook(() => useCombatTempo('COMBAT_DAMAGE'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.progress).toBeCloseTo(60_000 / TEMPO_CAP_MS, 5);
  });
});
