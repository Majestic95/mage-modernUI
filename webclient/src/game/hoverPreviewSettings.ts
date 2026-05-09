/**
 * Per-user hover-card-preview settings, persisted to localStorage so
 * the player's chosen popover size survives refresh / re-login.
 * Mirrors the {@link useAudioSettings} pattern (zustand store + load
 * / save / clamp helpers, same STORAGE_KEY versioning convention).
 *
 * <p>Why a setting? Per user direction 2026-05-09: some players want
 * the on-hover card detail (and its embedded Scryfall art) much
 * larger than the default 256 px popover, "even if it blocks other
 * elements." This store exposes a simple scale factor that
 * {@link HoverCardDetail} multiplies against the legacy base width.
 *
 * <p>Range: 1.0 (current 256 px) to 3.0 (768 px ≈ half a 1440p
 * screen). Default 1.0 — existing players see no change unless they
 * opt in via the settings modal slider.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'xmage.hoverPreview.v1';

/** Legacy hard-coded popover width (was Tailwind {@code w-64}). */
export const POPOVER_BASE_WIDTH_PX = 256;
export const POPOVER_MIN_SCALE = 1.0;
export const POPOVER_MAX_SCALE = 3.0;

export interface HoverPreviewSettings {
  /** 1.0 (default 256 px) to 3.0 (768 px). */
  popoverScale: number;
}

const DEFAULTS: HoverPreviewSettings = {
  popoverScale: 1.0,
};

function clampScale(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(POPOVER_MAX_SCALE, Math.max(POPOVER_MIN_SCALE, v));
}

function load(): HoverPreviewSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<HoverPreviewSettings>;
    return {
      popoverScale: clampScale(parsed.popoverScale, DEFAULTS.popoverScale),
    };
  } catch {
    return DEFAULTS;
  }
}

function save(s: HoverPreviewSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage full / blocked — best-effort, same as audioSettingsStore
  }
}

interface State extends HoverPreviewSettings {
  setPopoverScale: (v: number) => void;
}

export const useHoverPreviewSettings = create<State>((set, get) => ({
  ...load(),
  setPopoverScale: (v) => {
    const clamped = clampScale(v, get().popoverScale);
    set({ popoverScale: clamped });
    save({ popoverScale: clamped });
  },
}));

/** Resolve the slider's scale factor to a concrete pixel width. */
export function popoverWidthPx(scale: number): number {
  return Math.round(POPOVER_BASE_WIDTH_PX * scale);
}
