package mage.webapi.server;

import io.javalin.Javalin;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebHealth;
import mage.webapi.mapper.VersionMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Owns the Javalin lifecycle and registers Phase 2 routes against the
 * embedded server. Stateless once constructed; safe to share.
 *
 * <p>Phase 2 first slice exposes only:
 * <ul>
 *   <li>{@code GET /api/version} — static upstream + schema version</li>
 *   <li>{@code GET /api/health}  — readiness probe</li>
 * </ul>
 *
 * <p>Lobby, table, card-lookup, and game-stream routes land in subsequent
 * Phase 2 commits and will be registered alongside these.
 */
public final class WebApiServer {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiServer.class);

    private Javalin app;

    /**
     * Start Javalin on the given port. Pass {@code 0} to bind to a random
     * free port (used by tests). Returns this for chaining.
     */
    public WebApiServer start(int port) {
        if (app != null) {
            throw new IllegalStateException("WebApiServer is already started on port " + port());
        }
        app = Javalin.create(cfg -> cfg.showJavalinBanner = false)
                .get("/api/version", ctx -> ctx.json(VersionMapper.fromConstants()))
                .get("/api/health", ctx -> ctx.json(new WebHealth(SchemaVersion.CURRENT, "ready")))
                .start(port);
        LOG.info("WebApi listening on port {}", app.port());
        return this;
    }

    /** The actual port Javalin bound to (useful when {@code start(0)} was passed). */
    public int port() {
        if (app == null) {
            throw new IllegalStateException("WebApiServer is not started");
        }
        return app.port();
    }

    public void stop() {
        if (app != null) {
            app.stop();
            app = null;
        }
    }
}
