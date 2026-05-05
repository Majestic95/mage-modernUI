package mage.webapi.ai;

import mage.game.Game;
import mage.player.ai.ComputerPlayer6;
import mage.player.ai.ComputerPlayer7;
import mage.player.ai.SimulationNode2;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Reflection-pin tests for the upstream surface that
 * {@link CommanderSearchTreeOverride} and
 * {@link MultiOpponentEvaluator} depend on. If any of these pins
 * break on an upstream rebase, our search-tree override silently
 * becomes dead code or drifts subtly — the AI keeps compiling but
 * stops doing what we expect. Failing CI here is the early-warning
 * signal that AI-9 needs re-porting.
 *
 * <p>What's pinned:
 * <ul>
 *   <li>{@code ComputerPlayer6.addActions(SimulationNode2, int, int, int)}
 *       — the method we override. Signature drift = our @Override
 *       compile-fails (good) OR resolves to a NEW method while ours
 *       still hangs off an obsolete one (bad — we want to detect this).</li>
 *   <li>{@code ComputerPlayer7.calculateActions(Game)} — companion
 *       override for currentScore consistency.</li>
 *   <li>{@code ComputerPlayer6#MAX_SIMULATED_NODES_PER_ERROR = 5100}
 *       — private static final upstream constant we hardcoded a copy
 *       of. If upstream tunes this value, our pinned copy goes stale
 *       and the simulation termination heuristic is off.</li>
 *   <li>{@code SimulationNode2.getCount()} — public static accessor
 *       used inline. Pinning the method (not the underlying field)
 *       so a future upstream API tweak still gives us a meaningful
 *       failure message.</li>
 *   <li>{@code ComputerPlayer6} protected fields the body-copy reads
 *       (currentScore, maxNodes, maxDepth, actions, combat, root,
 *       actionCache). Compile-fail on rename, but a sneaky access-
 *       modifier change (protected → package-private) would silently
 *       break the body-copy from a different package — pinned.</li>
 *   <li>{@code GameStateEvaluator2.evaluate} + {@code evaluatePermanent}
 *       + {@code WIN_GAME_SCORE} / {@code LOSE_GAME_SCORE} — the
 *       upstream surface our drop-in evaluator returns matching
 *       values for.</li>
 *   <li>{@code ArtificialScoringSystem.getCardDefinitionScore} — the
 *       card-quality scorer hand quality (Tier 2 #8) delegates to.</li>
 *   <li>{@code Game.getOpponents(UUID, boolean)} — used by the
 *       multi-opp summation loop.</li>
 * </ul>
 */
class MultiOpponentEvaluatorPinTest {

    @Test
    void addActions_signaturePinned() {
        // Method is protected; getDeclaredMethod sees both public and
        // non-public declarations.
        Method m = findDeclaredMethod(ComputerPlayer6.class, "addActions",
                SimulationNode2.class, int.class, int.class, int.class);
        assertNotNull(m, "Upstream ComputerPlayer6.addActions(SimulationNode2, int, int, int) "
                + "is missing — AI-9 override has nothing to override.");
        assertTrue(Modifier.isProtected(m.getModifiers()) || Modifier.isPublic(m.getModifiers()),
                "addActions must remain protected/public so our subclass override is reachable.");
        assertEquals(int.class, m.getReturnType(),
                "addActions must keep its int return type — score propagation breaks otherwise.");
    }

    @Test
    void simulatePriority_signaturePinned() {
        // CommanderSimulatePriorityOverride body-copies this method;
        // signature drift = our override compile-fails with @Override
        // (good) OR resolves to a NEW method while ours hangs off
        // an obsolete one (bad — this test catches it).
        Method m = findDeclaredMethod(ComputerPlayer6.class, "simulatePriority",
                SimulationNode2.class, Game.class, int.class, int.class, int.class);
        assertNotNull(m, "Upstream ComputerPlayer6.simulatePriority(SimulationNode2, Game, int, int, int) "
                + "is missing — AI-9 fixer override has nothing to override.");
        assertTrue(Modifier.isProtected(m.getModifiers()) || Modifier.isPublic(m.getModifiers()),
                "simulatePriority must remain protected/public so our subclass override is reachable.");
        assertEquals(int.class, m.getReturnType(),
                "simulatePriority must keep its int return type.");
    }

    @Test
    void checkForRepeatedAction_signaturePinned() throws NoSuchMethodException {
        // CommanderSimulatePriorityOverride inlines this private
        // upstream method (renamed to checkForRepeatedActionMultiOpp).
        // Pin the upstream signature so a rename or signature change
        // surfaces in CI rather than during manual rebase audit.
        Method m = ComputerPlayer6.class.getDeclaredMethod("checkForRepeatedAction",
                Game.class, SimulationNode2.class, mage.abilities.Ability.class, java.util.UUID.class);
        assertNotNull(m, "Upstream ComputerPlayer6.checkForRepeatedAction is missing — "
                + "AI-9 fixer's inlined cycle-detection has nothing to mirror.");
        assertEquals(boolean.class, m.getReturnType(),
                "checkForRepeatedAction must keep its boolean return type.");
    }

    @Test
    void calculateActions_signaturePinned() {
        Method m = findDeclaredMethod(ComputerPlayer7.class, "calculateActions", Game.class);
        assertNotNull(m, "Upstream ComputerPlayer7.calculateActions(Game) is missing — "
                + "AI-9 currentScore-seeding override has nothing to override.");
        assertTrue(Modifier.isProtected(m.getModifiers()) || Modifier.isPublic(m.getModifiers()),
                "calculateActions must remain protected/public.");
        assertEquals(void.class, m.getReturnType(),
                "calculateActions must remain void.");
    }

    @Test
    void maxSimulatedNodesPerError_constantPinned() throws Exception {
        Field f = ComputerPlayer6.class.getDeclaredField("MAX_SIMULATED_NODES_PER_ERROR");
        f.setAccessible(true);
        int upstreamValue = f.getInt(null);
        assertEquals(CommanderSearchTreeOverride.MAX_SIMULATED_NODES_PER_ERROR_PIN,
                upstreamValue,
                "Upstream ComputerPlayer6.MAX_SIMULATED_NODES_PER_ERROR drifted from "
                        + CommanderSearchTreeOverride.MAX_SIMULATED_NODES_PER_ERROR_PIN
                        + " — our pinned copy is stale; "
                        + "update CommanderSearchTreeOverride.MAX_SIMULATED_NODES_PER_ERROR_PIN.");
    }

    @Test
    void simulationNode_getCountPinned() {
        // CommanderSearchTreeOverride calls SimulationNode2.getCount()
        // (public static) inline. If upstream renames or removes it,
        // our override stops checking node-count termination.
        Method m = findDeclaredMethod(SimulationNode2.class, "getCount");
        assertNotNull(m, "SimulationNode2.getCount() is missing — node-count termination broken.");
        assertTrue(Modifier.isPublic(m.getModifiers()),
                "SimulationNode2.getCount must remain public — addActions reads it directly.");
        assertTrue(Modifier.isStatic(m.getModifiers()),
                "SimulationNode2.getCount must remain static.");
        assertEquals(int.class, m.getReturnType(),
                "SimulationNode2.getCount must return int.");
    }

    @Test
    void computerPlayer6_protectedFieldsPinned() throws Exception {
        // The body-copy of addActions and calculateActions reads these
        // protected fields directly (currentScore, maxNodes, actions,
        // combat, root, actionCache, maxDepth). If upstream renames or
        // re-types any of them, the body-copy compile-fails (good) OR
        // shadows-without-error (bad). Pin each one to fail fast in CI.
        assertProtectedField(ComputerPlayer6.class, "currentScore", int.class);
        assertProtectedField(ComputerPlayer6.class, "maxNodes", int.class);
        assertProtectedField(ComputerPlayer6.class, "maxDepth", int.class);
        // These are typed via parameterized collections; we only assert
        // the field exists with the right modifier. Type-shape diffs
        // would surface as compile errors elsewhere.
        assertProtectedFieldExists(ComputerPlayer6.class, "actions");
        assertProtectedFieldExists(ComputerPlayer6.class, "combat");
        assertProtectedFieldExists(ComputerPlayer6.class, "root");
        assertProtectedFieldExists(ComputerPlayer6.class, "actionCache");
    }

    private static void assertProtectedField(Class<?> cls, String name, Class<?> type) throws NoSuchFieldException {
        Field f = cls.getDeclaredField(name);
        assertTrue(Modifier.isProtected(f.getModifiers()),
                cls.getSimpleName() + "." + name + " must remain protected.");
        assertEquals(type, f.getType(),
                cls.getSimpleName() + "." + name + " type drifted.");
    }

    private static void assertProtectedFieldExists(Class<?> cls, String name) throws NoSuchFieldException {
        Field f = cls.getDeclaredField(name);
        assertTrue(Modifier.isProtected(f.getModifiers()),
                cls.getSimpleName() + "." + name + " must remain protected.");
    }

    @Test
    void gameStateEvaluator_dropInSurfacePinned() throws Exception {
        // Public static evaluate methods we replicate the contract of.
        Method evalPlayer = findDeclaredMethod(
                mage.player.ai.score.GameStateEvaluator2.class, "evaluate",
                java.util.UUID.class, Game.class);
        assertNotNull(evalPlayer, "GameStateEvaluator2.evaluate(UUID, Game) is missing — "
                + "MultiOpponentEvaluator's drop-in contract is undefined.");

        Method evalPerm = findDeclaredMethod(
                mage.player.ai.score.GameStateEvaluator2.class, "evaluatePermanent",
                mage.game.permanent.Permanent.class, Game.class, boolean.class);
        assertNotNull(evalPerm, "GameStateEvaluator2.evaluatePermanent is missing — "
                + "MultiOpponentEvaluator.sumPermanentScores delegates to it.");

        Field winScore = mage.player.ai.score.GameStateEvaluator2.class
                .getDeclaredField("WIN_GAME_SCORE");
        Field loseScore = mage.player.ai.score.GameStateEvaluator2.class
                .getDeclaredField("LOSE_GAME_SCORE");
        assertEquals(100_000_000, winScore.getInt(null),
                "WIN_GAME_SCORE drifted; MultiOpponentEvaluator returns this constant for game-over.");
        assertEquals(-100_000_000, loseScore.getInt(null),
                "LOSE_GAME_SCORE drifted; MultiOpponentEvaluator returns this constant for game-over.");
    }

    @Test
    void artificialScoringSystem_cardScoreSurfacePinned() {
        Method m = findDeclaredMethod(
                mage.player.ai.score.ArtificialScoringSystem.class,
                "getCardDefinitionScore", Game.class, mage.cards.Card.class);
        assertNotNull(m, "ArtificialScoringSystem.getCardDefinitionScore is missing — "
                + "Tier 2 #8 hand quality scoring has no card scorer to delegate to.");
        assertEquals(int.class, m.getReturnType(),
                "getCardDefinitionScore must return int — handQualityScore math assumes it.");
    }

    @Test
    void game_getOpponentsTwoArgPinned() {
        Method m = findInterfaceMethod(Game.class, "getOpponents",
                java.util.UUID.class, boolean.class);
        assertNotNull(m, "Game.getOpponents(UUID, boolean) is missing — multi-opp summation "
                + "in MultiOpponentEvaluator has no opponent enumeration source.");
        assertTrue(java.util.Set.class.isAssignableFrom(m.getReturnType()),
                "getOpponents must return Set<UUID> (or compatible) for the iteration loop.");
    }

    // ---- helpers ------------------------------------------------------

    private static Method findDeclaredMethod(Class<?> cls, String name, Class<?>... params) {
        try {
            return cls.getDeclaredMethod(name, params);
        } catch (NoSuchMethodException ex) {
            fail("Method " + cls.getSimpleName() + "#" + name + " not found — upstream drift.");
            return null;
        }
    }

    private static Method findInterfaceMethod(Class<?> cls, String name, Class<?>... params) {
        try {
            return cls.getMethod(name, params);
        } catch (NoSuchMethodException ex) {
            fail("Interface method " + cls.getSimpleName() + "#" + name
                    + " not found — upstream drift.");
            return null;
        }
    }
}
