/**
 * Per-user audio-cue settings, persisted to localStorage so toggles
 * + volumes survive refresh / re-login. Each cue (priority, turn)
 * has its own enabled flag and 0-1 volume per user direction
 * 2026-05-02 — "both volume control is a must in the settings for
 * each player individually."
 *
 * <p>Defaults: both cues OFF. The user opts in via the settings
 * modal; we don't ambush a first-time player with sounds.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'xmage.audioSettings.v1';

export interface AudioSettings {
  priorityEnabled: boolean;
  priorityVolume: number; // 0..1
  turnEnabled: boolean;
  turnVolume: number; // 0..1
}

const DEFAULTS: AudioSettings = {
  priorityEnabled: false,
  priorityVolume: 0.6,
  turnEnabled: false,
  turnVolume: 0.6,
};

function load(): AudioSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      priorityEnabled: !!parsed.priorityEnabled,
      priorityVolume: clamp01(parsed.priorityVolume, DEFAULTS.priorityVolume),
      turnEnabled: !!parsed.turnEnabled,
      turnVolume: clamp01(parsed.turnVolume, DEFAULTS.turnVolume),
    };
  } catch {
    return DEFAULTS;
  }
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

function save(s: AudioSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage full / blocked — best-effort
  }
}

interface State extends AudioSettings {
  setPriorityEnabled: (v: boolean) => void;
  setPriorityVolume: (v: number) => void;
  setTurnEnabled: (v: boolean) => void;
  setTurnVolume: (v: number) => void;
}

export const useAudioSettings = create<State>((set, get) => ({
  ...load(),
  setPriorityEnabled: (v) => {
    set({ priorityEnabled: v });
    save(snapshot(get()));
  },
  setPriorityVolume: (v) => {
    const clamped = clamp01(v, get().priorityVolume);
    set({ priorityVolume: clamped });
    save(snapshot(get()));
  },
  setTurnEnabled: (v) => {
    set({ turnEnabled: v });
    save(snapshot(get()));
  },
  setTurnVolume: (v) => {
    const clamped = clamp01(v, get().turnVolume);
    set({ turnVolume: clamped });
    save(snapshot(get()));
  },
}));

function snapshot(s: State): AudioSettings {
  return {
    priorityEnabled: s.priorityEnabled,
    priorityVolume: s.priorityVolume,
    turnEnabled: s.turnEnabled,
    turnVolume: s.turnVolume,
  };
}
