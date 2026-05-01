/**
 * Phase-step → next-phase action mapping (slice 38, redesign).
 *
 * <p>The user's mental model is the orb on the {@link PhaseTimeline}
 * at the top of the game window. "Next Phase" should advance the
 * orb by one phase block (Beginning → Main 1 → Combat → Main 2 →
 * End → opponent's Beginning). The engine has no single
 * "advance one phase" action, so we dispatch one of three
 * pass-priority modes depending on where the orb currently sits.
 *
 * <p>Engine semantics (verified in
 * {@code HumanPlayer.java:1242-1287} and {@code PlayerImpl.java:2667-2705}):
 * <ul>
 *   <li>{@code PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE} — only stops at
 *       {@code PRECOMBAT_MAIN} or {@code POSTCOMBAT_MAIN}.</li>
 *   <li>{@code PASS_PRIORITY_UNTIL_TURN_END_STEP} — only stops at
 *       {@code END_TURN}, but with the engine default
 *       {@code stopOnDeclareAttackers=true} the active player
 *       still gets prompted at {@code DECLARE_ATTACKERS}, so from
 *       Main 1 the orb effectively lands inside the Combat phase
 *       block (close enough to "next phase").</li>
 *   <li>{@code PASS_PRIORITY_UNTIL_NEXT_TURN} — stops at the next
 *       {@code UNTAP} (opponent's, in 1v1).</li>
 * </ul>
 *
 * <p>Empty-string default ({@code step === ''}, e.g. pre-game / between
 * games) returns {@code null} so {@code Next Phase} is a no-op rather
 * than misfiring an action against an undefined game state.
 *
 * <p>Lives in a sibling helper file (split from {@code ActionPanel.tsx}
 * for slice 66a) because the {@code react-refresh/only-export-components}
 * lint rule requires component files to export only components — sharing
 * a helper alongside a component breaks Fast Refresh.
 */
export function nextPhaseAction(step: string): string | null {
  switch (step) {
    case 'UNTAP':
    case 'UPKEEP':
    case 'DRAW':
      // Beginning → Main 1
      return 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE';
    case 'PRECOMBAT_MAIN':
      // Slice 70-Y / Issue 3 fix (2026-05-01) — was
      // PASS_PRIORITY_UNTIL_TURN_END_STEP, which sets
      // passedUntilEndOfTurn=true. Per HumanPlayer.java:1265-1287
      // that flag short-circuits priority on EVERY step except
      // END_TURN — bypassing main2 + combat + everything. User
      // playtest 2026-05-01: "game is rushing past main phase 1
      // and main phase 2." Root cause confirmed by MTG rules expert
      // + code investigation agents: F2 from main1 was firing the
      // turn-end skip.
      //
      // PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE correctly stops at main2
      // via the skippedAtLeastOnce check (PlayerImpl.java:2683-2688).
      // From main1: skips remainder of main1 + combat → stops at
      // main2. From main2 (next case below): doesn't apply, falls
      // through to PASS_PRIORITY_UNTIL_TURN_END_STEP which is correct
      // for ending the turn from main2.
      return 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE';
    case 'BEGIN_COMBAT':
    case 'DECLARE_ATTACKERS':
    case 'DECLARE_BLOCKERS':
    case 'FIRST_COMBAT_DAMAGE':
    case 'COMBAT_DAMAGE':
    case 'END_COMBAT':
      // Combat → Main 2
      return 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE';
    case 'POSTCOMBAT_MAIN':
      // Main 2 → End Turn
      return 'PASS_PRIORITY_UNTIL_TURN_END_STEP';
    case 'END_TURN':
    case 'CLEANUP':
      // End → opponent's Untap
      return 'PASS_PRIORITY_UNTIL_NEXT_TURN';
    default:
      return null;
  }
}
