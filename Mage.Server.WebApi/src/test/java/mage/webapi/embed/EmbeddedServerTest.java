package mage.webapi.embed;

import mage.cards.repository.CardScanner;
import mage.cards.repository.RepositoryUtil;
import mage.server.MageServerImpl;
import mage.server.MainManagerFactory;
import mage.server.managers.ConfigSettings;
import mage.server.managers.ManagerFactory;
import mage.server.util.ConfigFactory;
import mage.server.util.ConfigWrapper;
import mage.server.util.config.Config;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

import java.io.File;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Phase 1 spike — incrementally exercises the bootstrap sequence so we can
 * pinpoint exactly where embedding {@link MageServerImpl} fails (if it does).
 *
 * <p>Each test asserts one step. Tests are ordered: if step N fails, all
 * later steps are presumed to also fail. JUnit reports each one
 * independently, so the failing step is obvious.
 *
 * <p>Config is loaded from the upstream {@code Mage.Server/config/config.xml}
 * via a relative path. This is deliberate — the test exercises the real
 * config the server would use.
 */
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class EmbeddedServerTest {

    private static final String CONFIG_PATH =
            "../Mage.Server/config/config.xml";

    @BeforeAll
    static void verifyConfigExists() {
        File f = new File(CONFIG_PATH);
        assertTrue(f.exists(),
                "Config file not found at " + f.getAbsolutePath()
                        + " — run from F:/xmage/Mage.Server.WebApi/");
    }

    @Test
    @Order(1)
    void step1_loadsConfigXml() {
        Config raw = ConfigFactory.loadFromFile(CONFIG_PATH);
        assertNotNull(raw, "ConfigFactory returned null");
        assertNotNull(raw.getServer(), "Config has no <server> section");
    }

    @Test
    @Order(2)
    void step2_wrapsConfigSettings() {
        Config raw = ConfigFactory.loadFromFile(CONFIG_PATH);
        ConfigSettings cfg = new ConfigWrapper(raw);
        assertNotNull(cfg.getServerAddress(), "server address missing");
        assertTrue(cfg.getPort() > 0, "server port not positive: " + cfg.getPort());
    }

    @Test
    @Order(3)
    void step3_bootstrapsLocalDb() {
        // Throws ConfigurationException / IOException if the H2 db can't be
        // created. Side-effect: creates ./db/cards.h2.mv.db on first run.
        RepositoryUtil.bootstrapLocalDb();
    }

    @Test
    @Order(4)
    void step4_scansCards() {
        // Idempotent — scanned flag is checked internally.
        CardScanner.scan();
        assertTrue(CardScanner.scanned, "CardScanner.scanned remained false");
    }

    @Test
    @Order(5)
    void step5_buildsManagerFactory() {
        Config raw = ConfigFactory.loadFromFile(CONFIG_PATH);
        ConfigSettings cfg = new ConfigWrapper(raw);
        ManagerFactory factory = new MainManagerFactory(cfg);
        assertNotNull(factory, "MainManagerFactory returned null");
        assertNotNull(factory.threadExecutor(),
                "ManagerFactory.threadExecutor() is null");
    }

    @Test
    @Order(6)
    void step6_instantiatesMageServerImpl() {
        Config raw = ConfigFactory.loadFromFile(CONFIG_PATH);
        ConfigSettings cfg = new ConfigWrapper(raw);
        RepositoryUtil.bootstrapLocalDb();
        CardScanner.scan();
        ManagerFactory factory = new MainManagerFactory(cfg);
        MageServerImpl server = new MageServerImpl(factory, "", false, false);
        assertNotNull(server, "MageServerImpl was null after construction");
    }

    @Test
    @Order(7)
    void step7_callsReadMethodOnEmbeddedServer() throws Exception {
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        assertNotNull(embedded.server(), "EmbeddedServer.server() is null");
        assertNotNull(embedded.server().getServerState(),
                "getServerState() returned null on the embedded server");
    }

    @Test
    @Order(8)
    void step8_serverStateExposesLoadedPlugins() throws Exception {
        // boot() is idempotent — this call returns the instance from step7.
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        var state = embedded.server().getServerState();

        assertNotNull(state.getGameTypes(), "gameTypes list is null");
        assertNotNull(state.getPlayerTypes(), "playerTypes array is null");
        assertNotNull(state.getDeckTypes(), "deckTypes array is null");

        // If plugin classes weren't on the classpath, the lists would be
        // empty — this assertion catches that case loudly.
        assertTrue(state.getGameTypes().size() >= 1,
                "expected at least one game type loaded, got "
                        + state.getGameTypes().size());
        assertTrue(state.getPlayerTypes().length >= 1,
                "expected at least one player type loaded, got "
                        + state.getPlayerTypes().length);
        assertTrue(state.getDeckTypes().length >= 1,
                "expected at least one deck type loaded, got "
                        + state.getDeckTypes().length);
    }
}
