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

/**
 * Boots {@link MageServerImpl} in-process for our JSON/WebSocket facade. This
 * is the Phase 1 spike implementation — the goal is to prove the embedding
 * strategy works, not to ship production code. The full production version
 * (Phase 2+) will additionally load game/tournament/player/cube/deck plugins
 * (mirroring Main.java L206-246), wire callback dispatch to a WebSocket layer,
 * and manage lifecycle (clean shutdown, thread pool draining).
 *
 * <p>Bootstrap sequence (matches Main.java order):
 * <ol>
 *   <li>Load config XML via {@link ConfigFactory#loadFromFile(String)}</li>
 *   <li>Wrap raw {@link Config} in {@link ConfigWrapper}</li>
 *   <li>Bootstrap card / user-stats / auth databases via
 *       {@link RepositoryUtil#bootstrapLocalDb()}</li>
 *   <li>Scan card definitions via {@link CardScanner#scan()}</li>
 *   <li>Instantiate {@link MainManagerFactory} (creates session/user/game
 *       managers internally)</li>
 *   <li>Instantiate {@link MageServerImpl} as a plain in-process POJO — no
 *       JBoss Remoting binding</li>
 * </ol>
 *
 * <p>Plugin loading (game types, tournament types, etc.) is intentionally
 * skipped in Phase 1. {@link MageServerImpl#getServerState()} returns mostly
 * empty plugin lists when this is omitted, which is acceptable for proving
 * the embed works.
 */
public final class EmbeddedServer {

    private final ManagerFactory managerFactory;
    private final MageServerImpl server;

    private EmbeddedServer(ManagerFactory managerFactory, MageServerImpl server) {
        this.managerFactory = managerFactory;
        this.server = server;
    }

    /**
     * Boots the server given a path to a config.xml on disk. Adopts the
     * upstream defaults: not in test mode, not in details mode, no admin
     * password.
     */
    public static EmbeddedServer boot(String configPath) {
        Config rawConfig = ConfigFactory.loadFromFile(configPath);
        ConfigSettings config = new ConfigWrapper(rawConfig);

        RepositoryUtil.bootstrapLocalDb();
        CardScanner.scan();

        ManagerFactory managerFactory = new MainManagerFactory(config);
        MageServerImpl server = new MageServerImpl(managerFactory, /* adminPassword */ "",
                /* testMode */ false, /* detailsMode */ false);

        return new EmbeddedServer(managerFactory, server);
    }

    public MageServerImpl server() {
        return server;
    }

    public ManagerFactory managerFactory() {
        return managerFactory;
    }
}
