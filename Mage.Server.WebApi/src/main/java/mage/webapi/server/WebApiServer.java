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
     * Card-search query minimum length. Anything shorter would match
     * tens of thousands of names ("a" hits the entire dictionary) and
     * pointlessly hammers the SQLite. Mirrors the client-side gate.
     */
    static final int CARD_SEARCH_MIN_QUERY_LENGTH = 2;
    /**
     * Card-search oversample factor — we ask the DB for {@code limit *
     * OVERSAMPLE} raw rows then dedupe by name. Each card has 1-50
     * printings; 6× covers the typical case while bounding the worst
     * case via {@link #CARD_SEARCH_RAW_CAP}.
     */
    static final int CARD_SEARCH_OVERSAMPLE = 6;
    static final int CARD_SEARCH_RAW_CAP = 600;

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
    /**
     * Slice L8 review (security HIGH #3) — per-IP rate limiter for
     * session-mint. Anonymous tokens are otherwise unbounded.
     * Volatile so tests can swap in a permissive limiter via
     * {@link #setSessionMintLimiter} without reading partial writes.
     */
    private volatile mage.webapi.auth.IpRateLimiter sessionMintLimiter =
            new mage.webapi.auth.IpRateLimiter();

    /**
     * Visible-for-test: tests churn session-mint at high rate (each
     * test mints a fresh anon bearer); production limits would 429
     * the test fixture. Replace with a permissive limiter (e.g.
     * {@code new IpRateLimiter(Integer.MAX_VALUE, 60_000)}) in
     * {@code @BeforeAll} setup.
     */
    public void setSessionMintLimiter(mage.webapi.auth.IpRateLimiter limiter) {
        if (limiter != null) {
            this.sessionMintLimiter = limiter;
        }
    }

    /**
     * Audit fix — per-IP rate limit on the card-search endpoint.
     * {@code LIKE '%q%'} is a full-table scan of ~89k rows (the name
     * index can't be used with a leading wildcard); without a limiter,
     * an authenticated user could fire unlimited expensive scans. 60
     * searches per minute per IP is generous for typing-rate UX
     * (~1/sec) but blocks abuse loops.
     */
    private volatile mage.webapi.auth.IpRateLimiter cardSearchLimiter =
            new mage.webapi.auth.IpRateLimiter(60, 60_000L);

    /** Visible-for-test — same pattern as setSessionMintLimiter. */
    public void setCardSearchLimiter(mage.webapi.auth.IpRateLimiter limiter) {
        if (limiter != null) {
            this.cardSearchLimiter = limiter;
        }
    }
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
            // Slice L8 review (security HIGH #3) — per-IP rate limit
            // on session mint. Anonymous tokens (empty body) used to
            // be unbounded; combined with the per-token WS sub cap
            // this was a trivial DoS amplifier. 20/min/IP is generous
            // for legit users, restrictive for abuse.
            String ip = ctx.ip();
            if (!sessionMintLimiter.tryAcquire(ip)) {
                throw new WebApiException(429, "RATE_LIMITED",
                        "Too many session-mint requests from this IP. "
                                + "Wait a minute and retry.");
            }
            WebSessionRequest req = parseSessionRequest(ctx.body());
            ctx.json(authService.login(req.username(), req.password()));
        });
        app.post("/api/session/admin", ctx -> {
            // Same per-IP cap on admin login attempts; failed admin
            // login is an obvious brute-force amplification surface.
            String ip = ctx.ip();
            if (!sessionMintLimiter.tryAcquire(ip)) {
                throw new WebApiException(429, "RATE_LIMITED",
                        "Too many login attempts from this IP. "
                                + "Wait a minute and retry.");
            }
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
        // Substring card-name search for the deck-editor "add cards"
        // panel. Uses CardCriteria.nameContains (SQL LIKE %q%), then
        // dedupes by name in-memory to return one representative
        // printing per card. Min query length avoids hammering the
        // database with overly-broad matches.
        app.get("/api/cards/search", ctx -> {
            // Audit fix — per-IP rate limit. LIKE '%q%' is a full-table
            // scan (~89k rows); without this, an authed user can fire
            // unlimited expensive scans and amplify into DoS.
            String ip = ctx.ip();
            if (!cardSearchLimiter.tryAcquire(ip)) {
                throw new WebApiException(429, "RATE_LIMITED",
                        "Too many search requests; please slow down.");
            }
            String q = requireParam(ctx.queryParam("q"), "q").trim();
            if (q.length() < CARD_SEARCH_MIN_QUERY_LENGTH) {
                throw new BadRequestResponse(
                        "q must be at least " + CARD_SEARCH_MIN_QUERY_LENGTH
                                + " characters");
            }
            // Audit fix — strip SQL LIKE wildcards from user input.
            // SelectArg parameter-binds against injection (verified),
            // but the LIKE operator itself treats user-supplied '%'
            // and '_' as wildcards. q="%" matched everything, defeating
            // the MIN_QUERY_LENGTH intent. Strip them outright (no
            // current UX needs literal wildcards in card names).
            String safeQ = q.replace("%", "").replace("_", "");
            if (safeQ.length() < CARD_SEARCH_MIN_QUERY_LENGTH) {
                throw new BadRequestResponse(
                        "q must contain at least " + CARD_SEARCH_MIN_QUERY_LENGTH
                                + " non-wildcard characters");
            }
            int limit = clampLimit(ctx.queryParam("limit"));
            int rawCap = Math.min(limit * CARD_SEARCH_OVERSAMPLE, CARD_SEARCH_RAW_CAP);
            var raw = CardRepository.instance.findCards(
                    new mage.cards.repository.CardCriteria()
                            .nameContains(safeQ)
                            .count((long) rawCap));
            // Dedupe by name preserving DB order (first-seen printing).
            // Stop once we have `limit` distinct names.
            // Track an explicit row index so we can decide whether the
            // tail had unprocessed rows (truncated signal) without an
            // O(n) indexOf walk per iteration.
            var seen = new java.util.LinkedHashMap<String, mage.cards.repository.CardInfo>();
            boolean processedAllRaw = true;
            int idx = 0;
            for (var ci : raw) {
                if (ci != null && ci.getName() != null
                        && !seen.containsKey(ci.getName())) {
                    seen.put(ci.getName(), ci);
                    if (seen.size() >= limit) {
                        if (idx < raw.size() - 1) processedAllRaw = false;
                        break;
                    }
                }
                idx++;
            }
            // truncated when (a) raw query itself hit the DB cap (more
            // matches exist beyond what we even fetched), or (b) we
            // filled `limit` before exhausting raw.
            boolean truncated = raw.size() >= rawCap || !processedAllRaw;
            ctx.json(CardInfoMapper.many(
                    new java.util.ArrayList<>(seen.values()), truncated));
        });

        // Protected — lobby + tables (slice 6, ADR 0006)
        app.get("/api/server/main-room", ctx -> ctx.json(lobbyService.mainRoom()));
        app.get("/api/rooms/{roomId}/tables", ctx -> {
            UUID roomId = parseUuid(ctx.pathParam("roomId"), "roomId");
            // Slice L8 review (security HIGH #1) — pass the caller's
            // username so per-seat deck/commander info is redacted on
            // passworded tables the caller isn't seated at.
            SessionEntry session = sessionFrom(ctx);
            ctx.json(lobbyService.listTables(roomId, session.username()));
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
