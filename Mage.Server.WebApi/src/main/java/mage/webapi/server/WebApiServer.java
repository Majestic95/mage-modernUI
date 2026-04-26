package mage.webapi.server;

import io.javalin.Javalin;
import io.javalin.http.BadRequestResponse;
import mage.cards.repository.CardRepository;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebHealth;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.mapper.CardInfoMapper;
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
 *   <li>{@code GET /api/version}             — static upstream + schema version</li>
 *   <li>{@code GET /api/health}              — readiness probe</li>
 *   <li>{@code GET /api/server/state}        — game/tournament/player/deck/cube types</li>
 *   <li>{@code GET /api/cards?name=...}      — single-card lookup by exact name</li>
 *   <li>{@code GET /api/cards/printings?name=...&limit=N}
 *       — every printing of a named card (limit 1..{@link #PRINTINGS_LIMIT_MAX},
 *       default {@link #PRINTINGS_LIMIT_DEFAULT})</li>
 * </ul>
 *
 * <p>Auth, lobby, table-CRUD, and game-stream routes land in subsequent slices.
 */
public final class WebApiServer {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiServer.class);

    static final int PRINTINGS_LIMIT_DEFAULT = 50;
    static final int PRINTINGS_LIMIT_MAX = 200;

    private final EmbeddedServer embedded;
    private Javalin app;

    public WebApiServer(EmbeddedServer embedded) {
        this.embedded = Objects.requireNonNull(embedded, "embedded server is required");
    }

    public WebApiServer start(int port) {
        if (app != null) {
            throw new IllegalStateException("WebApiServer is already started on port " + port());
        }
        app = Javalin.create(cfg -> cfg.showJavalinBanner = false)
                .get("/api/version", ctx -> ctx.json(VersionMapper.fromConstants()))
                .get("/api/health", ctx -> ctx.json(new WebHealth(SchemaVersion.CURRENT, "ready")))
                .get("/api/server/state", ctx ->
                        ctx.json(ServerStateMapper.fromState(embedded.server().getServerState())))
                .get("/api/cards", ctx -> {
                    String name = requireParam(ctx.queryParam("name"), "name");
                    ctx.json(CardInfoMapper.single(CardRepository.instance.findCard(name)));
                })
                .get("/api/cards/printings", ctx -> {
                    String name = requireParam(ctx.queryParam("name"), "name");
                    int limit = clampLimit(ctx.queryParam("limit"));
                    var printings = CardRepository.instance.findCards(name, limit);
                    boolean truncated = printings.size() == limit;
                    ctx.json(CardInfoMapper.many(printings, truncated));
                })
                .start(port);
        LOG.info("WebApi listening on port {}", app.port());
        return this;
    }

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

    private static String requireParam(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new BadRequestResponse("missing required query parameter: " + name);
        }
        return value;
    }

    private static int clampLimit(String raw) {
        if (raw == null || raw.isBlank()) {
            return PRINTINGS_LIMIT_DEFAULT;
        }
        int parsed;
        try {
            parsed = Integer.parseInt(raw.trim());
        } catch (NumberFormatException ex) {
            throw new BadRequestResponse("limit must be an integer: " + raw);
        }
        if (parsed < 1) {
            throw new BadRequestResponse("limit must be >= 1: " + parsed);
        }
        return Math.min(parsed, PRINTINGS_LIMIT_MAX);
    }
}
