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
 *   <li>{@code XMAGE_PROFILE} — boot profile, {@code dev} (default) or
 *       {@code prod}. Slice 64 — when {@code prod}, refuses to start
 *       without an explicit {@code XMAGE_CORS_ORIGINS} so a misdeploy
 *       cannot accidentally serve the dev-default localhost origins to
 *       the public internet.</li>
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
        String profile = readProfile();
        // Slice 64 fixer (critic finding #6): readCorsOrigins now takes
        // the profile so it can refuse to fall back to dev-defaults in
        // prod. Pre-fix the guard checked corsOrigins.isEmpty() — but
        // when XMAGE_CORS_ORIGINS was UNSET (the typical misdeploy),
        // readCorsOrigins returned DEFAULT_CORS_ORIGINS (non-empty)
        // and the guard never fired. The exact misdeploy the auditor
        // flagged ("operator forgot CORS in prod") was not caught.
        // Now: in prod, an unset env var throws at readCorsOrigins
        // time; defaults are dev-only.
        List<String> corsOrigins = readCorsOrigins(profile);

        if (profile.equals("dev") && corsOrigins.equals(WebApiServer.DEFAULT_CORS_ORIGINS)) {
            LOG.info("Starting in dev profile with default CORS origins (localhost:5173, :4173). "
                    + "Set XMAGE_PROFILE=prod and XMAGE_CORS_ORIGINS for production.");
        }

        UpstreamVersionCheck.runAtBoot();

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

    private static String readProfile() {
        String env = System.getenv("XMAGE_PROFILE");
        if (env == null || env.isBlank()) {
            return "dev";
        }
        String normalized = env.trim().toLowerCase();
        if (!normalized.equals("dev") && !normalized.equals("prod")) {
            throw new IllegalArgumentException(
                    "XMAGE_PROFILE must be 'dev' or 'prod', got: " + env);
        }
        return normalized;
    }

    private static List<String> readCorsOrigins(String profile) {
        String env = System.getenv("XMAGE_CORS_ORIGINS");
        if (env == null) {
            // Slice 64 fixer (critic finding #6): in prod profile,
            // refuse to fall back to dev-defaults. The auditor's
            // exact misdeploy concern is "operator forgot to set
            // XMAGE_CORS_ORIGINS" — that path now fails fast at
            // boot rather than silently serving dev-default
            // localhost origins to the public internet.
            if (profile.equals("prod")) {
                throw new IllegalArgumentException(
                        "XMAGE_PROFILE=prod requires XMAGE_CORS_ORIGINS to be explicitly set "
                        + "(comma-separated list of allowed origins, or empty string to "
                        + "disable CORS entirely). Refusing to start with dev-default "
                        + "localhost origins in production.");
            }
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
