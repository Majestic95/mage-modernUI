package mage.webapi.ws;

import io.javalin.websocket.WsContext;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.view.ChatMessage;
import mage.view.GameClientMessage;
import mage.view.GameEndView;
import mage.view.GameView;
import mage.view.TableClientMessage;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.mapper.ChatMessageMapper;
import mage.webapi.mapper.GameViewMapper;
import org.jboss.remoting.callback.AsynchInvokerCallbackHandler;
import org.jboss.remoting.callback.Callback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.UUID;
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
 * <p>Slice 2 shipped {@code chatMessage}. Slice 3 adds game-lifecycle
 * mapping ({@code startGame} / {@code gameInit} / {@code gameUpdate}),
 * the per-handler ring buffer that backs reconnect-via-{@code ?since=},
 * and chat scoping by per-WsContext bound chatId. Each new slice
 * extends {@link #mapToFrame} with one more {@link ClientCallbackMethod}
 * case.
 *
 * <p>Thread-safety: {@link #sockets} is a concurrent set;
 * {@link #buffer} writes/reads are synchronized on the deque. Upstream
 * callbacks fire on the engine event-dispatch thread; mapped frames
 * go straight to {@link WsContext#send} which Javalin queues
 * internally. Per-socket bounded backpressure (ADR 0007 D10) lands
 * once profiling shows it's needed.
 */
public final class WebSocketCallbackHandler implements AsynchInvokerCallbackHandler {

    private static final Logger LOG = LoggerFactory.getLogger(WebSocketCallbackHandler.class);

    /** Maximum buffered frames retained for reconnect-via-{@code ?since=}. */
    static final int BUFFER_CAPACITY = 64;

    /**
     * Per-WsContext attribute key — the chatId of the game this socket
     * is bound to, resolved at connect time via
     * {@code MageServerImpl.chatFindByGame}. When present, only
     * {@code chatMessage} frames whose {@code objectId} matches are
     * forwarded to that socket. When absent (game does not exist or
     * lookup failed), chat fans out to every registered socket — same
     * behavior as slice 2.
     */
    public static final String ATTR_GAME_CHAT_ID = "webapi.gameChatId";

    private final String username;
    private final Set<WsContext> sockets = ConcurrentHashMap.newKeySet();
    private final Deque<WebStreamFrame> buffer = new ArrayDeque<>(BUFFER_CAPACITY);

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

    /**
     * Snapshot the buffered frames whose {@code messageId} is strictly
     * greater than {@code since}. Returned list is in arrival order.
     * Empty if no frames qualify (cold buffer / large gap / fresh
     * socket); caller treats that as "fall through to live."
     */
    public List<WebStreamFrame> framesSince(int since) {
        List<WebStreamFrame> out;
        synchronized (buffer) {
            out = new ArrayList<>(buffer.size());
            for (WebStreamFrame f : buffer) {
                if (f.messageId() > since) {
                    out.add(f);
                }
            }
        }
        return out;
    }

    int bufferSize() {
        synchronized (buffer) {
            return buffer.size();
        }
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
        WebStreamFrame frame;
        try {
            frame = mapToFrame(cc);
        } catch (RuntimeException ex) {
            // A mapper bug must not crash the engine thread.
            LOG.warn("WS mapper threw for user={}, method={}, msgId={}: {}",
                    username, cc.getMethod(), cc.getMessageId(), ex.toString());
            return;
        }
        if (frame == null) {
            if (LOG.isDebugEnabled()) {
                LOG.debug("WS drop (no mapper): user={}, method={}, msgId={}",
                        username, cc.getMethod(), cc.getMessageId());
            }
            return;
        }
        appendBuffer(frame);
        broadcast(cc, frame);
    }

    private WebStreamFrame mapToFrame(ClientCallback cc) {
        ClientCallbackMethod method = cc.getMethod();
        if (method == null) {
            return null;
        }
        return switch (method) {
            case CHATMESSAGE -> mapChat(cc);
            case GAME_INIT -> mapGameView(cc, "gameInit");
            case GAME_UPDATE -> mapGameView(cc, "gameUpdate");
            case GAME_UPDATE_AND_INFORM -> mapClientMessage(cc, "gameInform");
            case GAME_OVER -> mapClientMessage(cc, "gameOver");
            case END_GAME_INFO -> mapEndGame(cc);
            case START_GAME -> mapStartGame(cc);
            default -> null;
        };
    }

    private WebStreamFrame mapChat(ClientCallback cc) {
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

    private WebStreamFrame mapGameView(ClientCallback cc, String wireMethod) {
        Object data = cc.getData();
        if (!(data instanceof GameView upstream)) {
            LOG.warn("{} callback with unexpected data type: {}",
                    cc.getMethod(),
                    data == null ? "null" : data.getClass().getName());
            return null;
        }
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                wireMethod,
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toDto(upstream)
        );
    }

    private WebStreamFrame mapStartGame(ClientCallback cc) {
        Object data = cc.getData();
        if (!(data instanceof TableClientMessage upstream)) {
            LOG.warn("START_GAME callback with unexpected data type: {}",
                    data == null ? "null" : data.getClass().getName());
            return null;
        }
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                "startGame",
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toStartGameInfo(upstream)
        );
    }

    private WebStreamFrame mapClientMessage(ClientCallback cc, String wireMethod) {
        Object data = cc.getData();
        if (!(data instanceof GameClientMessage upstream)) {
            LOG.warn("{} callback with unexpected data type: {}",
                    cc.getMethod(),
                    data == null ? "null" : data.getClass().getName());
            return null;
        }
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                wireMethod,
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toClientMessage(upstream)
        );
    }

    private WebStreamFrame mapEndGame(ClientCallback cc) {
        Object data = cc.getData();
        if (!(data instanceof GameEndView upstream)) {
            LOG.warn("END_GAME_INFO callback with unexpected data type: {}",
                    data == null ? "null" : data.getClass().getName());
            return null;
        }
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                "endGameInfo",
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toGameEndDto(upstream)
        );
    }

    private void appendBuffer(WebStreamFrame frame) {
        synchronized (buffer) {
            if (buffer.size() >= BUFFER_CAPACITY) {
                buffer.removeFirst();
            }
            buffer.addLast(frame);
        }
    }

    private void broadcast(ClientCallback cc, WebStreamFrame frame) {
        if (sockets.isEmpty()) {
            return;
        }
        boolean isChat = "chatMessage".equals(frame.method());
        UUID frameChatId = cc.getObjectId();
        for (WsContext ctx : sockets) {
            if (isChat && !shouldDeliverChat(ctx, frameChatId)) {
                continue;
            }
            try {
                ctx.send(frame);
            } catch (RuntimeException ex) {
                LOG.warn("WS send failed for user={}, method={}: {}",
                        username, frame.method(), ex.getMessage());
            }
        }
    }

    /**
     * Chat-scoping filter. If the WsContext has a bound game chatId
     * (the connect handler resolved it via {@code chatFindByGame}),
     * only deliver chats whose {@code objectId} matches. Otherwise
     * deliver to all sockets — the slice-2 fan-out behavior, retained
     * for the case where the game does not yet exist at connect time.
     */
    private static boolean shouldDeliverChat(WsContext ctx, UUID frameChatId) {
        Object bound = ctx.attribute(ATTR_GAME_CHAT_ID);
        if (!(bound instanceof UUID boundChatId)) {
            return true;
        }
        return frameChatId != null && frameChatId.equals(boundChatId);
    }
}
