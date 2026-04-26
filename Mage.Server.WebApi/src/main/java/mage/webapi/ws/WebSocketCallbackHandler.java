package mage.webapi.ws;

import io.javalin.websocket.WsContext;
import mage.interfaces.callback.ClientCallback;
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
 * <p>Phase 3 slice 1 ships the lifecycle plumbing only — every upstream
 * callback is logged and dropped (matching {@code NoOpCallbackHandler}'s
 * behavior in slice 5). Slice 2 adds a {@code dispatch(ClientCallback)}
 * method that selects a per-method DTO mapper, encodes a
 * {@link mage.webapi.dto.stream.WebStreamFrame}, and pushes through
 * every registered socket.
 *
 * <p>This class implements {@link AsynchInvokerCallbackHandler} (not
 * just {@code InvokerCallbackHandler}) because upstream
 * {@code Session.java:81} casts the constructor argument to the async
 * interface.
 *
 * <p>Thread-safety: {@link #sockets} is a concurrent set; register and
 * unregister are safe to call from any thread. Upstream callbacks fire
 * on the engine event-dispatch thread; in slice 2 the dispatch method
 * will hand frames off to per-socket bounded queues to keep the engine
 * non-blocking (ADR 0007 D10).
 */
public final class WebSocketCallbackHandler implements AsynchInvokerCallbackHandler {

    private static final Logger LOG = LoggerFactory.getLogger(WebSocketCallbackHandler.class);

    private final String username;
    private final Set<WsContext> sockets =
            ConcurrentHashMap.newKeySet();

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

    /** Snapshot for tests + future dispatch. */
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
        drop(callback);
    }

    @Override
    public void handleCallbackOneway(Callback callback) {
        drop(callback);
    }

    @Override
    public void handleCallbackOneway(Callback callback, boolean async) {
        drop(callback);
    }

    @Override
    public void handleCallback(Callback callback, boolean serverSide, boolean async) {
        drop(callback);
    }

    private void drop(Callback callback) {
        if (LOG.isDebugEnabled() && callback.getCallbackObject() instanceof ClientCallback cc) {
            LOG.debug("WS drop (slice 1, no mappers): user={}, method={}, msgId={}",
                    username, cc.getMethod(), cc.getMessageId());
        }
    }
}
