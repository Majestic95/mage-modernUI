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
 * Pins the AI-8.0 contract: our subclass exists, has the right
 * constructor shape for {@link PlayerFactory}'s reflective
 * instantiation, copies as the same type (so simulation cloning
 * preserves the heuristics), and gets registered as the
 * {@code "Computer - mad"} handler at boot time — overriding
 * upstream's default.
 *
 * <p>Behavior testing of the {@code chooseTarget} heuristic itself
 * requires a full game with multiple players + a real targetable
 * effect; that's the live smoke-test surface, not a unit test.
 * What we lock here is the surface that, if it drifts, silently
 * disables every other AI upgrade we'll layer on.
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
        // Commander overrides — heuristics would silently disable
        // inside the search. Lock the type at every clone.
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
        // (e.g., proxy is removed upstream), the build fails fast at
        // this line rather than at runtime when a human tries to take
        // an AI seat under control.
        CommanderComputerPlayer7 p = new CommanderComputerPlayer7(
                "test-ai", RangeOfInfluence.ALL, 4);
        assertTrue(p instanceof ComputerPlayerControllableProxy,
                "Must extend the controllable proxy so human-takeover hooks survive.");
        assertTrue(p instanceof ComputerPlayer7,
                "Must extend ComputerPlayer7 (MAD) so the minimax engine is the underlying brain.");
    }

    @Test
    void pickThreatTargetIfApplicable_isPackagePrivate() {
        // AI-8.1 renamed pickLowestLifeOpponentIfApplicable to
        // pickThreatTargetIfApplicable to reflect that the score now
        // considers commander damage + life as a unified "damage to
        // dead" clock. Pin the rename so a future refactor doesn't
        // silently lose the override (the wrapping chooseTarget call
        // still routes through this method name).
        var p = new CommanderComputerPlayer7("test-ai", RangeOfInfluence.ALL, 4);
        try {
            var method = CommanderComputerPlayer7.class.getDeclaredMethod(
                    "pickThreatTargetIfApplicable",
                    mage.constants.Outcome.class,
                    mage.target.Target.class,
                    mage.abilities.Ability.class,
                    mage.game.Game.class);
            assertNotNull(method, "pickThreatTargetIfApplicable must exist");
        } catch (NoSuchMethodException ex) {
            throw new AssertionError("Heuristic entry point renamed or removed — "
                    + "chooseTarget override is no longer wired.", ex);
        }
    }

    @Test
    void actOverride_isPresent() {
        // AI-8.2 added a protected act(Game) override for empty-tree
        // telemetry. The act() method is the inner-loop entry point
        // for every priority window — if our override is silently
        // lost (e.g., upstream changes signature), the telemetry
        // stops measuring and the empty-tree bug becomes invisible
        // again. Pin the override via reflection.
        try {
            var method = CommanderComputerPlayer7.class.getDeclaredMethod(
                    "act", mage.game.Game.class);
            assertNotNull(method, "act(Game) override must exist");
            assertEquals(CommanderComputerPlayer7.class, method.getDeclaringClass(),
                    "act(Game) must be declared on our subclass — if upstream's "
                            + "signature changed it would resolve to the parent.");
        } catch (NoSuchMethodException ex) {
            throw new AssertionError("act(Game) override missing — telemetry disabled.", ex);
        }
    }

    @Test
    void boot_registersOverrideAsComputerMadHandler() {
        // The override is installed in EmbeddedServer.installAiOverrides().
        // Confirm the registration actually replaced the upstream
        // ComputerPlayerControllableProxy entry. PlayerFactory exposes
        // the registered classes only via createPlayer (which
        // instantiates), so we exercise the factory and inspect the
        // returned class.
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
}
