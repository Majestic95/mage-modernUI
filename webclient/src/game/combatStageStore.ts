/**
 * Bundle 2 / Slice 2-A — combat-stage coordinator.
 *
 * <p>Derives three pieces of state from the game-view stream and
 * exposes them to {@link ./CombatStage} (and any future consumer):
 *
 * <ul>
 *   <li>{@code stageActive} — whether the stage chrome (vignette,
 *       frame, step-tint) should be mounted + visible. Derived from
 *       {@code gameView.phase === 'COMBAT'}. Latches naturally across
 *       stack-push frames inside combat because the subscriber only
 *       fires {@code setState} when the DERIVED value changes (a stack
 *       push doesn't change phase).</li>
 *   <li>{@code currentSubStep} — the active combat sub-step
 *       ({@code BEGIN_COMBAT} / {@code DECLARE_ATTACKERS} / etc.).
 *       Null outside combat. Slice 2-C will add a 150ms perceived-gap
 *       layer on top of this; for 2-A the raw value is sufficient.</li>
 *   <li>{@code slatePulseCounter} — monotonic counter incremented on
 *       every COMBAT entry AND exit transition. Slice 2-B's slate-clap
 *       keyframe consumer keys its mounted element on this counter so
 *       the keyframe restarts cleanly on each transition (rapid
 *       exit→entry pairs each get their own pulse).</li>
 * </ul>
 *
 * <p>Pattern mirrors {@link ./arrowIsolationStore} (slice 1-B / 1-C
 * phase watcher): module-level Zustand store + a single module-level
 * subscription to {@code useGameStore} that derives the fields. The
 * subscription is the SINGLE source of truth — consumers read the
 * derived store, not the raw game view.
 *
 * <p>Bundle 2 brief: {@code docs/design/combat-bundle-2-combat-stage.md}.
 */
import { create } from 'zustand';
import { COMBAT_STAGE_SUBSTEP_GAP_MS } from '../animation/transitions';
import { useGameStore } from './store';

/**
 * The six combat sub-steps the engine emits in
 * {@code WebGameView.step}. Other step values (BEGINNING phases,
 * MAIN, END phases) result in {@code currentSubStep === null} even
 * when {@code phase === 'COMBAT'} is somehow still true (shouldn't
 * happen in practice — phase + step are correlated wire-side).
 */
export type CombatSubStep =
  | 'BEGIN_COMBAT'
  | 'DECLARE_ATTACKERS'
  | 'DECLARE_BLOCKERS'
  | 'FIRST_COMBAT_DAMAGE'
  | 'COMBAT_DAMAGE'
  | 'END_COMBAT';

const COMBAT_SUB_STEPS: ReadonlySet<string> = new Set<CombatSubStep>([
  'BEGIN_COMBAT',
  'DECLARE_ATTACKERS',
  'DECLARE_BLOCKERS',
  'FIRST_COMBAT_DAMAGE',
  'COMBAT_DAMAGE',
  'END_COMBAT',
]);

interface CombatStageState {
  stageActive: boolean;
  currentSubStep: CombatSubStep | null;
  slatePulseCounter: number;
}

export const useCombatStageStore = create<CombatStageState>(() => ({
  stageActive: false,
  currentSubStep: null,
  slatePulseCounter: 0,
}));

/**
 * Tracks the previous phase value seen by the subscription so we can
 * detect transitions (and emit slate-pulse events on each). Initialized
 * to the empty string so the FIRST observation does NOT count as a
 * transition — without this guard, a lab mount that seeds the store
 * with {@code phase: 'COMBAT'} would fire a spurious slate-pulse on
 * first subscribe before the page even renders.
 */
let lastPhase = '';

/**
 * Slice 2-C — sub-step cross-fade perceived gap duration. When the
 * step transitions between TWO non-null combat sub-steps, the
 * coordinator first flips {@code currentSubStep} to {@code null} for
 * this many milliseconds, then sets it to the new value. The brief
 * window of null gives the user a soft "handoff between acts"
 * reading, rather than a hard step-to-step cut.
 *
 * <p>Skipped on null → value (combat entry — no out-phase to wait
 * for) and value → null (combat exit — coordinated by stage-active
 * flip already).
 *
 * <p>Slice 2-X.0 F-G-N4 fix — value now sourced from the motion
 * registry ({@link COMBAT_STAGE_SUBSTEP_GAP_MS} in transitions.ts)
 * for single-source-of-truth consistency with the other Bundle 2
 * timings. The legacy {@code SUB_STEP_GAP_MS} export is preserved
 * for the existing test imports.
 */
export const SUB_STEP_GAP_MS = COMBAT_STAGE_SUBSTEP_GAP_MS;

