package mage.webapi.server;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.Javalin;
import io.javalin.http.BadRequestResponse;
import io.javalin.http.Context;
import mage.cards.repository.CardRepository;
import mage.players.PlayerType;
import mage.webapi.SchemaVersion;
import mage.webapi.WebApiException;
import mage.webapi.auth.AuthService;
import mage.webapi.auth.BearerAuthMiddleware;
import mage.webapi.auth.SessionEntry;
import mage.webapi.auth.WebSessionStore;
import mage.webapi.dto.WebAddAiRequest;
import mage.webapi.dto.WebAdminSessionRequest;
import mage.webapi.dto.WebCreateTableRequest;
import mage.webapi.dto.WebError;
import mage.webapi.dto.WebHealth;
import mage.webapi.dto.WebJoinTableRequest;
import mage.webapi.dto.WebSessionRequest;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.lobby.LobbyService;
import mage.webapi.mapper.CardInfoMapper;
import mage.webapi.mapper.DeckMapper;
import mage.webapi.mapper.MatchOptionsBuilder;
import mage.webapi.mapper.ServerStateMapper;
import mage.webapi.mapper.VersionMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Owns the Javalin lifecycle and registers Phase 2 routes against the
 * embedded server. Wires auth (ADR 0004), CORS, lobby/table CRUD
 * (ADR 0006), and the uniform {@link WebError} envelope.
 */
public final class WebApiServer {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiServer.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final int PRINTINGS_LIMIT_DEFAULT = 50;
    static final int PRINTINGS_LIMIT_MAX = 200;

    public static final List<String> DEFAULT_CORS_ORIGINS = List.of(
            "http://localhost:5173",
            "http://localhost:4173",
            "tauri://localhost"
    );

    private final EmbeddedServer embedded;
    private final WebSessionStore sessionStore;
    private final AuthService authService;
    private final LobbyService lobbyService;
    private List<String> corsOrigins = List.of();
    private Javalin app;

    public WebApiServer(EmbeddedServer embedded) {
        this.embedded = Objects.requireNonNull(embedded, "embedded server is required");
        this.sessionStore = new WebSessionStore();
        this.authService = new AuthService(embedded, sessionStore);
        this.lobbyService = new LobbyService(embedded);
    }

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
            authService.logout((String) ctx.attribute("token"));
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

        // Protected — lobby + tables (slice 6, ADR 0006)
        app.get("/api/server/main-room", ctx -> ctx.json(lobbyService.mainRoom()));
        app.get("/api/rooms/{roomId}/tables", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            ctx.json(lobbyService.listTables(roomId));
        });
        app.post("/api/rooms/{roomId}/tables", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            WebCreateTableRequest req = parseBody(ctx.body(), WebCreateTableRequest.class);
            SessionEntry session = sessionFrom(ctx);
            String defaultName = session.username() + "'s table";
            ctx.json(lobbyService.createTable(session.upstreamSessionId(), roomId,
                    MatchOptionsBuilder.build(req, defaultName)));
        });
        app.post("/api/rooms/{roomId}/tables/{tableId}/join", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            WebJoinTableRequest req = parseBody(ctx.body(), WebJoinTableRequest.class);
            SessionEntry session = sessionFrom(ctx);
            String name = (req.name() == null || req.name().isBlank())
                    ? session.username() : req.name().trim();
            int skill = req.skill() == null ? 1 : req.skill();
            lobbyService.joinTable(session.upstreamSessionId(), roomId, tableId, name,
                    skill, DeckMapper.toUpstream(req.deck()), req.password());
            ctx.status(204);
        });
        app.post("/api/rooms/{roomId}/tables/{tableId}/ai", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            WebAddAiRequest req = parseBody(ctx.body(), WebAddAiRequest.class);
            PlayerType aiType = parseEnum(PlayerType.class, req.playerType(), "playerType");
            SessionEntry session = sessionFrom(ctx);
            lobbyService.addAi(session.upstreamSessionId(), roomId, tableId, aiType);
            ctx.status(204);
        });
        app.post("/api/rooms/{roomId}/tables/{tableId}/start", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            SessionEntry session = sessionFrom(ctx);
            lobbyService.startMatch(session.upstreamSessionId(), roomId, tableId);
            ctx.status(204);
        });
        app.delete("/api/rooms/{roomId}/tables/{tableId}/seat", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            SessionEntry session = sessionFrom(ctx);
            lobbyService.leaveSeat(session.upstreamSessionId(), roomId, tableId);
            ctx.status(204);
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
            if (ctx.path().startsWith("/api/")) {
                ctx.json(new WebError(SchemaVersion.CURRENT, "NOT_FOUND",
                        "Route not found: " + ctx.method() + " " + ctx.path()));
            }
        });
    }

    // ---------- helpers ----------

    private static SessionEntry sessionFrom(Context ctx) {
        Object attr = ctx.attribute("session");
        if (!(attr instanceof SessionEntry)) {
            throw new WebApiException(401, "MISSING_TOKEN",
                    "Auth middleware did not attach a session.");
        }
        return (SessionEntry) attr;
    }

    private static <T> T parseBody(String body, Class<T> type) {
        if (body == null || body.isBlank()) {
            throw new WebApiException(400, "BAD_REQUEST", "Request body is required.");
        }
        try {
            return JSON.readValue(body, type);
        } catch (Exception ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Could not parse request body: " + ex.getMessage());
        }
    }

    private static WebSessionRequest parseSessionRequest(String body) {
        if (body == null || body.isBlank()) {
            return WebSessionRequest.empty();
        }
        try {
            return JSON.readValue(body, WebSessionRequest.class);
        } catch (Exception ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Could not parse session request body: " + ex.getMessage());
        }
    }

    private static UUID parseUuid(String raw, String fieldName) {
        if (raw == null || raw.isBlank()) {
            throw new WebApiException(400, "BAD_REQUEST", fieldName + " is required");
        }
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    fieldName + " must be a UUID: " + raw);
        }
    }

    private static <E extends Enum<E>> E parseEnum(Class<E> type, String raw, String fieldName) {
        if (raw == null || raw.isBlank()) {
            throw new WebApiException(400, "BAD_REQUEST", fieldName + " is required");
        }
        try {
            return Enum.valueOf(type, raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new WebApiException(400, "BAD_REQUEST",
                    "Unknown " + fieldName + ": " + raw);
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
