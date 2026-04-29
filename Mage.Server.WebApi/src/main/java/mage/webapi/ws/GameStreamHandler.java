package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
import io.javalin.websocket.WsMessageContext;

import java.time.Duration;
import mage.MageException;
import mage.constants.ManaType;
import mage.constants.PlayerAction;
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

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Javalin {@link WsConfig} that backs {@code /api/games/{gameId}/stream}.
 * Implements ADR 0007 D2 (handshake auth via {@code ?token=}) and D4
 * (the {@link WebStreamFrame} envelope).
 *
 * <p>Slice 1 wired the handshake + the {@code streamHello} envelope.
 * Slice 2 adds inbound {@code chatSend} → upstream
 * {@code chatSendMessage} dispatch and outbound {@code chatMessage}
 * frames (the latter via {@link WebSocketCallbackHandler#dispatch}).
 *
 * <p>Custom WebSocket close codes used:
 * <ul>
 *   <li>{@code 1000} — normal close</li>
 *   <li>{@code 1003} — unsupported data (reserved; in slice 2 unknown
 *       inbound types still soft-fail with {@code streamError})</li>
 *   <li>{@code 4001} — auth failed at upgrade (token missing, unknown,
 *       or expired)</li>
 *   <li>{@code 4003} — request well-formed but rejected (gameId
 *       malformed, or — slice 63 — the authenticated user is not a
 *       seated player in this game; reason
 *       {@code "NOT_A_PLAYER_IN_GAME"})</li>
 *   <li>{@code 4008} — too many sockets per WebSession; the
 *       per-user socket cap (see
 *       {@link WebSocketCallbackHandler#MAX_SOCKETS_PER_USER}) was hit
 *       (slice 63 DoS defence)</li>
 * </ul>
 */
public final class GameStreamHandler implements Consumer<WsConfig> {

    private static final Logger LOG = LoggerFactory.getLogger(GameStreamHandler.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final String ATTR_HANDLER = "webapi.callbackHandler";
    static final String ATTR_GAME_ID = "webapi.gameId";
    static final String ATTR_USERNAME = "webapi.username";
    static final String ATTR_SESSION = "webapi.session";

    /**
     * Hard cap on inbound {@code chatSend} message length. Prevents
     * memory-amplification DoS through chat history. 4 KB is well
     * above any legitimate single chat message; anything larger is
     * almost certainly malicious or a buggy client.
     */
    static final int MAX_CHAT_MESSAGE_CHARS = 4096;

    /**
     * WebSocket idle timeout. Jetty's default is 30 seconds, which is
     * far too short for a game window or lobby chat where the user
     * may sit idle while reading the board / waiting on opponent.
     * Five minutes is generous enough that idle users don't see
     * connection drops, while still cleaning up genuinely-dead
     * sockets (laptop closed, browser killed) within a reasonable
     * window.
     */
    static final Duration IDLE_TIMEOUT = Duration.ofMinutes(5);

    private final AuthService authService;
    private final EmbeddedServer embedded;

    public GameStreamHandler(AuthService authService, EmbeddedServer embedded) {
        this.authService = authService;
        this.embedded = embedded;
    }

    @Override
    public void accept(WsConfig ws) {
        ws.onConnect(this::onConnect);
        ws.onMessage(this::onMessage);
        ws.onClose(this::onClose);
        ws.onError(ctx -> LOG.warn("WS error on /api/games/{}/stream: {}",
                ctx.pathParam("gameId"),
                ctx.error() == null ? "<no detail>" : ctx.error().toString()));
    }

    // ---------- lifecycle ----------

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

        Optional<SessionEntry> resolved = authService.resolveAndBump(token);
        if (resolved.isEmpty()) {
            closeWith(ctx, 4001, "INVALID_TOKEN");
            return;
        }
        SessionEntry session = resolved.get();
        Optional<WebSocketCallbackHandler> handler =
                authService.handlerFor(session.upstreamSessionId());
        if (handler.isEmpty()) {
            // Should not happen — the handler is constructed at login.
            // If we ever hit this, the WebApi-side state and upstream
            // SessionManager state have desynchronised; force re-login.
            closeWith(ctx, 4001, "STREAM_NOT_AVAILABLE");
            return;
        }

        // Slice 63 — auditor #4 / recon agent BLOCKER: gate the WS
        // upgrade on game membership. Pre-slice-63, any authenticated
        // user could open a WS to any gameId they could guess and (with
        // the slice-63 manaType ownership fix above) at minimum receive
        // the entire game state via fan-out — spectator-griefing on
        // arbitrary games. Verifying userPlayerMap.containsKey(userId)
        // BEFORE register() ensures only seated players observe the
        // stream.
        //
        // Spectator support is intentionally out of scope here — the
        // current 1v1-vs-AI flow has no spectator UX. When spectator
        // mode lands, this gate extends with a spectator-allow-list
        // (see GameController.watch()).
        //
        // Fail-closed: any reflection failure / null controller / null
        // session-userId path returns null from resolveSessionPlayerId,
        // which closes the upgrade. The legitimate join-table flow is not
        // affected because userPlayerMap is populated at game-start
        // (TableController.startGame populates it before the upstream
        // ccGameStarted callback fires that triggers the webclient's
        // WS-open).
        // Slice 63 fixer (critic finding #3): membership gate now
        // reuses resolveSessionPlayerId so the upgrade and the
        // dispatchManaType path go through ONE resolver. Previously
        // both call sites independently walked sessionManager →
        // userPlayerMap; that's two reflection paths per upgrade and
        // two places that can drift. Consolidating here means a
        // future change to the resolution semantics (e.g., spectator
        // allow-list) only touches resolveSessionPlayerId.
        UUID playerId = resolveSessionPlayerId(gameId, session);
        if (playerId == null) {
            LOG.warn("WS upgrade rejected: user={} not seated at game={}",
                    session.username(), gameId);
            closeWith(ctx, 4003, "NOT_A_PLAYER_IN_GAME");
            return;
        }

        // Slice 63 — auditor #4 / recon agent BLOCKER: enforce the
        // per-user socket cap BEFORE attaching state to the WsContext
        // and before sending streamHello. WebSocketCallbackHandler.register
        // returns false (and has already closed the socket itself) when
        // the user is at MAX_SOCKETS_PER_USER; in that case we must NOT
        // attach attributes or send the hello — the socket is gone.
        // chatId binding stays attribute-side (cheap idempotent lookup)
        // and is set before register so chat fan-out, if any callback
        // races it, sees the bound chatId.
        ctx.attribute(ATTR_HANDLER, handler.get());
        ctx.attribute(ATTR_GAME_ID, gameId);
        ctx.attribute(ATTR_USERNAME, session.username());
        ctx.attribute(ATTR_SESSION, session);
        bindGameChatId(ctx, gameId);
        if (!handler.get().register(ctx)) {
            return;
        }

        LOG.info("WS connect: user={}, game={}", session.username(), gameId);
        sendFrame(ctx, "streamHello", gameId.toString(),
                new WebStreamHello(gameId.toString(), session.username(), "live"));

        // Slice 22 fix: tell upstream's GameController that the user
        // wants to join the game. Without this call, upstream waits
        // 10 seconds before its recovery timer fires "Forced join"
        // (GameController.sendInfoAboutPlayersNotJoinedYetAndTryToFixIt)
        // — by which time the player session is in a degraded state
        // and player-action UUIDs may not route correctly.
        //
        // Upstream's Swing client invokes mageServer.gameJoin(...)
        // after it receives the ccGameStarted callback; we mirror
        // here at WS-connect time. Failures are non-fatal — if the
        // user isn't a registered player on this game (spectator,
        // wrong gameId, etc.) the call is a no-op upstream-side.
        joinGameUpstream(gameId, session);

        replayBufferIfRequested(ctx, handler.get());
    }

    // userIsInGame + resolveSessionUserId removed in slice 63 fixer
    // pass (critic finding #3): the upgrade gate now calls
    // resolveSessionPlayerId directly and treats null as "no access".
    // Single resolution path.

    private void joinGameUpstream(UUID gameId, SessionEntry session) {
        try {
            embedded.server().gameJoin(gameId, session.upstreamSessionId());
        } catch (Exception ex) {
            LOG.warn("gameJoin failed for user={} game={}: {}",
                    session.username(), gameId, ex.toString());
        }
    }

    /**
     * Resolve the game's chatId via {@code MageServerImpl.chatFindByGame}
     * so the per-WsContext chat-scoping filter in
     * {@link WebSocketCallbackHandler} can suppress unrelated chats.
     * Failures are non-fatal — when no chatId is bound, chat fans out
     * to every socket (slice 2 behavior).
     */
    private void bindGameChatId(WsConnectContext ctx, UUID gameId) {
        try {
            UUID chatId = embedded.server().chatFindByGame(gameId);
            if (chatId != null) {
                ctx.attribute(WebSocketCallbackHandler.ATTR_BOUND_CHAT_ID, chatId);
            }
        } catch (Exception ex) {
            // Game does not exist yet (synthetic gameId in tests, or
            // pre-game flow): leave the attribute unset so chat fans
            // out by default.
            LOG.debug("chatFindByGame({}) failed: {}", gameId, ex.toString());
        }
    }

    /**
     * Honor {@code ?since=<n>} on the upgrade URL — replay buffered
     * frames whose {@code messageId > n}. Cold buffer (no qualifying
     * frames) silently no-ops and the client falls through to live
     * frames; the next {@code gameUpdate} restores state. Slice 4 may
     * tag this gap with an explicit {@code resync} marker (ADR D8).
     */
    private static void replayBufferIfRequested(WsConnectContext ctx,
                                                 WebSocketCallbackHandler handler) {
        String sinceRaw = ctx.queryParam("since");
        if (sinceRaw == null || sinceRaw.isBlank()) {
            return;
        }
        int since;
        try {
            since = Integer.parseInt(sinceRaw.trim());
        } catch (NumberFormatException ex) {
            sendError(ctx, "BAD_REQUEST",
                    "since must be an integer messageId: " + sinceRaw);
            return;
        }
        for (var frame : handler.framesSince(since)) {
            ctx.send(frame);
        }
    }

    private void onMessage(WsMessageContext ctx) {
        String body = ctx.message();
        JsonNode parsed;
        try {
            parsed = JSON.readTree(body);
        } catch (Exception ex) {
            sendError(ctx, "BAD_JSON", "Could not parse frame: " + ex.getMessage());
            return;
        }
        if (!parsed.isObject()) {
            sendError(ctx, "BAD_REQUEST", "Frame must be a JSON object.");
            return;
        }
        JsonNode typeNode = parsed.get("type");
        if (typeNode == null || !typeNode.isTextual()) {
            sendError(ctx, "BAD_REQUEST", "Frame is missing required 'type' field.");
            return;
        }
        String type = typeNode.asText();
        // Slice 22 diagnostic: log every inbound frame at INFO so the
        // server log shows exactly what the user clicked. Without
        // this the server is silent for everything except chat /
        // bad-frame errors, and "the user clicked but nothing
        // happened" symptoms have no log trail. Truncated to 200
        // chars so a 4 KB chatSend doesn't spam the log.
        String username = (String) ctx.attribute(ATTR_USERNAME);
        UUID gameId = (UUID) ctx.attribute(ATTR_GAME_ID);
        // Auditor #2 (2026-04-29) flagged this slice-22 diagnostic as
        // over-verbose at INFO: it fires per-frame on the hot path, and
        // chatSend bodies can carry user-typed text → potential PII.
        // Demoted to DEBUG. The {type, username, gameId} triplet stays
        // at INFO via the surrounding handlers' own logs (chatSend at
        // :handleChatSend, playerAction at :handlePlayerAction, etc.)
        // which don't include body content.
        if (LOG.isDebugEnabled()) {
            String preview = body.length() > 200 ? body.substring(0, 200) + "..." : body;
            LOG.debug("WS msg: user={}, game={}, type={}, body={}",
                    username, gameId, type, preview);
        }
        switch (type) {
            case "chatSend" -> handleChatSend(ctx, parsed);
            case "playerAction" -> handlePlayerAction(ctx, parsed);
            case "playerResponse" -> handlePlayerResponse(ctx, parsed);
            case "keepalive" -> handleKeepalive(ctx);
            default -> sendError(ctx, "NOT_IMPLEMENTED",
                    "Inbound type '" + type + "' is not yet implemented.");
        }
    }

    /**
     * Slice 38 wired the inbound {@code keepalive} frame as a no-op so
     * receiving any byte resets Jetty's idle timer and AFK players do
     * not see the 5-minute idle close.
     *
     * <p>Slice 46 extends that: also call upstream's
     * {@code MageServerImpl.ping(sessionId, null)} so the inbound
     * keepalive bumps {@code User.lastActivity} and the user is no
     * longer reaped by {@code UserManagerImpl.checkExpired} after 3
     * minutes of HTTP-poll-only quiet. Without this, slice 38 only
     * kept the socket alive — the upstream user (and their WAITING
     * tables) still got destroyed.
     *
     * <p>Pass {@code null} as the {@code pingInfo} so
     * {@code User.updateLastActivity} skips the field assignment — no
     * chat banner is appropriate for a server-internal heartbeat.
     *
     * <p>This is a fire-and-forget call: failures must not break the
     * keepalive contract. There is also a harmless microsecond-scale
     * race in {@code User.onLostConnection} (between
     * {@code setUserState(Offline)} at line 209 and
     * {@code removeUser()} at line 210) where a concurrent ping could
     * flip a doomed user back to {@code Connected}; the user is then
     * removed anyway and the empty sessionId means no callback fires.
     * This ping is not a recovery path.
     */
    private void handleKeepalive(WsMessageContext ctx) {
        SessionEntry session = sessionFromCtx(ctx);
        if (session == null) {
            return;
        }
        try {
            embedded.server().ping(session.upstreamSessionId(), null);
        } catch (RuntimeException ex) {
            LOG.debug("upstream ping on keepalive failed: {}", ex.toString());
        }
    }

    private void onClose(WsCloseContext ctx) {
        Object handler = ctx.attribute(ATTR_HANDLER);
        Object gameId = ctx.attribute(ATTR_GAME_ID);
        if (handler instanceof WebSocketCallbackHandler h) {
            h.unregister(ctx);
        }
        LOG.info("WS close: game={}, code={}, reason={}",
                gameId, ctx.status(), ctx.reason());
    }

    // ---------- inbound — chatSend ----------

    private void handleChatSend(WsMessageContext ctx, JsonNode body) {
        JsonNode chatIdNode = body.get("chatId");
        JsonNode messageNode = body.get("message");
        if (chatIdNode == null || !chatIdNode.isTextual()) {
            sendError(ctx, "BAD_REQUEST", "chatSend missing required 'chatId' string.");
            return;
        }
        if (messageNode == null || !messageNode.isTextual()) {
            sendError(ctx, "BAD_REQUEST", "chatSend missing required 'message' string.");
            return;
        }
        UUID chatId;
        try {
            chatId = UUID.fromString(chatIdNode.asText());
        } catch (IllegalArgumentException ex) {
            sendError(ctx, "BAD_REQUEST", "chatId must be a UUID: " + chatIdNode.asText());
            return;
        }
        String message = messageNode.asText();
        if (message.isBlank()) {
            sendError(ctx, "BAD_REQUEST", "chatSend message must be non-blank.");
            return;
        }
        if (message.length() > MAX_CHAT_MESSAGE_CHARS) {
            sendError(ctx, "BAD_REQUEST",
                    "chatSend message exceeds " + MAX_CHAT_MESSAGE_CHARS + " characters.");
            return;
        }
        String username = (String) ctx.attribute(ATTR_USERNAME);
        try {
            embedded.server().chatSendMessage(chatId, username, message);
        } catch (MageException ex) {
            // MageException messages are designed for client display
            // (see upstream usage); pass through.
            sendError(ctx, "UPSTREAM_ERROR",
                    "chatSendMessage failed: " + ex.getMessage());
        } catch (RuntimeException ex) {
            // Upstream chat-not-found / user-not-subscribed surfaces
            // here (NPE inside ChatManager when the chatId is unknown).
            // Don't echo the raw exception message — it could leak
            // internal stack info. Log full server-side, return generic.
            LOG.warn("chatSendMessage unexpected error: user={}, chatId={}",
                    username, chatId, ex);
            sendError(ctx, "UPSTREAM_REJECTED", "chatSendMessage rejected.");
        }
    }

    // ---------- inbound — playerAction (toggles, lifecycle) ----------

    private void handlePlayerAction(WsMessageContext ctx, JsonNode body) {
        UUID gameId = (UUID) ctx.attribute(ATTR_GAME_ID);
        SessionEntry session = sessionFromCtx(ctx);
        if (session == null) {
            sendError(ctx, "INVALID_TOKEN", "WebSocket session lost.");
            return;
        }
        JsonNode actionNode = body.get("action");
        if (actionNode == null || !actionNode.isTextual()) {
            sendError(ctx, "BAD_REQUEST",
                    "playerAction missing required 'action' string.");
            return;
        }
        PlayerAction action;
        try {
            action = PlayerAction.valueOf(actionNode.asText());
        } catch (IllegalArgumentException ex) {
            sendError(ctx, "BAD_REQUEST",
                    "Unknown PlayerAction: " + actionNode.asText());
            return;
        }
        if (!PlayerActionAllowList.contains(action)) {
            sendError(ctx, "NOT_ALLOWED",
                    "PlayerAction '" + action + "' is not on the server-side "
                            + "allow-list (client-only or debug enum).");
            return;
        }
        Object data = decodeActionData(action, body.get("data"));
        try {
            embedded.server().sendPlayerAction(action, gameId,
                    session.upstreamSessionId(), data);
            // ADR 0009 D5 / Fix 1 (T27.3 deadlock): TRIGGER_AUTO_ORDER_*_LAST
            // mutates the engine's deferred-last pile (HumanPlayer.setTriggerAutoOrder
            // at :2811-2856) but never notifies the response monitor that
            // chooseTriggeredAbility waits on at HumanPlayer.java:1550. Upstream
            // Swing unblocks via sendPlayerUUID(gameId, null) (GamePanel.java:3085,
            // :3096). The webclient cannot mirror that on the wire because
            // playerResponse{kind:uuid} is type-validated to require a textual
            // value at :447-456 — a JSON null is rejected with BAD_REQUEST.
            // Synthesize the nudge facade-side. _FIRST actions don't need this;
            // the webclient already follows them with playerResponse{uuid:abilityId}
            // which itself unblocks the monitor.
            if (action == PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_LAST
                    || action == PlayerAction.TRIGGER_AUTO_ORDER_NAME_LAST) {
                embedded.server().sendPlayerUUID(gameId,
                        session.upstreamSessionId(), null);
            }
        } catch (MageException ex) {
            sendError(ctx, "UPSTREAM_ERROR",
                    "sendPlayerAction failed: " + ex.getMessage());
        } catch (RuntimeException ex) {
            // Don't echo raw exception text — could leak stack info.
            LOG.warn("sendPlayerAction unexpected error: user={}, action={}",
                    session.username(), action, ex);
            sendError(ctx, "UPSTREAM_REJECTED", "sendPlayerAction rejected.");
        }
    }

    /**
     * Pull the per-action {@code data} payload out of the inbound
     * envelope. Most {@link PlayerAction} values carry null. The
     * documented exceptions are:
     * <ul>
     *   <li>{@code ROLLBACK_TURNS} — int (number of turns)</li>
     *   <li>{@code REQUEST_AUTO_ANSWER_ID_*} / {@code _TEXT_*} — String
     *       (the id or text the auto-answer applies to)</li>
     *   <li>{@code TRIGGER_AUTO_ORDER_ABILITY_FIRST} / {@code _LAST} —
     *       UUID (ability id, slice 27 / ADR 0009)</li>
     *   <li>{@code TRIGGER_AUTO_ORDER_NAME_FIRST} / {@code _LAST} —
     *       String (the ability's rule text with {@code {this}}
     *       substituted client-side, mirroring upstream Swing)</li>
     * </ul>
     * Anything else is silently passed as null. Slice 7 may add
     * per-action validation; slice 6 ships the dispatch contract.
     */
    static Object decodeActionData(PlayerAction action, JsonNode dataNode) {
        if (dataNode == null || dataNode.isNull()) {
            return null;
        }
        return switch (action) {
            case ROLLBACK_TURNS -> dataNode.isObject() && dataNode.has("turns")
                    ? dataNode.get("turns").asInt()
                    : (dataNode.isInt() ? dataNode.asInt() : null);
            case REQUEST_AUTO_ANSWER_ID_YES, REQUEST_AUTO_ANSWER_ID_NO,
                 REQUEST_AUTO_ANSWER_TEXT_YES, REQUEST_AUTO_ANSWER_TEXT_NO ->
                    dataNode.isObject() && dataNode.has("text")
                            ? dataNode.get("text").asText()
                            : (dataNode.isTextual() ? dataNode.asText() : null);
            case TRIGGER_AUTO_ORDER_ABILITY_FIRST,
                 TRIGGER_AUTO_ORDER_ABILITY_LAST -> {
                String idStr = dataNode.isObject() && dataNode.has("abilityId")
                        ? dataNode.get("abilityId").asText()
                        : (dataNode.isTextual() ? dataNode.asText() : null);
                yield idStr == null ? null : safeUuid(idStr);
            }
            case TRIGGER_AUTO_ORDER_NAME_FIRST,
                 TRIGGER_AUTO_ORDER_NAME_LAST ->
                    dataNode.isObject() && dataNode.has("ruleText")
                            ? dataNode.get("ruleText").asText()
                            : (dataNode.isTextual() ? dataNode.asText() : null);
            default -> null;
        };
    }

    private static UUID safeUuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    // ---------- inbound — playerResponse (dialog answers) ----------

    private void handlePlayerResponse(WsMessageContext ctx, JsonNode body) {
        UUID gameId = (UUID) ctx.attribute(ATTR_GAME_ID);
        SessionEntry session = sessionFromCtx(ctx);
        if (session == null) {
            sendError(ctx, "INVALID_TOKEN", "WebSocket session lost.");
            return;
        }
        JsonNode kindNode = body.get("kind");
        JsonNode valueNode = body.get("value");
        if (kindNode == null || !kindNode.isTextual()) {
            sendError(ctx, "BAD_REQUEST",
                    "playerResponse missing required 'kind' string.");
            return;
        }
        if (valueNode == null) {
            sendError(ctx, "BAD_REQUEST",
                    "playerResponse missing required 'value' field.");
            return;
        }
        String kind = kindNode.asText();
        // Strict type validation per kind. Jackson's asBoolean()/asInt()
        // silently coerce strings ("true" → true, "abc" → 0); without
        // this guard a malicious client could turn a yes/no dialog
        // into "false" by sending `{kind: "boolean", value: "no"}`,
        // and the server would dispatch a real game choice. Hardening
        // fix 2026-04-26.
        try {
            switch (kind) {
                case "uuid" -> {
                    if (!valueNode.isTextual()) {
                        sendError(ctx, "BAD_REQUEST",
                                "playerResponse{kind:uuid} value must be a string.");
                        return;
                    }
                    embedded.server().sendPlayerUUID(
                            gameId, session.upstreamSessionId(),
                            UUID.fromString(valueNode.asText()));
                }
                case "string" -> {
                    if (!valueNode.isTextual()) {
                        sendError(ctx, "BAD_REQUEST",
                                "playerResponse{kind:string} value must be a string.");
                        return;
                    }
                    embedded.server().sendPlayerString(
                            gameId, session.upstreamSessionId(),
                            valueNode.asText());
                }
                case "boolean" -> {
                    if (!valueNode.isBoolean()) {
                        sendError(ctx, "BAD_REQUEST",
                                "playerResponse{kind:boolean} value must be a JSON bool.");
                        return;
                    }
                    embedded.server().sendPlayerBoolean(
                            gameId, session.upstreamSessionId(),
                            valueNode.booleanValue());
                }
                case "integer" -> {
                    if (!valueNode.isInt()) {
                        sendError(ctx, "BAD_REQUEST",
                                "playerResponse{kind:integer} value must be a JSON int.");
                        return;
                    }
                    embedded.server().sendPlayerInteger(
                            gameId, session.upstreamSessionId(),
                            valueNode.intValue());
                }
                case "manaType" -> dispatchManaType(ctx, gameId, session, valueNode);
                default -> {
                    sendError(ctx, "BAD_REQUEST",
                            "Unknown playerResponse kind: " + kind);
                    return;
                }
            }
        } catch (IllegalArgumentException ex) {
            sendError(ctx, "BAD_REQUEST",
                    "playerResponse value did not parse for kind='"
                            + kind + "': " + ex.getMessage());
        } catch (MageException ex) {
            sendError(ctx, "UPSTREAM_ERROR",
                    "sendPlayer" + capitalize(kind) + " failed: "
                            + ex.getMessage());
        } catch (RuntimeException ex) {
            // Don't echo raw exception text — could leak stack info.
            LOG.warn("sendPlayer{} unexpected error: user={}, kind={}",
                    capitalize(kind), session.username(), kind, ex);
            sendError(ctx, "UPSTREAM_REJECTED",
                    "sendPlayer" + capitalize(kind) + " rejected.");
        }
    }

    private void dispatchManaType(WsMessageContext ctx, UUID gameId,
                                   SessionEntry session, JsonNode valueNode)
            throws MageException {
        // Slice 63 — auditor #4 / recon agent BLOCKER: the playerId for a
        // manaType choice MUST be derived from the WebSocket session's
        // upstream userId, never from the inbound frame. The pre-slice-63
        // code trusted a frame-supplied {playerId: ...} which let any
        // authenticated user submit manaType choices on behalf of any
        // other player whose UUID they could observe (gameInit, etc.).
        //
        // Pattern mirrors handlePlayerAction (line 365+): the session →
        // upstreamSessionId → User → playerId chain is server-side only.
        // sendPlayerManaType is the only Game* dispatch method that takes
        // playerId as a parameter (others derive it inside MageServerImpl
        // from sessionId), so we resolve it ourselves via GameLookup's
        // reflective userPlayerMap accessor.
        JsonNode mtNode = valueNode.get("manaType");
        if (mtNode == null || !mtNode.isTextual()) {
            sendError(ctx, "BAD_REQUEST",
                    "playerResponse{kind:manaType} value must be "
                            + "{ manaType: <enum> }.");
            return;
        }
        ManaType mt = ManaType.valueOf(mtNode.asText());

        UUID playerId = resolveSessionPlayerId(gameId, session);
        if (playerId == null) {
            // User isn't seated at this game. Either the session's
            // upstream User is gone, the game has no controller yet, or
            // (the security-relevant case) an authenticated user is
            // trying to act on a game they don't belong to.
            LOG.warn("dispatchManaType: user={} not seated at game={} — rejecting",
                    session.username(), gameId);
            sendError(ctx, "BAD_REQUEST",
                    "User is not a player in this game.");
            return;
        }
        embedded.server().sendPlayerManaType(gameId, playerId,
                session.upstreamSessionId(), mt);
    }

    /**
     * Resolve the {@code playerId} the supplied session's user controls
     * in the supplied game. Returns {@code null} if the session has no
     * upstream user, the game has no controller, or the user isn't in
     * this game's {@code userPlayerMap}.
     *
     * <p>Slice 63 — used by {@link #dispatchManaType} (FIX A) and by
     * the WS-upgrade game-membership gate (FIX B, in {@code onConnect}).
     * Centralised here so both call sites use identical resolution
     * semantics — fixer pass after critic finding #3 collapsed the
     * earlier {@code userIsInGame} duplicate path into this method.
     */
    private UUID resolveSessionPlayerId(UUID gameId, SessionEntry session) {
        UUID userId = embedded.managerFactory().sessionManager()
                .getSession(session.upstreamSessionId())
                .map(mage.server.Session::getUserId)
                .orElse(null);
        if (userId == null) {
            return null;
        }
        Optional<Map<UUID, UUID>> map = GameLookup.findUserPlayerMap(
                gameId, embedded.managerFactory());
        return map.map(m -> m.get(userId)).orElse(null);
    }

    private static SessionEntry sessionFromCtx(WsMessageContext ctx) {
        Object attr = ctx.attribute(ATTR_SESSION);
        return attr instanceof SessionEntry s ? s : null;
    }

    private static String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
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
        LOG.info("WS upgrade rejected: code={}, reason={}", code, reason);
        ctx.closeSession(code, reason);
    }
}
