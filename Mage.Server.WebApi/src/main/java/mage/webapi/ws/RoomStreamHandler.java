package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
import io.javalin.websocket.WsMessageContext;
import mage.MageException;
import mage.server.Session;
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
 * Javalin {@link WsConfig} that backs {@code /api/rooms/{roomId}/stream}
 * — the room/lobby chat WebSocket route. Mirrors
 * {@link GameStreamHandler} but scoped to a room rather than a game,
 * and limited to the chat surface (rooms have no player actions).
 *
 * <p>On connect, looks up the room's chatId via
 * {@code MageServerImpl.chatFindByRoom}, subscribes the user to that
 * chat upstream-side via {@code chatManager.joinChat(chatId, userId)},
 * and binds the chatId to the {@link WsContext} so the per-WsContext
 * filter in {@link WebSocketCallbackHandler} forwards only chats from
 * that room (suppressing any game chats the user is also subscribed
 * to).
 *
 * <p>Inbound surface is just {@code chatSend}. Other inbound types
 * are NOT_IMPLEMENTED here — the room context doesn't carry game
 * state.
 *
 * <p>Close codes mirror the game stream:
 * <ul>
 *   <li>{@code 1000} — normal close</li>
 *   <li>{@code 4001} — auth failed at upgrade</li>
 *   <li>{@code 4003} — roomId malformed or chat not resolvable</li>
 * </ul>
 */
public final class RoomStreamHandler implements Consumer<WsConfig> {

    private static final Logger LOG = LoggerFactory.getLogger(RoomStreamHandler.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final String ATTR_HANDLER = "webapi.callbackHandler";
    static final String ATTR_ROOM_ID = "webapi.roomId";
    static final String ATTR_USERNAME = "webapi.username";
    static final String ATTR_SESSION = "webapi.session";

    private final AuthService authService;
    private final EmbeddedServer embedded;

    public RoomStreamHandler(AuthService authService, EmbeddedServer embedded) {
        this.authService = authService;
        this.embedded = embedded;
    }

    @Override
    public void accept(WsConfig ws) {
        ws.onConnect(this::onConnect);
        ws.onMessage(this::onMessage);
        ws.onClose(this::onClose);
        ws.onError(ctx -> LOG.warn("WS error on /api/rooms/{}/stream: {}",
                ctx.pathParam("roomId"),
                ctx.error() == null ? "<no detail>" : ctx.error().toString()));
    }

    // ---------- lifecycle ----------

    private void onConnect(WsConnectContext ctx) {
        ctx.session.setIdleTimeout(GameStreamHandler.IDLE_TIMEOUT);
        String roomIdRaw = ctx.pathParam("roomId");
        UUID roomId;
        try {
            roomId = UUID.fromString(roomIdRaw);
        } catch (IllegalArgumentException ex) {
            closeWith(ctx, 4003, "roomId must be a UUID: " + roomIdRaw);
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
            closeWith(ctx, 4001, "STREAM_NOT_AVAILABLE");
            return;
        }

        // Resolve the room's chatId and subscribe the user upstream-
        // side. Both calls must succeed for the user to receive any
        // chat frames; if either fails we close the upgrade.
        UUID chatId;
        try {
            chatId = embedded.server().chatFindByRoom(roomId);
        } catch (MageException ex) {
            closeWith(ctx, 4003, "Could not resolve chat for room: " + roomId);
            return;
        }
        if (chatId == null) {
            closeWith(ctx, 4003, "No chat registered for room: " + roomId);
            return;
        }

        UUID userId = resolveUserId(session.upstreamSessionId());
        if (userId == null) {
            closeWith(ctx, 4001, "Upstream session has no user");
            return;
        }
        try {
            embedded.managerFactory().chatManager().joinChat(chatId, userId);
        } catch (RuntimeException ex) {
            LOG.warn("joinChat failed: user={}, chatId={}: {}",
                    session.username(), chatId, ex.getMessage());
            // Non-fatal — the user is already in the chat in many
            // cases (idempotent on upstream side), so continue.
        }

        ctx.attribute(ATTR_HANDLER, handler.get());
        ctx.attribute(ATTR_ROOM_ID, roomId);
        ctx.attribute(ATTR_USERNAME, session.username());
        ctx.attribute(ATTR_SESSION, session);
        ctx.attribute(WebSocketCallbackHandler.ATTR_BOUND_CHAT_ID, chatId);
        handler.get().register(ctx);

        LOG.info("WS room connect: user={}, room={}, chat={}",
                session.username(), roomId, chatId);
        sendFrame(ctx, "streamHello", roomId.toString(),
                new WebStreamHello(roomId.toString(), session.username(), "live"));
    }

    private UUID resolveUserId(String upstreamSessionId) {
        Optional<Session> upstream =
                embedded.managerFactory().sessionManager().getSession(upstreamSessionId);
        return upstream.map(Session::getUserId).orElse(null);
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
            // Room context has no game state; player actions are
            // game-specific. Reject them explicitly so a misrouted
            // client gets a clear signal.
            default -> sendError(ctx, "NOT_IMPLEMENTED",
                    "Inbound type '" + type + "' is not supported on the room stream.");
        }
    }

    private void onClose(WsCloseContext ctx) {
        Object handler = ctx.attribute(ATTR_HANDLER);
        Object roomId = ctx.attribute(ATTR_ROOM_ID);
        if (handler instanceof WebSocketCallbackHandler h) {
            h.unregister(ctx);
        }
        LOG.info("WS room close: room={}, code={}, reason={}",
                roomId, ctx.status(), ctx.reason());
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
        if (message.length() > GameStreamHandler.MAX_CHAT_MESSAGE_CHARS) {
            sendError(ctx, "BAD_REQUEST",
                    "chatSend message exceeds "
                            + GameStreamHandler.MAX_CHAT_MESSAGE_CHARS + " characters.");
            return;
        }
        String username = (String) ctx.attribute(ATTR_USERNAME);
        try {
            embedded.server().chatSendMessage(chatId, username, message);
        } catch (MageException ex) {
            sendError(ctx, "UPSTREAM_ERROR",
                    "chatSendMessage failed: " + ex.getMessage());
        } catch (RuntimeException ex) {
            LOG.warn("chatSendMessage unexpected error: user={}, chatId={}",
                    username, chatId, ex);
            sendError(ctx, "UPSTREAM_REJECTED", "chatSendMessage rejected.");
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
        LOG.info("WS room upgrade rejected: code={}, reason={}", code, reason);
        ctx.closeSession(code, reason);
    }
}
