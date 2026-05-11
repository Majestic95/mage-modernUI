import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PT_BADGE_SCALE_LABELS,
  PT_BADGE_SCALE_OPTIONS,
  usePtBadgeSettings,
} from './ptBadgeSettings';

const STORAGE_KEY = 'xmage.ptBadge.v1';

describe('ptBadgeSettings — store defaults + persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    usePtBadgeSettings.setState({ scale: 1 });
  });
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('defaults scale to 1', () => {
    expect(usePtBadgeSettings.getState().scale).toBe(1);
  });

  it('setScale(2) updates state and writes to localStorage', () => {
    usePtBadgeSettings.getState().setScale(2);
    expect(usePtBadgeSettings.getState().scale).toBe(2);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ scale: 2 });
  });

  it('setScale(3) is accepted (max supported step)', () => {
    usePtBadgeSettings.getState().setScale(3);
    expect(usePtBadgeSettings.getState().scale).toBe(3);
  });

  it('exposes 3 discrete options', () => {
    expect(PT_BADGE_SCALE_OPTIONS).toEqual([1, 2, 3]);
  });

  it('exposes a human label per scale step', () => {
    expect(PT_BADGE_SCALE_LABELS[1]).toBe('Normal');
    expect(PT_BADGE_SCALE_LABELS[2]).toBe('Large');
    expect(PT_BADGE_SCALE_LABELS[3]).toBe('Extra large');
  });
});

describe('ptBadgeSettings — clamp + corrupt-storage handling', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    usePtBadgeSettings.setState({ scale: 1 });
  });
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('rejects out-of-range integer (4) without changing state', () => {
    usePtBadgeSettings.getState().setScale(2);
    // Cast through unknown so TS lets us simulate a corrupt caller —
    // the runtime clamp still has to defend.
    usePtBadgeSettings.getState().setScale(4 as unknown as 1);
    expect(usePtBadgeSettings.getState().scale).toBe(2);
  });

  it('rejects fractional value (1.5) without changing state', () => {
    usePtBadgeSettings.getState().setScale(3);
    usePtBadgeSettings.getState().setScale(1.5 as unknown as 1);
    expect(usePtBadgeSettings.getState().scale).toBe(3);
  });

  it('rejects non-numeric value without changing state', () => {
    usePtBadgeSettings.getState().setScale(2);
    usePtBadgeSettings.getState().setScale('big' as unknown as 1);
    expect(usePtBadgeSettings.getState().scale).toBe(2);
  });
});
