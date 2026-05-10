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

    // Only fire setState when something actually changed. Stack-push
    // during combat (same phase, same step) is a no-op here — the
    // vignette doesn't flicker because the store doesn't update.
    const stageChanged = current.stageActive !== stageActive;
    const subStepChanged = current.currentSubStep !== newSubStep;
    if (stageChanged || subStepChanged) {
      useCombatStageStore.setState({
        stageActive,
        currentSubStep: newSubStep,
      });
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
  useCombatStageStore.setState({
    stageActive: false,
    currentSubStep: null,
    slatePulseCounter: 0,
  });
  lastPhase = '';
}
