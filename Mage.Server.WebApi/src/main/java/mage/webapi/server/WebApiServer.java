package mage.webapi.server;

import io.javalin.Javalin;
import io.javalin.http.BadRequestResponse;
import mage.cards.repository.CardRepository;
import mage.webapi.SchemaVersion;
import mage.webapi.WebApiException;
import mage.webapi.auth.AuthService;
import mage.webapi.auth.BearerAuthMiddleware;
import mage.webapi.auth.WebSessionStore;
import mage.webapi.dto.WebAdminSessionRequest;
import mage.webapi.dto.WebError;
import mage.webapi.dto.WebHealth;
import mage.webapi.dto.WebSessionRequest;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.mapper.CardInfoMapper;
import mage.webapi.mapper.ServerStateMapper;
import mage.webapi.mapper.VersionMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Objects;

/**
 * Owns the Javalin lifecycle and registers Phase 2 routes against the
 * embedded server. Wires auth (ADR 0004), CORS, and the uniform
 * {@link WebError} envelope for all 4xx/5xx responses.
 *
 * <p>Owned components: {@link WebSessionStore}, {@link AuthService}.
 * Tests can call {@link #auth()} to drive login/logout directly when
 * exercising protected routes.
 */
public final class WebApiServer {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiServer.class);

    static final int PRINTINGS_LIMIT_DEFAULT = 50;
    static final int PRINTINGS_LIMIT_MAX = 200;

    /** Default CORS allow-list — Vite dev, Vite preview, Tauri prod. */
    public static final List<String> DEFAULT_CORS_ORIGINS = List.of(
            "http://localhost:5173",
            "http://localhost:4173",
            "tauri://localhost"
    );

    private final EmbeddedServer embedded;
    private final WebSessionStore sessionStore;
    private final AuthService authService;
    private List<String> corsOrigins = List.of();
    private Javalin app;

    public WebApiServer(EmbeddedServer embedded) {
        this.embedded = Objects.requireNonNull(embedded, "embedded server is required");
        this.sessionStore = new WebSessionStore();
        this.authService = new AuthService(embedded, sessionStore);
    }

    /** Set CORS allow-list. Empty disables the plugin (locked-down). */
    public WebApiServer allowCorsOrigins(List<String> origins) {
        this.corsOrigins = List.copyOf(origins);
        return this;
    }

    public AuthService auth() {
        return authService;
    }

    public WebApiServer start(int port) {
        if (app != null) {
            throw new IllegalStateException("WebApiServer is already started on port " + port());
        }
        List<String> frozenOrigins = corsOrigins;
        app = Javalin.create(cfg -> {
            cfg.showJavalinBanner = false;
            if (!frozenOrigins.isEmpty()) {
                cfg.plugins.enableCors(cors -> cors.add(it -> {
                    for (String host : frozenOrigins) {
                        it.allowHost(host);
                    }
                }));
            }
        });

        registerExceptionHandlers(app);
        app.before(new BearerAuthMiddleware(authService));
        registerRoutes(app);

        app.start(port);
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
        authService.close();
    }

    // ---------- routes ----------

    private void registerRoutes(Javalin app) {
        // Public — informational
        app.get("/api/version", ctx -> ctx.json(VersionMapper.fromConstants()));
        app.get("/api/health", ctx -> ctx.json(new WebHealth(SchemaVersion.CURRENT, "ready")));

        // Public — auth
        app.post("/api/session", ctx -> {
            WebSessionRequest req = parseSessionRequest(ctx.body());
            ctx.json(authService.login(req.username(), req.password()));
        });
        app.post("/api/session/admin", ctx -> {
            WebAdminSessionRequest req = ctx.bodyAsClass(WebAdminSessionRequest.class);
            ctx.json(authService.loginAdmin(req == null ? null : req.adminPassword()));
        });

        // Protected — auth required
        app.get("/api/session/me", ctx -> ctx.json(ctx.attribute("webSession")));
        app.delete("/api/session", ctx -> {
            String token = (String) ctx.attribute("token");
            authService.logout(token);
            ctx.status(204);
        });

        // Protected — server state + cards
        app.get("/api/server/state", ctx ->
                ctx.json(ServerStateMapper.fromState(embedded.server().getServerState())));
        app.get("/api/cards", ctx -> {
            String name = requireParam(ctx.queryParam("name"), "name");
            ctx.json(CardInfoMapper.single(CardRepository.instance.findCard(name)));
        });
        app.get("/api/cards/printings", ctx -> {
            String name = requireParam(ctx.queryParam("name"), "name");
            int limit = clampLimit(ctx.queryParam("limit"));
            var printings = CardRepository.instance.findCards(name, limit);
            boolean truncated = printings.size() == limit;
            ctx.json(CardInfoMapper.many(printings, truncated));
        });
    }

    // ---------- exception envelope ----------

    private static void registerExceptionHandlers(Javalin app) {
        app.exception(WebApiException.class, (ex, ctx) -> {
            ctx.status(ex.status());
            ctx.json(new WebError(SchemaVersion.CURRENT, ex.code(), ex.getMessage()));
        });
        app.exception(BadRequestResponse.class, (ex, ctx) -> {
            ctx.status(400);
            ctx.json(new WebError(SchemaVersion.CURRENT, "BAD_REQUEST",
                    ex.getMessage() == null ? "Bad request." : ex.getMessage()));
        });
        app.error(404, ctx -> {
            // Override 404 default envelope only for our /api/* surface.
            if (ctx.path().startsWith("/api/")) {
                ctx.json(new WebError(SchemaVersion.CURRENT, "NOT_FOUND",
                        "Route not found: " + ctx.method() + " " + ctx.path()));
            }
        });
    }

    // ---------- helpers ----------

    private static WebSessionRequest parseSessionRequest(String body) {
        if (body == null || body.isBlank()) {
            return WebSessionRequest.empty();
        }
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(body, WebSessionRequest.class);
        } catch (Exception ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Could not parse session request body: " + ex.getMessage());
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
