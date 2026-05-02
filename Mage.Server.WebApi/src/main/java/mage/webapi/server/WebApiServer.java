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
import mage.webapi.dto.WebDeckCardLists;
import mage.webapi.dto.WebError;
import mage.webapi.dto.WebHealth;
import mage.webapi.dto.WebJoinTableRequest;
import mage.webapi.dto.WebMatchOptionsUpdate;
import mage.webapi.dto.WebSeatReadyRequest;
import mage.webapi.dto.WebSessionRequest;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.lobby.DeckValidationService;
import mage.webapi.lobby.LobbyService;
import mage.webapi.mapper.CardInfoMapper;
import mage.webapi.mapper.DeckMapper;
import mage.webapi.mapper.MatchOptionsBuilder;
import mage.webapi.mapper.ServerStateMapper;
import mage.webapi.mapper.VersionMapper;
import mage.webapi.metrics.MetricsHandler;
import mage.webapi.ws.GameStreamHandler;
import mage.webapi.ws.RoomStreamHandler;
import mage.webapi.ws.TableStreamHandler;
import mage.webapi.ws.SpectatorStreamHandler;
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
    // Slice 64 — explicit polymorphic-deserialization hardening.
    // Default-typing is OFF in modern Jackson (and we don't use
    // @JsonTypeInfo anywhere — DTOs are all closed records). Explicit
    // pinning here means a future Jackson upgrade with default-typing-on
    // cannot surprise us into accepting unsafe polymorphic JSON. No-op
    // today, defense-in-depth tomorrow.
    private static final ObjectMapper JSON = new ObjectMapper().deactivateDefaultTyping();

    static final int PRINTINGS_LIMIT_DEFAULT = 50;
    static final int PRINTINGS_LIMIT_MAX = 200;

    /**
     * Default CORS allow-list — Vite dev + Vite preview only.
     *
     * <p>Tauri's webview origin (Phase 7) is intentionally NOT in this
     * default. Javalin's CORS plugin requires every entry to have an
     * explicit port number, and Tauri's custom-scheme URL
     * ({@code tauri://localhost}) has none — it crashes the request
     * with {@code IllegalArgumentException: explicit port is required}.
     * Once Tauri is wired up, the right value (which varies by
     * platform / Tauri major version) goes via the
     * {@code XMAGE_CORS_ORIGINS} env var, not this list.
     */
    public static final List<String> DEFAULT_CORS_ORIGINS = List.of(
            "http://localhost:5173",
            "http://localhost:4173"
    );

    private final EmbeddedServer embedded;
    private final WebSessionStore sessionStore;
    private final AuthService authService;
    private final LobbyService lobbyService;
    private final DeckValidationService deckValidationService;
    private final TableStreamHandler tableStreamHandler;
    private List<String> corsOrigins = List.of();
    private Javalin app;

    public WebApiServer(EmbeddedServer embedded) {
        this.embedded = Objects.requireNonNull(embedded, "embedded server is required");
        this.sessionStore = new WebSessionStore();
        this.authService = new AuthService(embedded, sessionStore);
        this.lobbyService = new LobbyService(embedded);
        this.deckValidationService = new DeckValidationService();
        // Slice L7 — wire the per-table broadcaster. Constructed after
        // LobbyService so the handler can read the same SeatReadyTracker
        // when rebuilding WebTable snapshots; LobbyService gets a back-
        // reference so its mutation methods can fire the broadcast.
        this.tableStreamHandler = new TableStreamHandler(
                authService, embedded, lobbyService.readyTracker());
        lobbyService.setStreamBroadcaster(tableStreamHandler::broadcast);
    }

    public WebApiServer allowCorsOrigins(List<String> origins) {
        this.corsOrigins = List.copyOf(origins);
        // Slice L7 review (security-CRITICAL #1) — propagate to the
        // table stream handler so its WS handshake can enforce the
        // same Origin allowlist that the HTTP CORS plugin enforces.
        // Browsers don't apply same-origin to WebSocket upgrades, so
        // without this an attacker can drive cross-origin WS reads.
        this.tableStreamHandler.allowOrigins(this.corsOrigins);
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
            // Slice 64 — 1 MB hard cap on request bodies. Largest
            // legitimate request is a deck-submit (WebDeckCardLists,
            // ~10 KB for max 120 cards). 1 MB gives 100x headroom while
            // preventing memory-amplification DoS where a tiny gzip
            // stream expands to gigabytes during JSON parse.
            cfg.http.maxRequestSize = 1_048_576L;
            if (!frozenOrigins.isEmpty()) {
                // Javalin 6 — `cfg.plugins` was renamed to
                // `cfg.bundledPlugins` and `cors.add` to `cors.addRule`
                // (migration guide §11). Behavior is identical:
                // each frozenOrigin gets allowHost'd in one CORS rule.
                cfg.bundledPlugins.enableCors(cors -> cors.addRule(it -> {
                    for (String host : frozenOrigins) {
                        it.allowHost(host);
                    }
                }));
            }
        });

        registerExceptionHandlers(app);
        app.before(new BearerAuthMiddleware(authService, embedded));
        registerRoutes(app);
        // WebSocket routes do not run through BearerAuthMiddleware —
        // browsers cannot set custom headers on the upgrade. Auth is
        // enforced inside each handler's onConnect via ?token=.
        app.ws("/api/games/{gameId}/stream", new GameStreamHandler(authService, embedded));
        // Slice 71 (ADR 0010 v2 D4) — spectator route. Sibling
        // endpoint to /stream; same per-WebSocketCallbackHandler
        // dispatch but with read-only inbound, same-gameId XOR
        // (ALREADY_SEATED_NO_SELF_SPECTATE), and the broadcast filter
        // routes spectator-perspective frames here while
        // player-perspective frames go to /stream sockets.
        app.ws("/api/games/{gameId}/spectate",
                new SpectatorStreamHandler(authService, embedded));
        app.ws("/api/rooms/{roomId}/stream", new RoomStreamHandler(authService, embedded));
        // Slice L7 (new-lobby-window) — per-table push stream that
        // replaces the 5s polling on GET /tables for the new lobby
        // screen. Pushes a {@link WebTable} snapshot on connect and
        // on every mutation. Inbound surface is empty.
        app.ws("/api/rooms/{roomId}/tables/{tableId}/stream", tableStreamHandler);

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

        // Protected — admin-gated metrics endpoint (slice 70 / ADR D10).
        // Returns Prometheus text-format counters + the active-games
        // gauge. The handler enforces session.isAdmin() internally and
        // returns 403 ADMIN_REQUIRED for non-admin tokens. Auth itself
        // (401 paths) is handled by the upstream BearerAuthMiddleware.
        app.get("/api/admin/metrics", new MetricsHandler(embedded));

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
        // Slice L3 (new-lobby-window) — host-only edit of the table's
        // editable MatchOptions subset. See WebMatchOptionsUpdate for
        // the field list. Format / mode / winsNeeded are NOT here —
        // locked at table creation.
        app.patch("/api/rooms/{roomId}/tables/{tableId}", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            WebMatchOptionsUpdate req = parseBody(ctx.body(), WebMatchOptionsUpdate.class);
            SessionEntry session = sessionFrom(ctx);
            ctx.json(lobbyService.updateMatchOptions(
                    session.upstreamSessionId(), roomId, tableId, req));
        });
        // Slice L5 (new-lobby-window) — per-seat ready toggle. Caller
        // must occupy a seat at the table; AI seats are auto-ready
        // and never reach this endpoint.
        app.post("/api/rooms/{roomId}/tables/{tableId}/seat/ready", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            WebSeatReadyRequest req = parseBody(ctx.body(), WebSeatReadyRequest.class);
            if (req.ready() == null) {
                throw new WebApiException(400, "BAD_REQUEST",
                        "ready field is required.");
            }
            SessionEntry session = sessionFrom(ctx);
            lobbyService.setSeatReady(session.upstreamSessionId(), roomId,
                    tableId, req.ready());
            ctx.status(204);
        });
        // Slice L6 (new-lobby-window) — submit / re-submit the caller's
        // deck for their seat. Idempotent: covers both first-time take
        // seat and mid-lobby deck swap. On success, the caller's ready
        // flag is reset to false (deck change → re-confirm). Body shape
        // mirrors WebJoinTableRequest.
        app.put("/api/rooms/{roomId}/tables/{tableId}/seat/deck", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            WebJoinTableRequest req = parseBody(ctx.body(), WebJoinTableRequest.class);
            SessionEntry session = sessionFrom(ctx);
            String name = (req.name() == null || req.name().isBlank())
                    ? session.username() : req.name().trim();
            int skill = req.skill() == null ? 1 : req.skill();
            lobbyService.swapDeck(session.upstreamSessionId(), roomId, tableId,
                    name, skill, DeckMapper.toUpstream(req.deck()),
                    req.password());
            ctx.status(204);
        });
        app.delete("/api/rooms/{roomId}/tables/{tableId}/seat", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            SessionEntry session = sessionFrom(ctx);
            lobbyService.leaveSeat(session.upstreamSessionId(), roomId, tableId);
            ctx.status(204);
        });
        app.delete("/api/rooms/{roomId}/tables/{tableId}", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            SessionEntry session = sessionFrom(ctx);
            lobbyService.removeTable(session.upstreamSessionId(), roomId, tableId);
            ctx.status(204);
        });

        // Slice 72-A — pre-flight deck-legality check. Authed; takes a
        // deckType query param (canonical name from /api/server/state)
        // and a WebDeckCardLists body. Always 200 OK with
        // {valid, errors[]} — even when the deck fails validation, the
        // endpoint succeeded; only the deck didn't.
        //
        // Distinct from the join-time DECK_INVALID surface: that's a
        // 422 hard rejection, this is the deck builder's diagnostic
        // loop. Same WebDeckValidationError shape on the wire either
        // way so clients have one renderer.
        app.post("/api/decks/validate", ctx -> {
            String deckType = requireParam(ctx.queryParam("deckType"), "deckType");
            WebDeckCardLists req = parseBody(ctx.body(), WebDeckCardLists.class);
            ctx.json(deckValidationService.validate(deckType, DeckMapper.toUpstream(req)));
        });

        // Sideboard / construction submit (slice 13). Body shape
        // mirrors WebDeckCardLists used at table-join time. The
        // `update` query param picks autosave (true → deckSave) vs
        // final submit (false / omitted → deckSubmit).
        app.post("/api/tables/{tableId}/deck", ctx -> {
            UUID tableId = parseUuid(ctx.pathParam("tableId"), "tableId");
            WebDeckCardLists req = parseBody(ctx.body(), WebDeckCardLists.class);
            boolean update = "true".equalsIgnoreCase(ctx.queryParam("update"));
            SessionEntry session = sessionFrom(ctx);
            lobbyService.submitDeck(session.upstreamSessionId(), tableId,
                    DeckMapper.toUpstream(req), update);
            ctx.status(204);
        });
    }

    // ---------- exception envelope ----------

    private static void registerExceptionHandlers(Javalin app) {
        app.exception(WebApiException.class, (ex, ctx) -> {
            ctx.status(ex.status());
            // Slice 72-A — forward the optional validationErrors payload
            // when present (DECK_INVALID path). For every other error
            // path it's null and Jackson omits the field via NON_NULL.
            ctx.json(new WebError(SchemaVersion.CURRENT, ex.code(), ex.getMessage(),
                    ex.validationErrors()));
            // Slice L3 — flag the context so the catch-all 404 handler
            // below doesn't overwrite our custom body. Without this,
            // a {@code WebApiException(404, "TABLE_NOT_FOUND")} would
            // stage status 404 + custom JSON, then app.error(404, ...)
            // would fire next and stomp the body with the generic
            // route-not-found message.
            ctx.attribute("webapi.error-handled", Boolean.TRUE);
        });
        app.exception(BadRequestResponse.class, (ex, ctx) -> {
            ctx.status(400);
            ctx.json(new WebError(SchemaVersion.CURRENT, "BAD_REQUEST",
                    ex.getMessage() == null ? "Bad request." : ex.getMessage()));
        });
        app.error(404, ctx -> {
            if (ctx.path().startsWith("/api/")
                    && ctx.attribute("webapi.error-handled") == null) {
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
