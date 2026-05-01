import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Slice 70-Y (Wave 2 of slice 70-X.14) — separate UI-preference store
 * for cross-game user settings that should survive game changes
 * (unlike {@link useGameStore} which wipes on {@code reset()}).
 *
 * <p>Architecture review of slice 70-X.13 flagged that
 * {@code sidePanelCollapsed} lives in the game store but is per-user
 * UI preference; same applies to the aura-display mode added here.
 * This is the new home for those prefs going forward; the
 * sidePanelCollapsed migration is a separate refactor.
 *
 * <p>Persistence: localStorage via Zustand's {@code persist}
 * middleware. Key: {@code 'xmage-ui-prefs-v1'}. Versioned so a
 * future schema change can migrate cleanly.
 */

/**
 * How to render aura/equipment attachments visually:
 *
 * <ul>
 *   <li><b>'stack'</b> (default, MTGA-style) — attachments overlap
 *     the host with a slight offset, smaller than the host. Host
 *     face stays dominant; attachment count is read from the
 *     stacking depth.</li>
 *   <li><b>'adjacent'</b> (MTGO-style) — attachments rendered as
 *     smaller cards immediately to the right of the host. Each
 *     attachment is fully visible.</li>
 * </ul>
 *
 * <p>User direction 2026-05-01: support both modes, default 'stack'.
 */
export type AuraDisplayMode = 'stack' | 'adjacent';

interface UIPrefsState {
  /** How attachments visually pair with their host on the battlefield. */
  auraDisplayMode: AuraDisplayMode;
  setAuraDisplayMode: (mode: AuraDisplayMode) => void;
}

export const useUIPrefs = create<UIPrefsState>()(
  persist(
    (set) => ({
      auraDisplayMode: 'stack',
      setAuraDisplayMode: (mode) => set({ auraDisplayMode: mode }),
    }),
    {
      name: 'xmage-ui-prefs-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
