package mage.webapi.ai;

import mage.constants.RangeOfInfluence;
import mage.player.ai.ComputerPlayer7;
import mage.player.ai.ComputerPlayerControllableProxy;
import mage.players.PlayerType;
import mage.server.game.PlayerFactory;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the AI subclass contract: factory-compatible constructor,
 * subclass-typed copy(), inheritance chain (proxy + MAD), boot-time
 * registration, and the override surface for the three heuristic
 * helpers ({@link CommanderTargetingHeuristic},
 * {@link CommanderActionFilter},
 * {@link CommanderLethalShortCircuit}). Behavior testing of the
 * heuristics themselves requires a full game with multiple players
 * + real targetable effects; that's the live smoke-test surface,
 * not a unit test. What we lock here is the surface that, if it
 * drifts, silently disables every Tier 1 upgrade.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CommanderComputerPlayer7Test {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";

    @BeforeAll
    void boot() {
        EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void constructor_acceptsFactorySignature() {
        // PlayerFactory.createPlayer reflectively invokes
        // (String, RangeOfInfluence, int) — match exactly or the
        // factory's createPlayer logs FATAL and returns Optional.empty.
        CommanderComputerPlayer7 p = new CommanderComputerPlayer7(
                "test-ai", RangeOfInfluence.ALL, 4);
        assertNotNull(p);
        assertEquals("test-ai", p.getName());
    }

    @Test
    void copy_returnsSubclassType() {
        // Simulation cloning calls copy() to snapshot the player into
        // each branch of the minimax tree. If copy() returned the
        // parent type, every simulation branch would lose the
        // Commander overrides.
        CommanderComputerPlayer7 original = new CommanderComputerPlayer7(
                "test-ai", RangeOfInfluence.ALL, 4);
        CommanderComputerPlayer7 copy = original.copy();
        assertNotNull(copy);
        assertEquals(CommanderComputerPlayer7.class, copy.getClass());
    }

    @Test
    void inheritanceChain_preservesProxyAndMad() {
        // Defensive: the upstream proxy adds the human-takeover hooks,
        // and ComputerPlayer7 IS the MAD bot. If either link breaks
        // the build fails fast here rather than at runtime when a
        // human tries to take an AI seat under control.
        CommanderComputerPlayer7 p = new CommanderComputerPlayer7(
                "test-ai", RangeOfInfluence.ALL, 4);
        assertTrue(p instanceof ComputerPlayerControllableProxy,
                "Must extend the controllable proxy so human-takeover hooks survive.");
        assertTrue(p instanceof ComputerPlayer7,
                "Must extend ComputerPlayer7 (MAD) so the minimax engine is the underlying brain.");
    }

    @Test
    void overrides_arePresent() {
        // Pin all three override entry points via reflection. If any
        // override silently disappears (e.g., upstream changes
        // signature), the corresponding heuristic stops firing — the
        // class still compiles cleanly but ships a regression where
        // the AI reverts to vanilla MAD behavior on that surface.
        assertOverrideExists("chooseTarget",
                mage.constants.Outcome.class,
                mage.target.Target.class,
                mage.abilities.Ability.class,
                mage.game.Game.class);
        assertOverrideExists("act", mage.game.Game.class);
        assertOverrideExists("selectAttackers",
                mage.game.Game.class, java.util.UUID.class);
    }

    @Test
    void targetingHeuristic_helperPresent() {
        // AI-8.5 extracted the chooseTarget bias logic into
        // CommanderTargetingHeuristic. Pin its public-static entry
        // point so a future refactor can't silently break the
        // chooseTarget delegation.
        assertHelperMethodExists(CommanderTargetingHeuristic.class, "pickThreatTarget",
                java.util.UUID.class,
                mage.constants.Outcome.class,
                mage.target.Target.class,
                mage.abilities.Ability.class,
                mage.game.Game.class);
        assertHelperMethodExists(CommanderTargetingHeuristic.class,
                "maxCommanderDamageDealtBy",
                java.util.UUID.class, java.util.UUID.class, mage.game.Game.class);
    }

    @Test
    void actionFilter_helperPresent() {
        // AI-8.5 extracted the act() filter logic into
        // CommanderActionFilter. Pin both predicates + the filter
        // entry point.
        assertHelperMethodExists(CommanderActionFilter.class, "filterUnsafeActions",
                java.util.LinkedList.class, java.util.UUID.class,
                String.class, mage.game.Game.class);
        assertHelperMethodExists(CommanderActionFilter.class, "isUnsafeCommanderRecast",
                mage.abilities.Ability.class, java.util.UUID.class, mage.game.Game.class);
        assertHelperMethodExists(CommanderActionFilter.class, "isCounterproductiveBoardWipe",
                mage.abilities.Ability.class, java.util.UUID.class, mage.game.Game.class);
    }

    @Test
    void lethalShortCircuit_helperPresent() {
        // AI-8.5 extracted the selectAttackers lethal pre-check
        // into CommanderLethalShortCircuit. Pin the entry point.
        assertHelperMethodExists(CommanderLethalShortCircuit.class, "tryLethalShortCircuit",
                java.util.UUID.class, String.class, mage.game.Game.class);
    }

    @Test
    void boot_registersOverrideAsComputerMadHandler() {
        // The override is installed in EmbeddedServer.installAiOverrides().
        // Confirm the registration actually replaced the upstream
        // ComputerPlayerControllableProxy entry.
        var created = PlayerFactory.instance.createPlayer(
                PlayerType.COMPUTER_MAD, "registration-probe",
                RangeOfInfluence.ALL, 4);
        assertTrue(created.isPresent(),
                "PlayerFactory failed to create a COMPUTER_MAD player — override may "
                        + "have broken the constructor signature.");
        assertSame(CommanderComputerPlayer7.class, created.get().getClass(),
                "PlayerFactory still returns upstream ComputerPlayerControllableProxy "
                        + "instead of our subclass — installAiOverrides() did not run "
                        + "or ran before loadPlugins.");
    }

    // ---- helpers --------------------------------------------------------

    private static void assertOverrideExists(String methodName, Class<?>... params) {
        try {
            var method = CommanderComputerPlayer7.class.getDeclaredMethod(methodName, params);
            assertNotNull(method, methodName + " override must exist");
            assertEquals(CommanderComputerPlayer7.class, method.getDeclaringClass(),
                    methodName + " must be declared on our subclass — if upstream's "
                            + "signature changed it would resolve to the parent.");
        } catch (NoSuchMethodException ex) {
            throw new AssertionError(methodName + " override missing — "
                    + "corresponding heuristic disabled.", ex);
        }
    }

    private static void assertHelperMethodExists(Class<?> helperClass, String methodName,
                                                  Class<?>... params) {
        try {
            var method = helperClass.getDeclaredMethod(methodName, params);
            assertNotNull(method, helperClass.getSimpleName() + "." + methodName + " must exist");
        } catch (NoSuchMethodException ex) {
            throw new AssertionError(helperClass.getSimpleName() + "." + methodName
                    + " missing — heuristic delegation broken.", ex);
        }
    }
}
