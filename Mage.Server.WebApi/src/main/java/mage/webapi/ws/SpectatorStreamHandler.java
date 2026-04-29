package mage.webapi.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
import io.javalin.websocket.WsMessageContext;
import mage.webapi.ProtocolVersion;
import mage.webapi.SchemaVersion;
import mage.webapi.auth.AuthService;
import mage.webapi.auth.SessionEntry;
import mage.webapi.dto.stream.WebStreamError;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.dto.stream.WebStreamHello;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.upstream.GameLookup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Slice 71 (ADR 0010 v2 D4) — Javalin {@link WsConfig} for
 * {@code /api/games/{gameId}/spectate}, the spectator-perspective
 * counterpart to {@link GameStreamHandler}'s player route. Differences
 * from the player route:
 *
 * <ul>
 *   <li><b>Same-gameId XOR (R6).</b> A user currently seated at
 *       {@code gameId} cannot also open a spectator socket on the
 *       same game — close 4003
 *       {@code ALREADY_SEATED_NO_SELF_SPECTATE}. This forbids the
 *       perspective-mismatch leak path other clients can't reproduce
 *       (ADR D4 + R6). Cross-game (player on X, spectator on Y) is
 *       permitted and works correctly via the route-kind broadcast
 *       filter on {@link WebSocketCallbackHandler}.</li>
 *   <li><b>Read-only inbound.</b> Any inbound frame on the spectator
 *       socket is rejected with a {@code streamError SPECTATOR_RO}
 *       envelope; the socket stays open so a misbehaving client
 *       isn't punished with reconnect storms (ADR D4). v2 ships
 *       without a 3-strikes-then-1008 close cap — defer to a
 *       follow-up slice once observed griefing exists.</li>
 *   <li><b>No {@code chatSend}.</b> Spectators do not send chat in
 *       v2 (D4). Existing player-route chat broadcasts are still
 *       received via the per-WsContext chat-id binding, so
 *       spectators see in-game chat passively. v3 may add a
 *       separate spectator-chat room.</li>
 *   <li><b>Upstream registration via {@code gameWatchStart}.</b> The
 *       handler invokes {@code embedded.server().gameWatchStart} so
 *       upstream's {@code GameSessionWatcher} fires GAME_INIT /
 *       GAME_UPDATE callbacks for this user with a spectator-
 *       perspective {@code GameView} (createdForPlayerId=null).
 *       Our mapper surfaces those as frames where
 *       {@code WebGameView.myPlayerId == ""}, which the broadcast
 *       filter routes to spectator sockets only.</li>
 * </ul>
 *
 * <p><b>Custom WS close codes added by this handler:</b>
 * <ul>
 *   <li>{@code 4003 ALREADY_SEATED_NO_SELF_SPECTATE} — XOR violation.</li>
 *   <li>All other codes (4001 missing/invalid token, 4400 protocol
 *       mismatch, 4008 too many sockets) match
 *       {@link GameStreamHandler}.</li>
 * </ul>
 *
 * <p><b>NOT in v2 scope (deferred):</b>
 * <ul>
 *   <li>{@code gameInformPersonal} → PULSE frames (ADR D2). v2
 *       spectators receive {@code gameInformPersonal} as-is via the
 *       broadcast filter; client-side rendering for spectators is
 *       a slice 73-77 polish task.</li>
 *   <li>Reconnect-after-elimination → spectator path (ADR D11c).
 *       Eliminated players today close their socket and stop
 *       receiving frames; v3 may auto-route them here.</li>
 *   <li>{@code WATCHGAME} callback routing via {@code ATTR_ROUTE_KIND}.
 *       Upstream's WATCHGAME callback fires in lobby contexts (table
 *       state changes), not the game stream. Game-stream updates
 *       reuse GAME_INIT / GAME_UPDATE which we already map.</li>
 *   <li>Per-game allow-list registration in {@code LobbyService}.
 *       v2 ships wide-open per ADR D4: any authenticated user
 *       passing the XOR check + upstream's spectatorsAllowed flag
 *       can spectate. v3 may tighten to per-game invitation.</li>
 *   <li>3-strikes-then-1008 close on inbound abuse. v2 always
 *       responds with {@code streamError SPECTATOR_RO} and keeps
 *       the socket open.</li>
 *   <li>Route-labeled metrics
 *       ({@code xmage_frames_egressed_total{route}}) and the
 *       {@code xmage_total_spectators} gauge. Slice 70 deferred
 *       these; revisit when the live metrics dashboard exists.</li>
 * </ul>
 */
public final class SpectatorStreamHandler implements Consumer<WsConfig> {

