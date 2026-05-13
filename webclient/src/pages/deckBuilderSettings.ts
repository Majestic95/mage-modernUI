/**
 * Per-user deck-builder settings (persisted to localStorage).
 * Pattern lifted from the in-game audioSettingsStore family
 * (`reference_settings_store_pattern` memory) but namespaced to the
 * deck builder so the lobby + game windows stay separate entities.
 *
 * <p>v1 only carries the hover-preview size (added by DB-1a-fix-7's
 * hover-to-zoom). Future user-preference adds (visual grid mode,
 * row density, sort order, …) layer onto this store rather than
 * spawning N new stores.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const PREVIEW_SIZE_MIN = 200;
export const PREVIEW_SIZE_MAX = 520;
export const PREVIEW_SIZE_DEFAULT = 280;
export const PREVIEW_SIZE_STEP = 20;

interface DeckBuilderSettingsState {
  /** Floating hover preview image width in CSS px. Height derives via 5:7. */
  previewSize: number;
  setPreviewSize: (px: number) => void;
  resetPreviewSize: () => void;
}

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

export const useDeckBuilderSettings = create<DeckBuilderSettingsState>()(
  persist(
    (set) => ({
      previewSize: PREVIEW_SIZE_DEFAULT,
      setPreviewSize: (px) =>
        set({ previewSize: clamp(px, PREVIEW_SIZE_MIN, PREVIEW_SIZE_MAX) }),
      resetPreviewSize: () => set({ previewSize: PREVIEW_SIZE_DEFAULT }),
    }),
    {
      name: 'mage-deck-builder-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Defensive: any malformed persisted state (browser data
      // corruption, downgrades) snaps back to defaults rather than
      // throwing on hydrate.
      migrate: (persisted, _version) => {
        const fallback = { previewSize: PREVIEW_SIZE_DEFAULT };
        if (!persisted || typeof persisted !== 'object') return fallback;
        const raw = (persisted as { previewSize?: unknown }).previewSize;
        return {
          previewSize: clamp(
            typeof raw === 'number' ? raw : PREVIEW_SIZE_DEFAULT,
            PREVIEW_SIZE_MIN,
            PREVIEW_SIZE_MAX,
          ),
        };
      },
    },
  ),
);
