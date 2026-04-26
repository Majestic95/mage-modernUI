package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.javalin.websocket.WsCloseContext;
import io.javalin.websocket.WsConfig;
import io.javalin.websocket.WsConnectContext;
import io.javalin.websocket.WsContext;
import io.javalin.websocket.WsMessageContext;
import mage.webapi.SchemaVersion;
import mage.webapi.auth.AuthService;
import mage.webapi.auth.SessionEntry;
import mage.webapi.dto.stream.WebStreamError;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.dto.stream.WebStreamHello;
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
 * <p>Slice 1 scope:
 * <ul>
 *   <li>{@code ?token=} resolution + sliding bump (same logic as
 *       {@code BearerAuthMiddleware}); reject with WS close 4001 on
 *       missing/expired/unknown token.</li>
 *   <li>{@code {gameId}} UUID parse; reject with 4003 on malformed UUID.
 *       Game-existence + seat verification deferred to slice 2 once
 *       game-state DTOs land.</li>
 *   <li>On connect: send a {@code streamHello} frame so clients can
 *       observe successful auth without a follow-up request.</li>
 *   <li>On message: parse the inbound tagged-union envelope; reply
 *       with a {@code streamError} frame for unknown {@code type}
 *       values or malformed JSON. Inbound dispatch (chat / player
 *       action / player response) lands in slice 2+.</li>
 *   <li>Register the per-session {@link WebSocketCallbackHandler} (so
 *       slice 2 dispatch can push frames). Slice 1's handler drops
 *       every upstream callback; the registration is harmless.</li>
 * </ul>
 *
 * <p>Custom WebSocket close codes used:
 * <ul>
 *   <li>{@code 1000} — normal close</li>
 *   <li>{@code 1003} — unsupported data (would-be inbound dispatch
 *       reaches a path not yet implemented; currently we keep the
 *       socket open and reply with {@code streamError} instead)</li>
 *   <li>{@code 4001} — auth failed at upgrade (token missing, unknown,
 *       or expired)</li>
 *   <li>{@code 4003} — request well-formed but rejected (gameId
 *       malformed; in slice 2 also: user not seated at this game)</li>
 * </ul>
 */
public final class GameStreamHandler implements Consumer<WsConfig> {

    private static final Logger LOG = LoggerFactory.getLogger(GameStreamHandler.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final String ATTR_HANDLER = "webapi.callbackHandler";
    static final String ATTR_GAME_ID = "webapi.gameId";
    static final String ATTR_USERNAME = "webapi.username";

    private final AuthService authService;

    public GameStreamHandler(AuthService authService) {
        this.authService = authService;
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
        handler.get().register(ctx);

        LOG.info("WS connect: user={}, game={}", session.username(), gameId);
        sendFrame(ctx, "streamHello", gameId.toString(),
                new WebStreamHello(gameId.toString(), session.username(), "skeleton"));
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
        // Slice 1: no inbound dispatch implemented yet. Surface the
        // not-yet-implemented state in-band instead of closing the
        // socket — gives the webclient a clear signal during Phase 3
        // bring-up.
        sendError(ctx, "NOT_IMPLEMENTED",
                "Inbound type '" + type + "' is not yet implemented.");
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