    private static final Logger LOG = LoggerFactory.getLogger(SpectatorStreamHandler.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Duration IDLE_TIMEOUT = Duration.ofMinutes(5);

    private final AuthService authService;
    private final EmbeddedServer embedded;

    public SpectatorStreamHandler(AuthService authService, EmbeddedServer embedded) {
        this.authService = authService;
        this.embedded = embedded;
    }

    @Override
    public void accept(WsConfig ws) {
        ws.onConnect(this::onConnect);
        ws.onMessage(this::onMessage);
        ws.onClose(this::onClose);
        ws.onError(ctx -> LOG.warn("WS error on /api/games/{}/spectate: {}",
                ctx.pathParam("gameId"),
                ctx.error() == null ? "<no detail>" : ctx.error().toString()));
    }

    private void onConnect(WsConnectContext ctx) {
        ctx.session.setIdleTimeout(IDLE_TIMEOUT);
        String gameIdRaw = ctx.pathParam("gameId");
        UUID gameId;
        try {
            gameId = UUID.fromString(gameIdRaw);
        } catch (IllegalArgumentException ex) {
            closeWith(ctx, 4003, "gameId must be a UUID: " + gameIdRaw);
            return;
        }

        String token = ctx.queryParam("token");
        if (token == null || token.isBlank()) {
            closeWith(ctx, 4001, "MISSING_TOKEN");
            return;
        }

        // Mirror GameStreamHandler's protocolVersion handshake. Same
        // contract, same close code (4400) — the spectator route is
        // a sibling endpoint and a v1-only client should fail-fast
        // here too rather than silently negotiating to v1 frame
        // semantics.
        Integer protocolVersion = GameStreamHandler.parseProtocolVersion(
                ctx.queryParam("protocolVersion"));
        if (protocolVersion == null) {
            closeWith(ctx, 4400, "PROTOCOL_VERSION_UNSUPPORTED:supported="
                    + GameStreamHandler.formatSupportedVersions());
            return;
        }

        Optional<SessionEntry> resolved = authService.resolveAndBump(token);
        if (resolved.isEmpty()) {
            closeWith(ctx, 4001, "INVALID_TOKEN");
            return;
        }
        SessionEntry session = resolved.get();
        Optional<WebSocketCallbackHandler> handler =
                authService.handlerFor(session.upstreamSessionId());
        if (handler.isEmpty()) {
            closeWith(ctx, 4001, "STREAM_NOT_AVAILABLE");
            return;
        }

        // Slice 71 — same-gameId player-or-spectator XOR (ADR D4 + R6).
        // If the user is currently a seated player on this gameId,
        // refuse the spectate connect. The user can still spectate a
        // DIFFERENT game while seated here. ADR R6 documents the
        // weaponizable path: a seated player opening spectate on
        // their own game would receive a perspective other clients
        // can't reproduce (e.g. via processWatchedHands), giving
        // them out-of-band tooling state. The XOR closes that path.
        UUID userId = embedded.managerFactory().userManager()
                .getUserByName(session.username())
                .map(mage.server.User::getId)
                .orElse(null);
        if (userId == null) {
            closeWith(ctx, 4001, "USER_NOT_FOUND");
            return;
        }
        if (isSeatedAtGame(gameId, userId)) {
            LOG.info("Spectator XOR rejected: user={} already seated at game={}",
                    session.username(), gameId);
            closeWith(ctx, 4003, "ALREADY_SEATED_NO_SELF_SPECTATE");
            return;
        }

        // Bind attributes BEFORE register (mirrors GameStreamHandler
        // ordering — register can reject + pre-close on the per-
        // WebSession socket cap, in which case the attribute set is
        // moot but harmless to have populated).
        ctx.attribute(GameStreamHandler.ATTR_USERNAME, session.username());
        ctx.attribute(GameStreamHandler.ATTR_SESSION, session);
        ctx.attribute(GameStreamHandler.ATTR_GAME_ID, gameId);
        ctx.attribute(GameStreamHandler.ATTR_HANDLER, handler.get());
        ctx.attribute(WebSocketCallbackHandler.ATTR_ROUTE_KIND,
                WebSocketCallbackHandler.ROUTE_SPECTATOR);
        bindGameChatId(ctx, gameId);
        if (!handler.get().register(ctx)) {
            return;
        }

        LOG.info("WS spectate connect: user={}, game={}, protocolVersion={}",
                session.username(), gameId, protocolVersion);
        sendFrame(ctx, "streamHello", gameId.toString(),
                new WebStreamHello(gameId.toString(), session.username(), "live",
                        protocolVersion));

        // Register with upstream as a watcher. Upstream creates a
        // GameSessionWatcher (Mage.Server/.../GameSessionWatcher.java)
        // that fires GAME_INIT immediately + GAME_UPDATE on every
        // engine state change for this user. Those callbacks land on
        // our WebSocketCallbackHandler (per-user) and route to this
        // socket via the route-kind broadcast filter (slice 71).
        //
        // Failures are non-fatal: the table may not allow spectators
        // (MatchOptions.spectatorsAllowed=false), the gameId may not
        // exist, etc. WARN-log so ops can investigate but keep the
        // socket open — the streamHello is already in flight and the
        // user sees an empty stream until they reconnect.
        try {
            boolean ok = embedded.server().gameWatchStart(
                    gameId, session.upstreamSessionId());
            if (!ok) {
                LOG.warn("gameWatchStart returned false for user={} game={} — "
                        + "table may not allow spectators or game does not exist",
                        session.username(), gameId);
            }
        } catch (Exception ex) {
            LOG.warn("gameWatchStart failed for user={} game={}: {}",
                    session.username(), gameId, ex.toString());
        }
    }

    /**
     * Slice 71 — read-only inbound rejection (ADR D4). Spectators
     * cannot send {@code playerAction} / {@code playerResponse} /
     * {@code chatSend}. Every inbound frame is rejected with a
     * {@code streamError} envelope; the socket stays open so a
     * misbehaving client doesn't reconnect-storm.
     *
     * <p>v2 ships without a 3-strikes-then-1008 close — observed
     * abuse hasn't materialized in personal-fork scope. Defer the
     * cap to a follow-up slice once load patterns surface.
     */
    private void onMessage(WsMessageContext ctx) {
        sendError(ctx, "SPECTATOR_RO",
                "Spectators cannot send frames on /api/games/{gameId}/spectate. "
                        + "Inbound frames are read-only per ADR 0010 v2 D4.");
    }

    private void onClose(WsCloseContext ctx) {
        UUID gameId = (UUID) ctx.attribute(GameStreamHandler.ATTR_GAME_ID);
        Object sessionAttr = ctx.attribute(GameStreamHandler.ATTR_SESSION);
        Object handlerAttr = ctx.attribute(GameStreamHandler.ATTR_HANDLER);
        String username = (String) ctx.attribute(GameStreamHandler.ATTR_USERNAME);
        if (handlerAttr instanceof WebSocketCallbackHandler h) {
            h.unregister(ctx);
        }
        // Tell upstream the user has stopped watching so the
        // GameSessionWatcher cleans up + further state changes don't
        // accumulate frames for a closed socket. Best-effort;
        // failure (game already ended, etc.) is not fatal.
        if (gameId != null && sessionAttr instanceof SessionEntry session) {
            try {
                embedded.server().gameWatchStop(gameId, session.upstreamSessionId());
            } catch (Exception ex) {
                LOG.debug("gameWatchStop failed (likely already stopped): {}",
                        ex.toString());
            }
        }
        LOG.info("WS spectate close: user={}, game={}, code={}, reason={}",
                username, gameId, ctx.closeStatus(), ctx.reason());
    }

    /**
     * Resolve whether the supplied user UUID is currently a seated
     * player on the supplied game. Reads the upstream {@code userPlayerMap}
     * via the existing {@link GameLookup} reflection path.
     *
     * <p><b>Fail-OPEN on reflection failure:</b> any reflection
     * failure / null path returns {@code false}, which means the
     * XOR check passes and the spectator connect is permitted. The
     * alternative (fail-closed + reject the spectator) trades a real
     * DoS — spectators can't watch any game when reflection breaks —
     * for a theoretical leak-when-also-seated case that requires the
     * user to be in {@code userPlayerMap} (which only happens for
     * genuinely-seated players, and the SAME reflection path is what
     * {@link GameStreamHandler#resolveSessionPlayerId} uses to gate
     * the player route — if reflection breaks, no one is seated
     * anyway because they couldn't have opened a player socket).
     * Low risk vs functional liveness; matches ADR R8's policy.
     */
    private boolean isSeatedAtGame(UUID gameId, UUID userId) {
        if (gameId == null || userId == null) {
            return false;
        }
        Optional<Map<UUID, UUID>> map = GameLookup.findUserPlayerMap(
                gameId, embedded.managerFactory());
        return map.map(m -> m.containsKey(userId)).orElse(false);
    }

    private void bindGameChatId(WsConnectContext ctx, UUID gameId) {
        try {
            UUID chatId = embedded.server().chatFindByGame(gameId);
            if (chatId != null) {
                ctx.attribute(WebSocketCallbackHandler.ATTR_BOUND_CHAT_ID, chatId);
            }
        } catch (Exception ex) {
            LOG.debug("chatFindByGame({}) failed: {}", gameId, ex.toString());
        }
    }

    // ---------- frame helpers ----------

    private static void sendFrame(WsContext ctx, String method, String objectId, Object data) {
        WebStreamFrame frame = new WebStreamFrame(
                SchemaVersion.CURRENT, method, 0, objectId, data);
        ctx.send(frame);
    }

    private static void sendError(WsContext ctx, String code, String message) {
        sendFrame(ctx, "streamError", null, new WebStreamError(code, message));
    }

    private static void closeWith(WsContext ctx, int code, String reason) {
        LOG.info("WS spectate upgrade rejected: code={}, reason={}", code, reason);
        ctx.closeSession(code, reason);
    }
}
