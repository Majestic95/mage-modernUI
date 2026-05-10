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
 * Slice 1-C extends the same pattern to the wave-reveal stagger:
 * `arrowsAlreadyStaggered` is a module-level flag tracking whether
 * the cinematic per-defender stagger already played for the CURRENT
 * combat phase. CombatArrows reads it on each render; useEffect sets
 * it after a non-empty paint. The phase watcher below clears it on
 * COMBAT → non-COMBAT transitions so a fresh combat re-staggers.
 * Without this, every stack push during combat (which unmounts /
 * remounts CombatArrows) would replay the full stagger — a real
 * UX regression flagged by both critics.
 *
 * Module-level subscription to useGameStore. Single global subscriber,
 * lives for the app lifetime. Tracks the previous phase via module-
 * scope state. `lastPhase` is initialised to '' so the first-ever
 * transition into COMBAT does NOT trigger a clear (initial state is
 * "no pin / not staggered" anyway, so it's a no-op either way;
 * documenting the invariant).
 * =================================================================*/

let arrowsAlreadyStaggered = false;

/**
 * Slice 1-C — has the wave-reveal stagger already played for the
 * current combat phase? CombatArrows reads this to decide whether
 * the next non-empty render is a "first paint" eligible for the
 * cinematic stagger. The phase watcher resets this on COMBAT exit.
 *
 * <p>Slice 1-X.3 critic-pass (BH-2) — renamed from
 * `getArrowsAlreadyStaggered` to `getCombatArrowsAlreadyStaggered`
 * so the caller-domain (CombatArrows specifically — NOT
 * DefenderBeams or IncomingTag) is visible at the import site. A
 * future slice that imports a `markArrowsStaggered` and calls it
 * from any defender-related component would silently suppress the
 * cinematic without a naming hint blocking the misuse.
 *
 * @internal Only `CombatArrows` should consume these; tests use
 *           {@link resetCombatArrowsStaggered} for fixture cleanup.
 */
export function getCombatArrowsAlreadyStaggered(): boolean {
  return arrowsAlreadyStaggered;
}

/**
 * Slice 1-C — set after a non-empty CombatArrows render commits, so
 * subsequent unmount → remount cycles within the same combat phase
 * (every stack push in combat) don't replay the stagger.
 *
 * @internal Only `CombatArrows` should mark.
 */
export function markCombatArrowsStaggered(): void {
  arrowsAlreadyStaggered = true;
}

/**
 * Slice 1-C — exposed for test setup so the module-level flag stays
 * honest across the test suite. Production callers don't need this;
 * the phase watcher resets the flag automatically.
 */
export function resetCombatArrowsStaggered(): void {
  arrowsAlreadyStaggered = false;
}

/* ===================================================================
 * Slice 6-A — per-arrow ink-overlay draw-tracking set.
 *
 * Mirrors slice 1-C's {@link arrowsAlreadyStaggered} pattern but at a
 * finer grain: the wave-reveal stagger is "play once per combat phase"
 * (single boolean), the ink-overlay draw-in is "play once per ARROW
 * per combat phase" (Set keyed by arrow-end permanent id). Different
 * grain because:
 *
 * <ul>
 *   <li>Stagger is a CinematicArrows-level property (the entire wave
 *       has played or not); a stack-push remount mid-combat must NOT
 *       replay it.</li>
 *   <li>Ink draw-in is a per-arrow property: when a NEW attacker is
 *       added mid-combat (e.g. a creature ETBs and immediately
 *       attacks), it should ink-draw fresh while existing arrows that
 *       already drew don't replay. Same goes for blockers added later
 *       in slice 6-B.</li>
 * </ul>
 *
 * Key shape: the permanent id of the ARROW END that just appeared —
 * attacker permanent id for attack arrows (slice 6-A), blocker
 * permanent id for blocker arrows (slice 6-B). Combat arrows always
 * originate from an attacker, so the attacker id alone disambiguates
 * unblocked arrows (one arrow per attacker → defender pairing). For
 * blocked arrows we key on blocker id since the same attacker can
 * have multiple blockers, each of which is its own arrow.
 *
 * Phase watcher (below) clears the set on COMBAT → non-COMBAT
 * transitions so the next combat phase gets fresh draw-ins.
 * =================================================================*/

const arrowsDrawn = new Set<string>();

/**
 * Slice 6-A — has the ink-overlay draw-in already played for this
 * arrow's end-id this combat phase? CombatArrows reads this to decide
 * whether to pass {@code drawIn={{ kind: ... }}} or {@code undefined}
 * to TargetingArrow on each per-arrow render.
 *
 * <p>The "id" is whichever permanent id is stable for this arrow:
 * attacker id for unblocked arrows, blocker id for blocker arrows.
 * Set membership is checked against this id.
 *
 * @internal Only `CombatArrows` should consume; tests use
 *           {@link resetArrowsDrawn} for fixture cleanup.
 */
export function hasArrowDrawn(id: string): boolean {
  return arrowsDrawn.has(id);
}

/**
 * Slice 6-A — mark an arrow's end-id as having played its ink-overlay
 * draw-in this combat phase. Called from CombatArrows' useEffect after
 * the per-arrow render commits. Idempotent — Set semantics deduplicate.
 *
 * @internal Only `CombatArrows` should mark.
 */
export function markArrowDrawn(id: string): void {
  arrowsDrawn.add(id);
}

/**
 * Slice 6-A — exposed for test setup. Production callers don't need
 * this; the phase watcher resets the set automatically on COMBAT exit.
 */
export function resetArrowsDrawn(): void {
  arrowsDrawn.clear();
}

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
      // Slice 1-C — also reset the stagger flag so the NEXT combat
      // phase replays the cinematic from scratch.
      arrowsAlreadyStaggered = false;
      // Slice 6-A — and reset the per-arrow ink-draw set so each
      // arrow in the next combat phase gets a fresh draw-in.
      arrowsDrawn.clear();
    }
    lastPhase = phase;
  });
}
