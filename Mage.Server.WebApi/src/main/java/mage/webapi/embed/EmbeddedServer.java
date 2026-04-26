package mage.webapi.embed;

import mage.cards.decks.DeckValidatorFactory;
import mage.cards.repository.CardScanner;
import mage.cards.repository.RepositoryUtil;
import mage.game.match.MatchType;
import mage.game.tournament.TournamentType;
import mage.server.MageServerImpl;
import mage.server.MainManagerFactory;
import mage.server.draft.CubeFactory;
import mage.server.game.GameFactory;
import mage.server.game.PlayerFactory;
import mage.server.managers.ConfigSettings;
import mage.server.managers.ManagerFactory;
import mage.server.tournament.TournamentFactory;
import mage.server.util.ConfigFactory;
import mage.server.util.ConfigWrapper;
import mage.server.util.config.Config;
import mage.server.util.config.GamePlugin;
import mage.server.util.config.Plugin;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Boots {@link MageServerImpl} in-process for our JSON/WebSocket facade.
 *
 * <p>JVM-singleton — subsequent calls to {@link #boot(String)} return the
 * cached instance. The upstream factories ({@link GameFactory},
 * {@link TournamentFactory}, etc.) are process-wide singletons; populating
 * them more than once would duplicate-register. {@code boot()} guards
 * against that.
 *
 * <p>Bootstrap sequence (matches Main.java order):
 * <ol>
 *   <li>Load config XML via {@link ConfigFactory#loadFromFile(String)}</li>
 *   <li>Wrap raw {@link Config} in {@link ConfigWrapper}</li>
 *   <li>Bootstrap card / user-stats / auth databases via
 *       {@link RepositoryUtil#bootstrapLocalDb()}</li>
 *   <li>Scan card definitions via {@link CardScanner#scan()}</li>
 *   <li>Populate game/tournament/player/cube/deck-validator factories
 *       (mirrors Main.java L206-235)</li>
 *   <li>Instantiate {@link MainManagerFactory} (creates session/user/game
 *       managers internally)</li>
 *   <li>Instantiate {@link MageServerImpl} as a plain in-process POJO — no
 *       JBoss Remoting binding</li>
 * </ol>
 *
 * <p>Extension package loading (Main.java L236-247) is intentionally
 * skipped. Extensions are an optional upstream feature loading from a
 * separate {@code extensions/} folder and are not required for the WebApi
 * contract.
 */
public final class EmbeddedServer {

    private static final Logger LOG = LoggerFactory.getLogger(EmbeddedServer.class);

    private static volatile EmbeddedServer instance;

    private final ManagerFactory managerFactory;
    private final MageServerImpl server;

    private EmbeddedServer(ManagerFactory managerFactory, MageServerImpl server) {
        this.managerFactory = managerFactory;
        this.server = server;
    }

    /**
     * Boots the server given a path to a config.xml on disk. Idempotent —
     * subsequent calls return the cached instance.
     */
    public static EmbeddedServer boot(String configPath) {
        EmbeddedServer cached = instance;
        if (cached != null) {
            return cached;
        }
        synchronized (EmbeddedServer.class) {
            if (instance != null) {
                return instance;
            }
            Config rawConfig = ConfigFactory.loadFromFile(configPath);
            ConfigSettings config = new ConfigWrapper(rawConfig);

            RepositoryUtil.bootstrapLocalDb();
            CardScanner.scan();
            loadPlugins(config);

            ManagerFactory factory = new MainManagerFactory(config);
            MageServerImpl mageServer = new MageServerImpl(factory, "", false, false);

            instance = new EmbeddedServer(factory, mageServer);
            LOG.info("EmbeddedServer ready (game types: {}, player types: {})",
                    GameFactory.instance.getGameTypes().size(),
                    PlayerFactory.instance.getPlayerTypes().size());
            return instance;
        }
    }

    public MageServerImpl server() {
        return server;
    }

    public ManagerFactory managerFactory() {
        return managerFactory;
    }

    // ---------- plugin loading ----------

    private static void loadPlugins(ConfigSettings config) {
        for (GamePlugin p : config.getGameTypes()) {
            tryAddGameType(p);
        }
        for (GamePlugin p : config.getTournamentTypes()) {
            tryAddTournamentType(p);
        }
        for (Plugin p : config.getPlayerTypes()) {
            tryAddPlayerType(p);
        }
        for (Plugin p : config.getDraftCubes()) {
            tryAddCubeType(p);
        }
        for (Plugin p : config.getDeckTypes()) {
            tryAddDeckType(p);
        }
    }

    private static void tryAddGameType(GamePlugin p) {
        try {
            MatchType matchType = (MatchType) Class.forName(p.getTypeName())
                    .getConstructor().newInstance();
            Class<?> impl = Class.forName(p.getClassName());
            GameFactory.instance.addGameType(p.getName(), matchType, impl);
        } catch (ReflectiveOperationException ex) {
            LOG.warn("Skipping game type '{}': {}", p.getName(), ex.getMessage());
        }
    }

    private static void tryAddTournamentType(GamePlugin p) {
        try {
            TournamentType tournamentType = (TournamentType) Class.forName(p.getTypeName())
                    .getConstructor().newInstance();
            Class<?> impl = Class.forName(p.getClassName());
            TournamentFactory.instance.addTournamentType(p.getName(), tournamentType, impl);
        } catch (ReflectiveOperationException ex) {
            LOG.warn("Skipping tournament type '{}': {}", p.getName(), ex.getMessage());
        }
    }

    private static void tryAddPlayerType(Plugin p) {
        try {
            PlayerFactory.instance.addPlayerType(p.getName(), Class.forName(p.getClassName()));
        } catch (ClassNotFoundException ex) {
            LOG.warn("Skipping player type '{}': {}", p.getName(), ex.getMessage());
        }
    }

    private static void tryAddCubeType(Plugin p) {
        try {
            CubeFactory.instance.addDraftCube(p.getName(), Class.forName(p.getClassName()));
        } catch (ClassNotFoundException ex) {
            LOG.warn("Skipping cube type '{}': {}", p.getName(), ex.getMessage());
        }
    }

    private static void tryAddDeckType(Plugin p) {
        try {
            DeckValidatorFactory.instance.addDeckType(p.getName(), Class.forName(p.getClassName()));
        } catch (ClassNotFoundException ex) {
            LOG.warn("Skipping deck type '{}': {}", p.getName(), ex.getMessage());
        }
    }
}
