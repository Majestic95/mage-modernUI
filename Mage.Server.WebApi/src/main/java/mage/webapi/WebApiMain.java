package mage.webapi;

import mage.webapi.embed.EmbeddedServer;
import mage.webapi.server.WebApiServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Entry point for the WebApi server. Boots the in-process Mage server,
 * configures CORS from the environment, and starts Javalin.
 *
 * <p>Configuration is read from environment variables:
 * <ul>
 *   <li>{@code XMAGE_WEBAPI_PORT} — Javalin port. Default {@code 18080}.
 *       Pass {@code 0} to bind to a free port.</li>
 *   <li>{@code XMAGE_CONFIG_PATH} — path to upstream {@code config.xml}.
 *       Default {@code ../Mage.Server/config/config.xml}.</li>
 *   <li>{@code XMAGE_CORS_ORIGINS} — comma-separated CORS allow-list.
 *       Empty string disables CORS entirely. Unset uses the
 *       development-friendly default ({@link
 *       WebApiServer#DEFAULT_CORS_ORIGINS}).</li>
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
        List<String> corsOrigins = readCorsOrigins();

        LOG.info("Booting embedded Mage server (config: {})", configPath);
        EmbeddedServer embedded = EmbeddedServer.boot(configPath);

        WebApiServer server = new WebApiServer(embedded)
                .allowCorsOrigins(corsOrigins)
                .start(port);
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

    private static List<String> readCorsOrigins() {
        String env = System.getenv("XMAGE_CORS_ORIGINS");
        if (env == null) {
            return WebApiServer.DEFAULT_CORS_ORIGINS;
        }
        if (env.isBlank()) {
            return List.of(); // explicit "no CORS"
        }
        return Arrays.stream(env.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableList());
    }
}
