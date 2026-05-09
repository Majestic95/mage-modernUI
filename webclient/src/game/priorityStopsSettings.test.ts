import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePriorityStopsSettings } from './priorityStopsSettings';

const STORAGE_KEY = 'xmage.priorityStops.v1';

describe('priorityStopsSettings', () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    usePriorityStopsSettings.setState({ stopOnEachCombatStep: true });
  });
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it('defaults stopOnEachCombatStep to true', () => {
    expect(usePriorityStopsSettings.getState().stopOnEachCombatStep).toBe(true);
  });

  it('setStopOnEachCombatStep updates state and writes to localStorage', () => {
    usePriorityStopsSettings.getState().setStopOnEachCombatStep(false);
    expect(usePriorityStopsSettings.getState().stopOnEachCombatStep).toBe(false);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ stopOnEachCombatStep: false });
  });

  it('toggling back to true persists', () => {
    usePriorityStopsSettings.getState().setStopOnEachCombatStep(false);
    usePriorityStopsSettings.getState().setStopOnEachCombatStep(true);
    expect(usePriorityStopsSettings.getState().stopOnEachCombatStep).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual({
      stopOnEachCombatStep: true,
    });
  });
});
