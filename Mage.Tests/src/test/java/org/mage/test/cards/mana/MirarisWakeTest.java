package org.mage.test.cards.mana;

import mage.constants.ManaType;
import mage.constants.PhaseStep;
import mage.constants.Zone;
import org.junit.Test;
import org.mage.test.serverside.base.CardTestPlayerBase;

/**
 * FB#3 (2026-05-05) — pin the post-fix behavior of
 * {@code AddManaOfAnyTypeProducedEffect}: when a dual / multi-color
 * land is tapped for one color, Mirari's Wake (and the 15 sibling
 * cards using the same effect class) now offer the choice over
 * every color the land could have produced, not just the single tap
 * output.
 *
 * <p>Pre-fix, tapping a Tundra for {W} caused Mirari's Wake to
 * auto-add {W} (the only entry in the immediate tap output). Post-fix,
 * the trigger prompts over the union of the land's mana abilities so
 * the player can pick {W} or {U}.
 *
 * @author Majestic95
 */
public class MirarisWakeTest extends CardTestPlayerBase {

    private static final String mirarisWake = "Mirari's Wake";

    /**
     * Tundra produces {W} or {U} via two basic mana abilities. Tapping
     * for {W} pre-fix auto-added {W}; post-fix the player picks.
     * Choosing {U} from the prompt verifies the wider choice set is
     * actually exposed. Upwelling keeps the pool from draining at
     * end-of-phase so the assertion can read it.
     */
    @Test
    public void testTundraTappedForWhitePromptsForBothColors() {
        // Mana pools don't empty as steps and phases end.
        addCard(Zone.BATTLEFIELD, playerA, "Upwelling");
        addCard(Zone.BATTLEFIELD, playerA, mirarisWake);
        // Tundra: {T}: Add {W}. and {T}: Add {U}. (two mana abilities).
        addCard(Zone.BATTLEFIELD, playerA, "Tundra");

        activateManaAbility(1, PhaseStep.PRECOMBAT_MAIN, playerA, "{T}: Add {W}");
        // FB#3 — the trigger now prompts. Pre-fix this setChoice would
        // not have been consumed (case 1 auto-pick).
        setChoice(playerA, "Blue");

        setStrictChooseMode(true);
        setStopAt(1, PhaseStep.BEGIN_COMBAT);
        execute();

        assertTapped("Tundra", true);
        // Tap produced 1 W; trigger added 1 U per the pick.
        assertManaPool(playerA, ManaType.WHITE, 1);
        assertManaPool(playerA, ManaType.BLUE, 1);
    }

    /**
     * Choosing the same color the land was tapped for is still valid —
     * pre-fix this was the only outcome; post-fix it's one option of
     * several. Locks the case-default→case-default transition for the
     * "player picks the produced color" path.
     */
    @Test
    public void testTundraTappedForWhitePickingWhiteStillWorks() {
        addCard(Zone.BATTLEFIELD, playerA, "Upwelling");
        addCard(Zone.BATTLEFIELD, playerA, mirarisWake);
        addCard(Zone.BATTLEFIELD, playerA, "Tundra");

        activateManaAbility(1, PhaseStep.PRECOMBAT_MAIN, playerA, "{T}: Add {W}");
        setChoice(playerA, "White");

        setStrictChooseMode(true);
        setStopAt(1, PhaseStep.BEGIN_COMBAT);
        execute();

        assertTapped("Tundra", true);
        assertManaPool(playerA, ManaType.WHITE, 2);
    }

    /**
     * Basic land case — Forest has only one mana ability producing
     * {G}. The union has one type, so the trigger still auto-picks
     * (case 1) without prompting. Locks that the FB#3 fix doesn't
     * regress the no-choice-needed path.
     */
    @Test
    public void testForestStillAutoPicksGreen() {
        addCard(Zone.BATTLEFIELD, playerA, "Upwelling");
        addCard(Zone.BATTLEFIELD, playerA, mirarisWake);
        addCard(Zone.BATTLEFIELD, playerA, "Forest");

        activateManaAbility(1, PhaseStep.PRECOMBAT_MAIN, playerA, "{T}: Add {G}");
        // No setChoice — case 1 auto-pick still applies for single-
        // type lands. setStrictChooseMode would catch a regression
        // that introduced an unnecessary prompt.

        setStrictChooseMode(true);
        setStopAt(1, PhaseStep.BEGIN_COMBAT);
        execute();

        assertTapped("Forest", true);
        assertManaPool(playerA, ManaType.GREEN, 2);
    }
}
