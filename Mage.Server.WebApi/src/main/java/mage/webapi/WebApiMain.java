package mage.webapi;

import mage.webapi.embed.EmbeddedServer;
import mage.webapi.server.WebApiServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Entry point for the WebApi server. Boots the in-process Mage server,
 * then starts Javalin and registers REST + WS routes against it.
 *
 * <p>Configuration is read from environment variables:
 * <ul>
 *   <li>{@code XMAGE_WEBAPI_PORT} — Javalin port. Default {@code 18080}.
 *       Pass {@code 0} to bind to a free port (test usage).</li>
 *   <li>{@code XMAGE_CONFIG_PATH} — path to the upstream {@code config.xml}.
 *       Default {@code "../Mage.Server/config/config.xml"} (relative to
 *       the module dir; matches the dev-setup layout).</li>
 * </ul>
 */
public final class WebApiMain {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiMain.class);

    private static final int DEFAULT_PORT = 18080;
    private static final String DEFAULT_CONFIG_PATH = "../Mage.Server/config/config.xml";

    private WebApiMain() {
    }

    public static void main(String[] args) {
        String configPath = readConfigPath();
        int port = readPort();

        LOG.info("Booting embedded Mage server (config: {})", configPath);
        EmbeddedServer embedded = EmbeddedServer.boot(configPath);

        WebApiServer server = new WebApiServer(embedded).start(port);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOG.info("Shutdown signal received; stopping WebApi");
            server.stop();
        }));
        LOG.info("WebApi started — visit http://localhost:{}/api/version", server.port());
    }

    private static String readConfigPath() {
        String env = System.getenv("XMAGE_CONFIG_PATH");
        return (env == null || env.isBlank()) ? DEFAULT_CONFIG_PATH : env.trim();
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
