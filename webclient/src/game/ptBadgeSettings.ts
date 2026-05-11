/**
 * Per-user power/toughness badge scale, persisted to localStorage so
 * the player's chosen badge size survives refresh / re-login.
 * Mirrors the {@link useHoverPreviewSettings} pattern (zustand store
 * + load / save / clamp helpers, same STORAGE_KEY versioning
 * convention) and joins the sibling settings stores
 * (audio / hover / priority / mana / pauper).
 *
 * <p>Why a setting? Visually impaired players need the in-card P/T
 * badge ({@link CardFace}'s bottom-right `2/2` overlay) significantly
 * larger than the default 10 px (hand / battlefield) / 14 px (focal).
 * Discrete 1× / 2× / 3× steps cover the spectrum: 1× preserves
 * existing visuals for all current players, 2× roughly doubles the
 * glyph height (clearly readable across the table), 3× triples it
 * (largest the badge can grow without spilling past the card's
 * outer edge, since the {@code transform-origin: bottom right}
 * anchor pushes growth into the card art rather than outside the
 * card's bounding box).
 *
 * <p>The badge also carries the planeswalker loyalty number in the
 * same slot; that scales too — visually impaired users want loyalty
 * just as readable as P/T. Consistent across both readings.
 *
 * <p>Default 1 — existing players see no change unless they opt in
 * via the settings modal picker.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'xmage.ptBadge.v1';

export type PtBadgeScale = 1 | 2 | 3;

/** Available scale options surfaced in the settings UI. */
export const PT_BADGE_SCALE_OPTIONS: readonly PtBadgeScale[] = [1, 2, 3];

/** Human-readable label per scale step. */
export const PT_BADGE_SCALE_LABELS: Readonly<Record<PtBadgeScale, string>> = {
  1: 'Normal',
  2: 'Large',
  3: 'Extra large',
};

export interface PtBadgeSettings {
  scale: PtBadgeScale;
}

const DEFAULTS: PtBadgeSettings = {
  scale: 1,
};

function clampScale(v: unknown, fallback: PtBadgeScale): PtBadgeScale {
  if (v === 1 || v === 2 || v === 3) return v;
  return fallback;
}

function load(): PtBadgeSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PtBadgeSettings>;
    return {
      scale: clampScale(parsed.scale, DEFAULTS.scale),
    };
  } catch {
    return DEFAULTS;
  }
}

function save(s: PtBadgeSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage full / blocked — best-effort, same as sibling stores.
  }
}

interface State extends PtBadgeSettings {
  setScale: (v: PtBadgeScale) => void;
}

export const usePtBadgeSettings = create<State>((set, get) => ({
  ...load(),
  setScale: (v) => {
    const clamped = clampScale(v, get().scale);
    set({ scale: clamped });
    save({ scale: clamped });
  },
}));
