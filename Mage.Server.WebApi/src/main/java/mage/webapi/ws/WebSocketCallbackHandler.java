package mage.webapi.ws;

import io.javalin.websocket.WsContext;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.view.AbilityPickerView;
import mage.view.ChatMessage;
import mage.view.GameClientMessage;
import mage.view.GameEndView;
import mage.view.GameView;
import mage.view.TableClientMessage;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.mapper.ChatMessageMapper;
import mage.webapi.mapper.DeckViewMapper;
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
     * Slice 49 — AI-action diagnostic threshold. A turn segment with
     * fewer than this many GameView frames raises a WARN. Slice 47
     * mitigated the Mad AI no-plays cliff (skill 1 → 4, more think
     * time) but did not cure the upstream empty-tree edge case at
     * {@code ComputerPlayer7.java:119}; this counter is the canary
     * that fires if the stall recurs.
     *
     * <p>Calibration: a no-action turn still produces ~10–12 phase
     * updates (untap / upkeep / draw / main1 / begin-combat /
     * declare-attackers / declare-blockers / combat-damage /
     * end-combat / main2 / end / cleanup) — anything below 3 is
     * pathological, not "the AI declined to act."
     */
    static final int LOW_FRAMES_THRESHOLD = 3;

    /**
     * Per-WsContext attribute key — the chatId this socket is bound
     * to. Resolved at connect time via
     * {@code MageServerImpl.chatFindByGame} (game stream) or
     * {@code chatFindByRoom} (lobby/room stream). When present, only
     * {@code chatMessage} frames whose {@code objectId} matches are
     * forwarded to that socket. When absent (game does not exist or
     * lookup failed), chat fans out to every registered socket — same
     * fallback behavior as slice 2.
     *
     * <p>Renamed from {@code ATTR_GAME_CHAT_ID} in slice 8 when the
     * room WebSocket route landed and the attribute was no longer
     * game-specific.
     */
    public static final String ATTR_BOUND_CHAT_ID = "webapi.boundChatId";

    private final String username;
    private final Set<WsContext> sockets = ConcurrentHashMap.newKeySet();
    private final Deque<WebStreamFrame> buffer = new ArrayDeque<>(BUFFER_CAPACITY);

    // Slice 49 — best-effort AI-action diagnostic state. Mutated only
    // from the engine-callback thread inside dispatch(); a user in two
    // simultaneous games gets interleaved counts (acceptable for a
    // canary log — when WARN fires you cross-reference surrounding
    // log lines to identify the affected game).
    private int lastSeenTurn = -1;
    private String lastSeenActivePlayer = null;
    private int framesThisSegment = 0;

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

    /**
     * Close every WebSocket registered on this handler with the given
     * close code + reason. Called when the owning WebSession ends
     * (logout / sweep) so connected clients observe the close instead
     * of holding a TCP socket open until Jetty's idle timeout.
     *
     * <p>Per-socket failure is logged and skipped — the goal is
     * best-effort fan-out, not transactional guarantee.
     */
    public void closeAllSockets(int code, String reason) {
        for (WsContext ctx : sockets) {
            try {
                ctx.closeSession(code, reason);
            } catch (RuntimeException ex) {
                LOG.debug("WS close failed for user={}: {}", username, ex.getMessage());
            }
        }
        sockets.clear();
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
        observeAiActions(cc, frame);
        broadcast(cc, frame);
    }

    // ---------- Slice 49 — AI-action diagnostic ----------

    /**
     * Pull the {@link GameView} (if any) out of a just-dispatched frame
     * and feed its turn / active-player fields into
     * {@link #observeTurnTransition}. Best-effort: non-game frames
     * (chat, sideboard, end-game, dialogs that don't carry a
     * GameClientMessage) return early.
     */
    private void observeAiActions(ClientCallback cc, WebStreamFrame frame) {
        GameView gv = extractGameView(cc, frame);
        if (gv == null) {
            return;
        }
        boolean reset = "gameInit".equals(frame.method());
        observeTurnTransition(gv.getTurn(), gv.getActivePlayerName(), reset);
    }

    /**
     * Frame-count tracker, refactored out for unit-test access. Each
     * call counts one frame against the current (turn, activePlayer)
     * segment; when either changes, the prior segment's count is
     * logged (WARN if below {@link #LOW_FRAMES_THRESHOLD}).
     *
     * <p>{@code reset=true} is for {@code gameInit} — game-2 of a
     * best-of-three resets turn numbering, so we re-anchor without
     * logging the (meaningless) prior segment.
     */
    void observeTurnTransition(int turn, String activePlayer, boolean reset) {
        if (reset) {
            lastSeenTurn = turn;
            lastSeenActivePlayer = activePlayer;
            framesThisSegment = 1;
            return;
        }
        boolean turnAdvanced = turn != lastSeenTurn;
        boolean playerChanged = activePlayer != null
                && !activePlayer.equals(lastSeenActivePlayer);
        if (turnAdvanced || playerChanged) {
            if (lastSeenTurn != -1) {
                if (framesThisSegment < LOW_FRAMES_THRESHOLD) {
                    LOG.warn("AI-action diagnostic LOW: user={}, turn={}, "
                            + "activePlayer={}, frames={} "
                            + "(possible no-plays stall — see "
                            + "docs/decisions/mad-ai-no-plays-recon.md)",
                            username, lastSeenTurn, lastSeenActivePlayer,
                            framesThisSegment);
                } else if (LOG.isDebugEnabled()) {
                    LOG.debug("AI-action diagnostic: user={}, turn={}, "
                            + "activePlayer={}, frames={}",
                            username, lastSeenTurn, lastSeenActivePlayer,
                            framesThisSegment);
                }
            }
            lastSeenTurn = turn;
            lastSeenActivePlayer = activePlayer;
            framesThisSegment = 1;
        } else {
            framesThisSegment++;
        }
    }

    /** Test access for slice-49 unit assertions. */
    int framesThisSegment() {
        return framesThisSegment;
    }

    /** Test access for slice-49 unit assertions. */
    int lastSeenTurn() {
        return lastSeenTurn;
    }

    /** Test access for slice-49 unit assertions. */
    String lastSeenActivePlayer() {
        return lastSeenActivePlayer;
    }

    private static GameView extractGameView(ClientCallback cc, WebStreamFrame frame) {
        String method = frame.method();
        Object data = cc.getData();
        if ("gameInit".equals(method) || "gameUpdate".equals(method)) {
            return data instanceof GameView gv ? gv : null;
        }
        if ("gameInform".equals(method)) {
            return data instanceof GameClientMessage gcm ? gcm.getGameView() : null;
        }
        return null;
    }

    /**
     * Package-private (was private prior to slice 16) to let
     * CombatFlowContractTest assert the wire-format contract that
     * the webclient's interaction-mode heuristic depends on, without
     * standing up a full embedded-server WebSocket round-trip.
     */
    WebStreamFrame mapToFrame(ClientCallback cc) {
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
            case GAME_ASK -> mapClientMessage(cc, "gameAsk");
            case GAME_TARGET -> mapClientMessage(cc, "gameTarget");
            case GAME_SELECT -> mapClientMessage(cc, "gameSelect");
            case GAME_PLAY_MANA -> mapClientMessage(cc, "gamePlayMana");
            case GAME_PLAY_XMANA -> mapClientMessage(cc, "gamePlayXMana");
            case GAME_GET_AMOUNT -> mapClientMessage(cc, "gameSelectAmount");
            case GAME_CHOOSE_CHOICE -> mapClientMessage(cc, "gameChooseChoice");
            case GAME_CHOOSE_ABILITY -> mapAbilityPicker(cc);
            case GAME_INFORM_PERSONAL -> mapClientMessage(cc, "gameInformPersonal");
            case GAME_ERROR -> mapGameError(cc);
            case END_GAME_INFO -> mapEndGame(cc);
            case START_GAME -> mapStartGame(cc);
            case SIDEBOARD -> mapSideboard(cc);
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

    private WebStreamFrame mapSideboard(ClientCallback cc) {
        Object data = cc.getData();
        if (!(data instanceof TableClientMessage upstream)) {
            LOG.warn("SIDEBOARD callback with unexpected data type: {}",
                    data == null ? "null" : data.getClass().getName());
            return null;
        }
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                "sideboard",
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                DeckViewMapper.toSideboardInfo(upstream)
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

    private WebStreamFrame mapGameError(ClientCallback cc) {
        // GAME_ERROR is the one Game* method whose data is a bare
        // String, not a GameClientMessage. Synthesize the wrapper so
        // every game-error frame renders through the same shape on
        // the wire.
        Object data = cc.getData();
        String text = data == null ? "" : data.toString();
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                "gameError",
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toErrorMessage(text)
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

    private WebStreamFrame mapAbilityPicker(ClientCallback cc) {
        // GAME_CHOOSE_ABILITY is the one dialog whose data is an
        // AbilityPickerView, not a GameClientMessage. Distinct frame
        // shape; renderer-side dispatched via a discriminated union.
        Object data = cc.getData();
        if (!(data instanceof AbilityPickerView upstream)) {
            LOG.warn("GAME_CHOOSE_ABILITY callback with unexpected data type: {}",
                    data == null ? "null" : data.getClass().getName());
            return null;
        }
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                "gameChooseAbility",
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toAbilityPickerDto(upstream)
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
        // Snapshot the set so concurrent unregister() during the
        // engine-thread fan-out doesn't surface as send-to-dead-socket
        // log spam. ConcurrentHashMap's iterator is weakly consistent;
        // a fresh ArrayList captures the registered set at this
        // instant. (See concurrency audit 2026-04-26.)
        List<WsContext> snapshot = new ArrayList<>(sockets);
        boolean isChat = "chatMessage".equals(frame.method());
        UUID frameChatId = cc.getObjectId();
        for (WsContext ctx : snapshot) {
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
        Object bound = ctx.attribute(ATTR_BOUND_CHAT_ID);
        if (!(bound instanceof UUID boundChatId)) {
            return true;
        }
        return frameChatId != null && frameChatId.equals(boundChatId);
    }
}
