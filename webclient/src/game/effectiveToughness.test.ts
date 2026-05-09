import { describe, it, expect } from 'vitest';
import { effectiveToughness } from './effectiveToughness';

describe('effectiveToughness', () => {
  it('returns raw toughness unchanged when damage is 0', () => {
    expect(effectiveToughness('3', 0)).toEqual({
      display: '3',
      damaged: false,
    });
  });

  it('subtracts damage from numeric toughness and flags damaged', () => {
    expect(effectiveToughness('3', 2)).toEqual({
      display: '1',
      damaged: true,
    });
  });

  it('clamps to 0 when damage exceeds toughness (mid-frame pre-SBA)', () => {
    expect(effectiveToughness('3', 5)).toEqual({
      display: '0',
      damaged: true,
    });
  });

  it('passes through `*` toughness unchanged even with damage', () => {
    expect(effectiveToughness('*', 2)).toEqual({
      display: '*',
      damaged: false,
    });
  });

  it('passes through `1+*` (Tarmogoyf-style) unchanged with damage', () => {
    expect(effectiveToughness('1+*', 2)).toEqual({
      display: '1+*',
      damaged: false,
    });
  });

  it('handles negative damage defensively as no-op', () => {
    expect(effectiveToughness('3', -1)).toEqual({
      display: '3',
      damaged: false,
    });
  });
});
