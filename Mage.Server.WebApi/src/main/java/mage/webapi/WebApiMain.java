package mage.webapi;

import mage.webapi.server.WebApiServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Entry point for the WebApi server. Boots Javalin and registers REST + WS
 * routes. The embedded {@link mage.webapi.embed.EmbeddedServer} is wired
 * in once routes that depend on engine state (lobby, tables, cards, game
 * stream) land in subsequent Phase 2 commits.
 *
 * <p>Configuration is read from environment variables:
 * <ul>
 *   <li>{@code XMAGE_WEBAPI_PORT} — Javalin port. Default {@code 18080}.
 *       Pass {@code 0} to bind to a free port (test usage).</li>
 * </ul>
 */
public final class WebApiMain {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiMain.class);

    private static final int DEFAULT_PORT = 18080;

    private WebApiMain() {
    }

    public static void main(String[] args) {
        int port = readPort();
        WebApiServer server = new WebApiServer().start(port);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOG.info("Shutdown signal received; stopping WebApi");
            server.stop();
        }));
        LOG.info("WebApi started — visit http://localhost:{}/api/version", server.port());
    }

    private static int readPort() {
        String env = System.getenv("XMAGE_WEBAPI_PORT");
        if (env == null || env.isBlank()) {
            return DEFAULT_PORT;
        }
        try {
            return Integer.parseInt(env.trim());
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException(
                    "XMAGE_WEBAPI_PORT must be a non-negative integer, got: " + env, ex);
        }
    }
}
