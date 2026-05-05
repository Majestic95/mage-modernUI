package mage.webapi.ai;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Structural tests for {@link MultiOpponentEvaluator}.
 *
 * <p>Behavior tests for AI scoring require a fully-booted
 * {@code EmbeddedServer} + multiple {@code Game} fixtures and are
 * verified via live-smoke playtest (per the AI-8.x precedent in
 * {@code docs/decisions/critic-pass-log.md}). What's locked here
 * is the class shape that, if it drifts, would silently change the
 * AI scoring contract:
 *
 * <ul>
 *   <li>Helper is {@code final} — no accidental subclasses that
 *       leak per-instance state into the simulation cloning path.</li>
 *   <li>No public constructor — purely-static API.</li>
 *   <li>{@link MultiOpponentEvaluator#evaluate} is {@code public static}
 *       so {@link CommanderSearchTreeOverride}'s addActions override
 *       can call it from any package.</li>
 *   <li>Threat-weight constants are in sensible ranges
 *       ({@code [1.0, 2.0]}) and the low-life threshold is positive.</li>
 * </ul>
 */
class MultiOpponentEvaluatorTest {

    @Test
    void helperClass_isFinal() {
        assertTrue(Modifier.isFinal(MultiOpponentEvaluator.class.getModifiers()),
                "MultiOpponentEvaluator must be final — no subclasses with mutable state "
                        + "that would diverge across the simulation cloning tree.");
    }

    @Test
    void helperClass_constructorIsPrivate() throws NoSuchMethodException {
        Constructor<MultiOpponentEvaluator> ctor =
                MultiOpponentEvaluator.class.getDeclaredConstructor();
        assertTrue(Modifier.isPrivate(ctor.getModifiers()),
                "MultiOpponentEvaluator constructor must be private — purely-static API.");
    }

    @Test
    void evaluateMethod_isPublicStatic() throws NoSuchMethodException {
        Method m = MultiOpponentEvaluator.class.getDeclaredMethod(
                "evaluate", java.util.UUID.class, mage.game.Game.class);
        assertAll(
                () -> assertTrue(Modifier.isPublic(m.getModifiers()),
                        "evaluate(UUID, Game) must be public — addActions override calls it."),
                () -> assertTrue(Modifier.isStatic(m.getModifiers()),
                        "evaluate must be static — no per-instance state in scoring path."),
                () -> assertEquals(int.class, m.getReturnType(),
                        "evaluate must return int — drop-in for getTotalScore().")
        );
    }

    @Test
    void thresholds_areInSensibleRanges() {
        // These are documented design constants. If a slice tweaks them
        // by accident (typo, off-by-one), this catches the obvious
        // mistakes — out-of-bounds values would skew every scoring
        // call across the simulation tree.
        assertTrue(MultiOpponentEvaluator.LOW_LIFE_THRESHOLD > 0
                        && MultiOpponentEvaluator.LOW_LIFE_THRESHOLD <= 20,
                "LOW_LIFE_THRESHOLD must be in (0, 20] — Commander starts at 40 life, "
                        + "reaching ≤ 20 means lethal-pressure territory.");
        assertTrue(MultiOpponentEvaluator.BIG_BOARD_THRESHOLD > 0
                        && MultiOpponentEvaluator.BIG_BOARD_THRESHOLD <= 15,
                "BIG_BOARD_THRESHOLD must be in (0, 15] — over 15 permanents is rare; "
                        + "the threshold should fire mid-game, not endgame-only.");
    }

    @Test
    void threatWeights_areInSensibleRanges() {
        assertAll(
                () -> assertTrue(MultiOpponentEvaluator.WEIGHT_LOW_LIFE > 1.0
                                && MultiOpponentEvaluator.WEIGHT_LOW_LIFE <= 2.0,
                        "WEIGHT_LOW_LIFE must amplify (>1.0) and stay reasonable (<=2.0)."),
                () -> assertTrue(MultiOpponentEvaluator.WEIGHT_BIG_BOARD > 1.0
                                && MultiOpponentEvaluator.WEIGHT_BIG_BOARD <= 2.0,
                        "WEIGHT_BIG_BOARD must amplify (>1.0) and stay reasonable (<=2.0)."),
                () -> assertTrue(MultiOpponentEvaluator.WEIGHT_COMMANDER_OUT > 1.0
                                && MultiOpponentEvaluator.WEIGHT_COMMANDER_OUT <= 2.0,
                        "WEIGHT_COMMANDER_OUT must amplify (>1.0) and stay reasonable (<=2.0).")
        );
        // Composed maximum should stay well under 3× (otherwise the
        // multi-opp score dwarfs single-opp games and the AI behaves
        // erratically across game shapes).
        double composed = MultiOpponentEvaluator.WEIGHT_LOW_LIFE
                * MultiOpponentEvaluator.WEIGHT_BIG_BOARD
                * MultiOpponentEvaluator.WEIGHT_COMMANDER_OUT;
        assertTrue(composed < 3.0,
                "Composed threat weight should stay under 3.0 to avoid runaway scoring.");
    }

    @Test
    void overrideChain_preservesProxyAndIntermediateLayers() {
        // Cheap pin — confirms the inheritance chain the overrides depend on.
        // CommanderComputerPlayer7 → CommanderSearchTreeOverride →
        // CommanderSimulatePriorityOverride → ComputerPlayerControllableProxy.
        // If any link breaks, the test fails with a clear message rather
        // than a compile error buried in the build output.
        assertTrue(CommanderSimulatePriorityOverride.class
                        .isAssignableFrom(CommanderSearchTreeOverride.class),
                "CommanderSearchTreeOverride must extend CommanderSimulatePriorityOverride.");
        assertTrue(mage.player.ai.ComputerPlayerControllableProxy.class
                        .isAssignableFrom(CommanderSimulatePriorityOverride.class),
                "CommanderSimulatePriorityOverride must extend ComputerPlayerControllableProxy — "
                        + "addActions/calculateActions/simulatePriority overrides depend on this chain.");
        assertFalse(Modifier.isAbstract(CommanderSearchTreeOverride.class.getModifiers()),
                "CommanderSearchTreeOverride is not abstract — instantiated standalone for isolated tests.");
        assertFalse(Modifier.isAbstract(CommanderSimulatePriorityOverride.class.getModifiers()),
                "CommanderSimulatePriorityOverride is not abstract — instantiated standalone for isolated tests.");
    }
}
