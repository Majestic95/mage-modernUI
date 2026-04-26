package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
import io.javalin.websocket.WsMessageContext;
import mage.MageException;
import mage.webapi.SchemaVersion;
import mage.webapi.auth.AuthService;
import mage.webapi.auth.SessionEntry;
import mage.webapi.dto.stream.WebStreamError;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.dto.stream.WebStreamHello;
import mage.webapi.embed.EmbeddedServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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
 *       malformed; future slices will also reject when the user is not
 *       seated at this game)</li>
 * </ul>
 */
public final class GameStreamHandler implements Consumer<WsConfig> {

    private static final Logger LOG = LoggerFactory.getLogger(GameStreamHandler.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final String ATTR_HANDLER = "webapi.callbackHandler";
    static final String ATTR_GAME_ID = "webapi.gameId";
    static final String ATTR_USERNAME = "webapi.username";

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

        ctx.attribute(ATTR_HANDLER, handler.get());
        ctx.attribute(ATTR_GAME_ID, gameId);
        ctx.attribute(ATTR_USERNAME, session.username());
        bindGameChatId(ctx, gameId);
        handler.get().register(ctx);

        LOG.info("WS connect: user={}, game={}", session.username(), gameId);
        sendFrame(ctx, "streamHello", gameId.toString(),
                new WebStreamHello(gameId.toString(), session.username(), "live"));

        replayBufferIfRequested(ctx, handler.get());
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
                ctx.attribute(WebSocketCallbackHandler.ATTR_GAME_CHAT_ID, chatId);
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
        switch (type) {
            case "chatSend" -> handleChatSend(ctx, parsed);
            default -> sendError(ctx, "NOT_IMPLEMENTED",
                    "Inbound type '" + type + "' is not yet implemented.");
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
        String username = (String) ctx.attribute(ATTR_USERNAME);
        try {
            embedded.server().chatSendMessage(chatId, username, message);
        } catch (MageException ex) {
            sendError(ctx, "UPSTREAM_ERROR",
                    "chatSendMessage failed: " + ex.getMessage());
        } catch (RuntimeException ex) {
            // Upstream chat-not-found / user-not-subscribed surfaces
            // here (NPE inside ChatManager when the chatId is unknown).
            sendError(ctx, "UPSTREAM_REJECTED",
                    "chatSendMessage rejected: " + ex.getMessage());
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
        LOG.info("WS upgrade rejected: code={}, reason={}", code, reason);
        ctx.closeSession(code, reason);
    }
}
