/**
 * Per-user priority-stop settings — when ON, the webclient cancels
 * any active-player skip-macro upon entering a combat step where
 * the xmage engine doesn't stop by default. Per user direction
 * 2026-05-09 + Magic-rules-agent verification (CR 117 / 507-511):
 * the active player is entitled to priority on every combat step,
 * but the existing macros (e.g. PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE
 * dispatched by the action button) suppress the active player's
 * priority across the whole combat phase.
 *
 * <p>Mirror of the {@link useAudioSettings} pattern: load() at
 * boot, save() on change, clamp on parse failure, default applied
 * only on fresh installs (existing players keep their persisted
 * preferences).
 *
 * <p>Default: ON. Players who hit "Next Phase" through a turn now
 * see priority granted on each combat step (one extra Next-Phase
 * click per step they want to skip). Players who don't care about
 * combat tricks can toggle it OFF in the settings modal to restore
 * the legacy single-click-skip-combat behavior.
 *
 * <p>Implementation note: the "stop" mechanism is the existing
 * engine action {@code PASS_PRIORITY_CANCEL_ALL_ACTIONS}. We do
 * NOT add new engine actions or wire shapes — the toggle is purely
 * client-side intent that decides WHEN to dispatch the existing
 * cancel. See {@link useStopOnCombatSteps}.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'xmage.priorityStops.v1';

export interface PriorityStopsSettings {
  stopOnEachCombatStep: boolean;
}

const DEFAULTS: PriorityStopsSettings = {
  stopOnEachCombatStep: true,
};

function load(): PriorityStopsSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PriorityStopsSettings>;
    return {
      stopOnEachCombatStep:
        typeof parsed.stopOnEachCombatStep === 'boolean'
          ? parsed.stopOnEachCombatStep
          : DEFAULTS.stopOnEachCombatStep,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(s: PriorityStopsSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage full / blocked — best-effort, same as audioSettingsStore
  }
}

interface State extends PriorityStopsSettings {
  setStopOnEachCombatStep: (v: boolean) => void;
}

export const usePriorityStopsSettings = create<State>((set, get) => ({
  ...load(),
  setStopOnEachCombatStep: (v) => {
    set({ stopOnEachCombatStep: v });
    save({ stopOnEachCombatStep: get().stopOnEachCombatStep });
  },
}));