/**
 * Slice 2-X.0 F-G-N3 fix — detect reduced-motion at subscriber-time
 * so the 150ms sub-step gap can be SKIPPED under
 * {@code prefers-reduced-motion: reduce}. Without this, the gap
 * mechanism produced a 150ms neutral flicker between sub-steps even
 * with the CSS transition silenced — two snaps + a gray flash, more
 * visually disruptive than no animation at all. Now: under reduced-
 * motion, sub-step transitions write the new value directly without
 * the null intermediate.
 *
 * <p>The check uses {@code matchMedia} at call time (not cached) so
 * the user toggling the OS preference mid-session is honored. In
 * test (jsdom) environments without matchMedia, defaults to
 * not-reduced.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Slice 2-C — pending-timer tracker for the cross-fade gap. Each new
 * step transition that needs a gap cancels the previous timer (if
 * any) before scheduling a fresh one — so rapid step changes during
 * the gap window don't stack-up pending writes.
 */
let pendingSubStepTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingSubStepTimer(): void {
  if (pendingSubStepTimer !== null) {
    clearTimeout(pendingSubStepTimer);
    pendingSubStepTimer = null;
  }
}

/**
 * Module-level subscription. Runs once at module load. Idempotent —
 * subsequent imports of this file don't re-subscribe because the
 * module is cached. Guard against test mocks that stub
 * {@link useGameStore} without zustand's subscribe API (same pattern
 * as {@code arrowIsolationStore.ts:201}).
 */
if (typeof useGameStore.subscribe === 'function') {
  useGameStore.subscribe((state) => {
    const phase = state.gameView?.phase ?? '';
    const step = state.gameView?.step ?? '';
    const stageActive = phase === 'COMBAT';

    // Slate-pulse fires on transitions INTO or OUT OF combat. Skip the
    // initial empty-string seed (lastPhase === '') — first observation
    // is a baseline reading, not a director's-slate moment.
    const isPhaseTransition =
      lastPhase !== '' &&
      lastPhase !== phase &&
      (lastPhase === 'COMBAT' || phase === 'COMBAT');

    const newSubStep: CombatSubStep | null =
      stageActive && COMBAT_SUB_STEPS.has(step)
        ? (step as CombatSubStep)
        : null;

    const current = useCombatStageStore.getState();

    const stageChanged = current.stageActive !== stageActive;
    const subStepChanged = current.currentSubStep !== newSubStep;

    if (stageChanged) {
      // Stage-active toggle — set both fields immediately. Combat
      // entry/exit doesn't get a cross-fade gap; the vignette + frame
      // mount/unmount are the entry/exit signals.
      clearPendingSubStepTimer();
      useCombatStageStore.setState({
        stageActive,
        currentSubStep: newSubStep,
      });
    } else if (subStepChanged) {
      // Slice 2-C — sub-step transition while staying inside combat.
      // Apply the 150ms perceived-gap mechanism ONLY when both the old
      // and new sub-steps are non-null (i.e. we're transitioning
      // between two real combat sub-steps) AND the user hasn't
      // requested reduced motion. Under reduced-motion (slice 2-X.0
      // F-G-N3 fix), skip the gap entirely — write the new value
      // directly so the user doesn't see a 150ms neutral flicker
      // between sub-steps (which reads as MORE visually disruptive
      // than no animation at all). null→value or value→null also
      // gets applied directly (no gap to interpose).
      const wantsGap =
        current.currentSubStep !== null &&
        newSubStep !== null &&
        !prefersReducedMotion();
      if (wantsGap) {
        clearPendingSubStepTimer();
        useCombatStageStore.setState({ currentSubStep: null });
        pendingSubStepTimer = setTimeout(() => {
          pendingSubStepTimer = null;
          // Defense-in-depth: if stage exited combat while the timer
          // was pending, don't write a non-null sub-step. The stage-
          // exit branch already cleared the timer, but checking the
          // live state here is cheap insurance against future refactors.
          const live = useCombatStageStore.getState();
          if (live.stageActive) {
            useCombatStageStore.setState({ currentSubStep: newSubStep });
          }
        }, SUB_STEP_GAP_MS);
      } else {
        clearPendingSubStepTimer();
        useCombatStageStore.setState({ currentSubStep: newSubStep });
      }
    }

    if (isPhaseTransition) {
      useCombatStageStore.setState((s) => ({
        slatePulseCounter: s.slatePulseCounter + 1,
      }));
    }

    lastPhase = phase;
  });
}

/**
 * Test helper — resets store state AND the module-level
 * {@code lastPhase} tracker so each test starts from a clean baseline.
 * Production callers don't need this; the subscription updates state
 * automatically as the game-view stream evolves.
 *
 * <p>The subscription itself cannot be torn down + re-installed in
 * tests (it's a singleton); the state-reset helper is the next-best
 * abstraction for ensuring test isolation.
 *
 * @internal
 */
export function resetCombatStageStore(): void {
  clearPendingSubStepTimer();
  useCombatStageStore.setState({
    stageActive: false,
    currentSubStep: null,
    slatePulseCounter: 0,
  });
  lastPhase = '';
}
