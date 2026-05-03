import { describe, expect, it } from 'vitest';
import { computeShrinkScale, computePodCardSizeVars } from './podShrink';

describe('computeShrinkScale (layout Tier 2)', () => {
  it('returns 1 (full size) at and below the FULL_THRESHOLD', () => {
    expect(computeShrinkScale(0)).toBe(1);
    expect(computeShrinkScale(1)).toBe(1);
    expect(computeShrinkScale(12)).toBe(1);
  });

  it('returns FLOOR_SCALE (0.6) at and above the FLOOR_AT threshold', () => {
    expect(computeShrinkScale(30)).toBeCloseTo(0.6);
    expect(computeShrinkScale(60)).toBeCloseTo(0.6);
    expect(computeShrinkScale(1000)).toBeCloseTo(0.6);
  });

  it('linearly interpolates between FULL_THRESHOLD and FLOOR_AT', () => {
    // 12 → 1.0, 30 → 0.6. Midpoint (21) → 0.8.
    expect(computeShrinkScale(21)).toBeCloseTo(0.8, 2);
    // Closer to the floor.
    expect(computeShrinkScale(27)).toBeCloseTo(0.6 + (3 / 18) * 0.4, 2);
  });

  it('is monotonically non-increasing across the curve', () => {
    let prev = computeShrinkScale(0);
    for (let n = 1; n <= 50; n++) {
      const cur = computeShrinkScale(n);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('computePodCardSizeVars', () => {
  it('returns null at full size (skip the inline-style allocation)', () => {
    expect(computePodCardSizeVars(0)).toBeNull();
    expect(computePodCardSizeVars(12)).toBeNull();
  });

  it('emits scaled --card-size-* CSS vars at the floor', () => {
    const vars = computePodCardSizeVars(30);
    expect(vars).not.toBeNull();
    // Defaults: medium=80, small=72. Floor scale=0.6 → 48px medium, 43px small.
    expect((vars as Record<string, string>)['--card-size-medium']).toBe('48px');
    expect((vars as Record<string, string>)['--card-size-small']).toBe('43px');
  });

  it('emits intermediate values mid-curve', () => {
    const vars = computePodCardSizeVars(21);  // midpoint, scale=0.8
    expect(vars).not.toBeNull();
    expect((vars as Record<string, string>)['--card-size-medium']).toBe('64px');  // 80 * 0.8
    expect((vars as Record<string, string>)['--card-size-small']).toBe('58px');   // 72 * 0.8 ≈ 57.6 → 58 (rounded)
  });
});
