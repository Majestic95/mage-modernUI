package mage.webapi.ws;

import io.javalin.websocket.WsContext;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.view.ChatMessage;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.mapper.ChatMessageMapper;
import org.jboss.remoting.callback.AsynchInvokerCallbackHandler;
import org.jboss.remoting.callback.Callback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-{@code WebSession} callback handler that bridges upstream's
 * {@link AsynchInvokerCallbackHandler} contract to one or more
 * registered Javalin {@link WsContext} sockets.
 *
 * <p>This class implements {@link AsynchInvokerCallbackHandler} (not
 * just {@code InvokerCallbackHandler}) because upstream
 * {@code Session.java:81} casts the constructor argument to the async
 * interface.
 *
 * <p>Slice 2 ships the {@code chatMessage} mapping only — every other
 * {@link ClientCallbackMethod} is silently dropped. Each new slice
 * extends {@link #dispatch} with one more case (slice 3:
 * {@code gameInit}/{@code gameUpdate}; slice 4: dialog frames; etc.).
 *
 * <p>Thread-safety: {@link #sockets} is a concurrent set. Upstream
 * callbacks fire on the engine event-dispatch thread; in slice 2 the
 * mapped frames go straight to {@link WsContext#send} which Javalin
 * queues internally. Per-socket bounded backpressure (ADR 0007 D10)
 * lands once high-volume {@code gameUpdate} frames flow.
 */
public final class WebSocketCallbackHandler implements AsynchInvokerCallbackHandler {

    private static final Logger LOG = LoggerFactory.getLogger(WebSocketCallbackHandler.class);

    private final String username;
    private final Set<WsContext> sockets = ConcurrentHashMap.newKeySet();

    public WebSocketCallbackHandler(String username) {
        this.username = username;
    }

    /** Add a freshly-opened socket. Called from Javalin's {@code onConnect}. */
    public void register(WsContext ctx) {
        sockets.add(ctx);
        LOG.debug("WS register: user={}, total sockets={}", username, sockets.size());
    }

    /** Remove a closed socket. Called from Javalin's {@code onClose}. */
    public void unregister(WsContext ctx) {
        sockets.remove(ctx);
        LOG.debug("WS unregister: user={}, total sockets={}", username, sockets.size());
    }

    public int socketCount() {
        return sockets.size();
    }

    String username() {
        return username;
    }

    Set<WsContext> sockets() {
        return sockets;
    }

    // ---------- AsynchInvokerCallbackHandler ----------

    @Override
    public void handleCallback(Callback callback) {
        dispatch(callback);
    }

    @Override
    public void handleCallbackOneway(Callback callback) {
        dispatch(callback);
    }

    @Override
    public void handleCallbackOneway(Callback callback, boolean async) {
        dispatch(callback);
    }

    @Override
    public void handleCallback(Callback callback, boolean serverSide, boolean async) {
        dispatch(callback);
    }

    // ---------- dispatch ----------

    private void dispatch(Callback callback) {
        if (!(callback.getCallbackObject() instanceof ClientCallback cc)) {
            return;
        }
        try {
            cc.decompressData();
        } catch (RuntimeException ex) {
            LOG.warn("WS decompress failure: user={}, method={}, msgId={}: {}",
                    username, cc.getMethod(), cc.getMessageId(), ex.getMessage());
            return;
        }
        WebStreamFrame frame = mapToFrame(cc);
        if (frame == null) {
            // Method not yet mapped for this slice — silent drop
            // (slice 2 ships chatMessage only; slices 3+ extend).
            if (LOG.isDebugEnabled()) {
                LOG.debug("WS drop (no mapper): user={}, method={}, msgId={}",
                        username, cc.getMethod(), cc.getMessageId());
            }
            return;
        }
        broadcast(frame);
    }

    private WebStreamFrame mapToFrame(ClientCallback cc) {
        if (cc.getMethod() == ClientCallbackMethod.CHATMESSAGE) {
            Object data = cc.getData();
            if (!(data instanceof ChatMessage upstream)) {
                LOG.warn("CHATMESSAGE callback with unexpected data type: {}",
                        data == null ? "null" : data.getClass().getName());
                return null;
            }
            return new WebStreamFrame(
                    SchemaVersion.CURRENT,
                    "chatMessage",
                    cc.getMessageId(),
                    cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                    ChatMessageMapper.toDto(upstream)
            );
        }
        return null;
    }

    private void broadcast(WebStreamFrame frame) {
        // Slice 2 forwards every mapped frame to every registered
        // WsContext for this WebSession. Per-game / per-chat scoping
        // (ADR 0007 D6 — chat is "conceptually part of the game
        // session") lands in slice 3 alongside gameInit, when game
        // chat-id resolution becomes available.
        if (sockets.isEmpty()) {
            return;
        }
        for (WsContext ctx : sockets) {
            try {
                ctx.send(frame);
            } catch (RuntimeException ex) {
                LOG.warn("WS send failed for user={}, method={}: {}",
                        username, frame.method(), ex.getMessage());
            }
        }
    }
}
