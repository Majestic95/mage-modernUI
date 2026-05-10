/**
 * Bundle 1 / Slice 1-B — combat-arrow isolation pin state.
 *
 * <p>Today's hover-isolation in {@link ./CombatArrows} dims non-
 * hovered arrows to {@code ARROW_DIM_OPACITY} while the cursor sits
 * over an attacker / blocker / portrait. The pin extends that to a
 * sticky filter: clicking an {@link ./IncomingTag} on an opponent's
 * portrait pins isolation to that defender's arrows; clicking the
 * same tag again unpins; pressing Escape also unpins.
 *
 * <p>Session-scoped — no localStorage persistence. A pin should not
 * survive a refresh; it's tied to the user's current focus on a
 * specific defender within a specific combat.
 */
import { create } from 'zustand';
import { useGameStore } from './store';

interface State {
  /**
   * UUID of the pinned defender, or {@code null} when no pin is
   * active. CombatArrows reads this and treats it as the isolation
   * target ({@code "player:<defenderId>"}) when set, falling back
   * to the cursor-driven hovered id otherwise.
   */
  pinnedDefenderId: string | null;
  /**
   * Toggles the pin: if the given defenderId is already pinned,
   * clears it; otherwise sets it as the new pin (replacing any
   * previously-pinned defender).
   */
  togglePin: (defenderId: string) => void;
  /** Clears any active pin. Idempotent. */
  clearPin: () => void;
}

export const useArrowIsolation = create<State>((set, get) => ({
  pinnedDefenderId: null,
  togglePin: (defenderId) => {
    if (!defenderId) return;
    const current = get().pinnedDefenderId;
    set({
      pinnedDefenderId: current === defenderId ? null : defenderId,
    });
  },
  clearPin: () => {
    if (get().pinnedDefenderId === null) return;
    set({ pinnedDefenderId: null });
  },
}));

/* ===================================================================
 * Phase-driven auto-clear (slice 1-B critic-pass fix, 2026-05-09).
 *
 * The pin's lifetime is "for one combat phase," not "for the lifetime
 * of the CombatArrows component." StackZoneRedesigned only mounts
 * CombatArrows when stack is empty AND combat is active — so any
 * instant cast / triggered ability fired during combat unmounts
 * CombatArrows, then remounts when the stack resolves. Tying the pin
 * to CombatArrows' mount lifetime made the pin die on every stack
 * push, which the user has no signal for. Tying the pin to the
 * `phase` value instead means it survives stack pushes within combat
 * and only dies when combat actually ends.
 *
 * Module-level subscription to useGameStore. Single global subscriber,
 * lives for the app lifetime. Tracks the previous phase via module-
 * scope state and clears the pin on any COMBAT → non-COMBAT transition.
 * `lastPhase` is initialised to '' so the first-ever transition into
 * COMBAT does NOT trigger a clear (initial state is "no pin to clear"
 * anyway, so it's a no-op either way; documenting the invariant).
 * =================================================================*/

let lastPhase: string = '';
// Guard against test mocks that stub `useGameStore` without zustand's
// .subscribe API (vi.mock('./store', ...) in unrelated tests). The
// module is still importable and the IncomingTag render gates still
// work; only the auto-clear sugar is silenced. Production zustand
// always provides .subscribe.
if (typeof useGameStore.subscribe === 'function') {
  useGameStore.subscribe((state) => {
    const phase = state.gameView?.phase ?? '';
    if (lastPhase === 'COMBAT' && phase !== 'COMBAT') {
      useArrowIsolation.getState().clearPin();
    }
    lastPhase = phase;
  });
}
