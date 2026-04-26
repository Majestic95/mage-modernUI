package mage.webapi.server;

import io.javalin.Javalin;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebHealth;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.mapper.ServerStateMapper;
import mage.webapi.mapper.VersionMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Objects;

/**
 * Owns the Javalin lifecycle and registers Phase 2 routes against the
 * embedded server. Stateless once constructed; safe to share.
 *
 * <p>Phase 2 routes:
 * <ul>
 *   <li>{@code GET /api/version}      — static upstream + schema version</li>
 *   <li>{@code GET /api/health}       — readiness probe</li>
 *   <li>{@code GET /api/server/state} — game/tournament/player/deck/cube
 *       types loaded by the embedded server</li>
 * </ul>
 *
 * <p>Lobby, table, card-lookup, and game-stream routes land in
 * subsequent slices.
 */
public final class WebApiServer {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiServer.class);

    private final EmbeddedServer embedded;
    private Javalin app;

    public WebApiServer(EmbeddedServer embedded) {
        this.embedded = Objects.requireNonNull(embedded, "embedded server is required");
    }

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
                .get("/api/server/state", ctx ->
                        ctx.json(ServerStateMapper.fromState(embedded.server().getServerState())))
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
