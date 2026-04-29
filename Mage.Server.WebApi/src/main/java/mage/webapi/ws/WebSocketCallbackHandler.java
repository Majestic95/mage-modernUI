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
import mage.game.Game;
import mage.players.Player;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.mapper.ChatMessageMapper;
import mage.webapi.mapper.DeckViewMapper;
import mage.webapi.mapper.GameViewMapper;
import mage.webapi.upstream.GameLookup;
import mage.webapi.upstream.StackCardIdHint;
import org.jboss.remoting.callback.AsynchInvokerCallbackHandler;
import org.jboss.remoting.callback.Callback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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
 *
 * <p>Per-game state: a {@code WebSocketCallbackHandler} is 1:1 per
 * {@code WebSession} (per username), not per game — a user in two
 * games simultaneously shares one handler. Slice 49/61 diagnostic
 * counters are therefore keyed by gameId in
 * {@link #diagnosticsByGame}. Map growth is bounded by the (small)
 * number of distinct games observed per session; entries are not
 * auto-cleaned on game end since the cost of a stale entry is a
 * handful of ints, and an end-game frame may still be followed by
 * additional game-stream frames for that gameId.
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
     * Slice 61 — Mad-AI no-plays fallback intervention threshold. While
     * {@link #LOW_FRAMES_THRESHOLD} flags a single suspicious segment
     * ("this segment is suspiciously low"), this constant fires only
     * after we've seen this many consecutive low-frame segments for the
     * same active player ("the AI is genuinely stuck — intervene"). At
     * that point {@link #triggerStuckAiFallback} forces a pass-priority
     * on the AI's behalf so the game advances rather than hanging on
     * the upstream {@code ComputerPlayer7.java:119} empty-tree edge
     * case.
     */
    static final int LOW_FRAMES_FALLBACK_THRESHOLD = 3;

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
    /**
     * Optional handle to the embedded server for stack-cardId hint
     * lookup (slice 52a). Null in unit tests that don't boot the
     * server — the {@link #mapGameView} path then degrades gracefully
     * to an empty stack hint, which falls back to the pre-slice-52a
     * cardId-equals-id behavior on the wire.
     */
    private final EmbeddedServer embedded;
    private final Set<WsContext> sockets = ConcurrentHashMap.newKeySet();
    private final Deque<WebStreamFrame> buffer = new ArrayDeque<>(BUFFER_CAPACITY);

    /**
     * Per-game slice-49/61 diagnostic state. Key: gameId from
     * {@code ClientCallback.getObjectId()}.
     *
     * <p>Auditor #2 (slice-61 review) flagged that scalar per-handler
     * diagnostic state cross-contaminates when one user is in multiple
     * games simultaneously: a turn advance on game A could close out
     * the segment counter that was actually tracking game B, causing
     * the slice-61 fallback to fire on the wrong game. Keying by
     * gameId fixes this.
     *
     * <p>Map growth is bounded by # of distinct games per WebSession,
     * which is small (typically 1, occasionally a few for spectators
     * watching multiple matches). Entries are not auto-cleaned on
     * game end — see class-level note. Treat this as effectively a
     * tiny cache, not a leak vector.
     */
    private final Map<UUID, AiSegmentDiagnostics> diagnosticsByGame =
            new ConcurrentHashMap<>();

    /**
     * Per-game slice-49/61 diagnostic state. One instance per gameId in
     * {@link #diagnosticsByGame}. Mutations are guarded by
     * {@code synchronized (this)} on the instance because two
     * concurrent games on different engine threads can both deliver
     * callbacks to the same {@link WebSocketCallbackHandler} (1:1 per
     * WebSession, not per game) — even though each individual game's
     * dispatch is single-threaded, two games racing on different
     * keys is fine but two games happening to land on the same key
     * (impossible by construction since key=gameId, but cheap to
     * synchronize anyway as a defense-in-depth at diagnostic
     * frequency) is not worth a data race for.
     */
    static final class AiSegmentDiagnostics {
        /**
         * Slice 49 — most-recently-observed turn number for this game.
         * {@code -1} sentinel = uninitialized / pre-first-frame.
         */
        int lastSeenTurn = -1;

        /**
         * Slice 49 — most-recently-observed active-player name. Null
         * sentinel = uninitialized.
         */
        String lastSeenActivePlayer = null;

        /**
         * Slice 49 — frame count accumulated against the current
         * (turn, activePlayer) segment.
         */
        int framesThisSegment = 0;

        /**
         * Slice 61 — count of consecutive turn segments that closed
         * with {@code framesThisSegment < LOW_FRAMES_THRESHOLD}.
         * Resets to 0 on (a) any normal-segment close, (b)
         * {@code reset=true} (gameInit — game-2 of best-of-three
         * would otherwise carry stale state), and (c) immediately
         * after {@link #triggerStuckAiFallback} fires so we don't
         * re-fire on the same stall (the intervention takes effect
         * over the next turn segment, not instantly). When this
         * counter reaches {@link #LOW_FRAMES_FALLBACK_THRESHOLD} the
         * fallback pass-priority intervention is invoked.
         */
        int consecutiveLowSegments = 0;
    }

    /**
     * Test-friendly ctor: no embedded-server reference. The
     * stack-cardId hint path will always produce an empty hint, so
     * stack entries' {@code cardId} falls back to {@code id}. Tests
     * that exercise mapping in isolation use this overload.
     */
    public WebSocketCallbackHandler(String username) {
        this(username, null);
    }

    /**
     * Production ctor: receives the {@link EmbeddedServer} so the
     * slice-52a stack-cardId hint can resolve the underlying
     * {@code Card} UUID for {@code Spell} entries on the stack. The
     * embedded reference is held weakly here in spirit (we never
     * mutate it, only call {@code managerFactory()} to walk
     * controllers); a null is accepted defensively.
     */
    public WebSocketCallbackHandler(String username, EmbeddedServer embedded) {
        this.username = username;
        this.embedded = embedded;
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
        // Auditor-2 fix: gameId now keys the per-game diagnostic
        // state. Defensive early-return on null protects the (in
        // practice unreachable for game-view frames) case where the
        // upstream callback omits the objectId — without a key we
        // cannot safely scope the diagnostic state, so we drop the
        // observation rather than risk cross-contaminating another
        // game's counters.
        UUID gameId = cc.getObjectId();
        if (gameId == null) {
            return;
        }
        boolean reset = "gameInit".equals(frame.method());
        observeTurnTransition(gv.getTurn(), gv.getActivePlayerName(), reset, gameId);
    }

    /**
     * Frame-count tracker, refactored out for unit-test access. Each
     * call counts one frame against the current (turn, activePlayer)
     * segment for {@code gameId}; when either changes, the prior
     * segment's count is logged (WARN if below
     * {@link #LOW_FRAMES_THRESHOLD}).
     *
     * <p>{@code reset=true} is for {@code gameInit} — game-2 of a
     * best-of-three resets turn numbering, so we re-anchor without
     * logging the (meaningless) prior segment.
     *
     * <p>Package-private for {@code AiActionDiagnosticTest}. The
     * {@code gameId} parameter may be a synthetic UUID in tests —
     * production callers route through {@link #observeAiActions},
     * which sources gameId from {@code ClientCallback.getObjectId()}
     * and early-returns on null. Mutations on the per-game state
     * object are synchronized on that instance because two games
     * running on different engine threads can both deliver callbacks
     * to the same handler (1:1 per WebSession, not per game); even
     * though distinct games key to distinct entries in
     * {@link #diagnosticsByGame}, defense-in-depth synchronization
     * costs effectively nothing at diagnostic call frequency.
     */
    void observeTurnTransition(int turn, String activePlayer, boolean reset, UUID gameId) {
        AiSegmentDiagnostics d = diagnosticsByGame.computeIfAbsent(
                gameId, k -> new AiSegmentDiagnostics());
        synchronized (d) {
            if (reset) {
                d.lastSeenTurn = turn;
                d.lastSeenActivePlayer = activePlayer;
                d.framesThisSegment = 1;
                // Slice 61 — gameInit (e.g. game-2 of best-of-three) must
                // not carry stuck-AI state across game boundaries.
                d.consecutiveLowSegments = 0;
                return;
            }
            boolean turnAdvanced = turn != d.lastSeenTurn;
            boolean playerChanged = activePlayer != null
                    && !activePlayer.equals(d.lastSeenActivePlayer);
            if (turnAdvanced || playerChanged) {
                if (d.lastSeenTurn != -1) {
                    if (d.framesThisSegment < LOW_FRAMES_THRESHOLD) {
                        LOG.warn("AI-action diagnostic LOW: user={}, turn={}, "
                                + "activePlayer={}, frames={} "
                                + "(possible no-plays stall — see "
                                + "docs/decisions/mad-ai-no-plays-recon.md)",
                                username, d.lastSeenTurn, d.lastSeenActivePlayer,
                                d.framesThisSegment);
                        // Slice 61 — accumulate; intervene at threshold.
                        d.consecutiveLowSegments++;
                        if (d.consecutiveLowSegments >= LOW_FRAMES_FALLBACK_THRESHOLD) {
                            triggerStuckAiFallback(d.lastSeenTurn, d.lastSeenActivePlayer, gameId);
                            d.consecutiveLowSegments = 0;
                        }
                    } else {
                        if (LOG.isDebugEnabled()) {
                            LOG.debug("AI-action diagnostic: user={}, turn={}, "
                                    + "activePlayer={}, frames={}",
                                    username, d.lastSeenTurn, d.lastSeenActivePlayer,
                                    d.framesThisSegment);
                        }
                        // Slice 61 — a normal segment breaks the LOW streak.
                        d.consecutiveLowSegments = 0;
                    }
                }
                d.lastSeenTurn = turn;
                d.lastSeenActivePlayer = activePlayer;
                d.framesThisSegment = 1;
            } else {
                d.framesThisSegment++;
            }
        }
    }

    /**
     * Test access — exposes the per-game diagnostic state object for
     * direct field inspection. Returns {@code null} if no frames
     * have been observed for the given gameId yet (the lazy-create
     * path runs on first {@link #observeTurnTransition} call).
     */
    AiSegmentDiagnostics diagnosticsForTest(UUID gameId) {
        return diagnosticsByGame.get(gameId);
    }

    /**
     * Slice 61 — Mad-AI no-plays fallback. When slice 49's
     * diagnostic detects {@link #LOW_FRAMES_FALLBACK_THRESHOLD}
     * consecutive low-frame segments for the same active player,
     * we infer the AI is stuck in the upstream
     * ComputerPlayer7.java:119 empty-tree edge case (slice 47
     * mitigated, didn't cure) and force a pass-priority on its
     * behalf so the game advances.
     *
     * <p>The intervention calls {@code Player.pass(game)} directly
     * on the upstream Player object (resolved via
     * {@link GameLookup}). Computer players don't have userId
     * entries in {@code userPlayerMap}, so the normal
     * {@code MageServerImpl.sendPlayerAction} path can't route to
     * them — direct Player API is the only option.
     *
     * <p>Defensive: skips if game can't be resolved, if the
     * priority player can't be found, or if the priority player
     * isn't a computer (we never force a human's pass). Any
     * RuntimeException from the pass call is caught + logged so
     * the engine thread doesn't crash.
     */
    private void triggerStuckAiFallback(int turn, String activePlayer, UUID gameId) {
        LOG.warn("AI-action diagnostic STUCK ({}× LOW): user={}, "
                + "turn={}, activePlayer={} — forcing pass-priority "
                + "intervention",
                LOW_FRAMES_FALLBACK_THRESHOLD, username, turn, activePlayer);
        // gameId is non-null by construction: observeAiActions early-returns
        // on null gameId, so observeTurnTransition (and hence this method)
        // is unreachable without one. embedded may still be null in unit
        // tests that exercise the diagnostic path without booting a server.
        if (embedded == null) {
            LOG.debug("Stuck-AI fallback skipped: embedded server unavailable");
            return;
        }
        Optional<Game> gameOpt = GameLookup.findGame(gameId, embedded.managerFactory());
        if (gameOpt.isEmpty()) {
            LOG.warn("Stuck-AI fallback: could not resolve game {}", gameId);
            return;
        }
        Game game = gameOpt.get();
        UUID priorityPlayerId = game.getPriorityPlayerId();
        if (priorityPlayerId == null) {
            LOG.warn("Stuck-AI fallback: no priority player on game {}", gameId);
            return;
        }
        Player player = game.getPlayer(priorityPlayerId);
        if (player == null) {
            LOG.warn("Stuck-AI fallback: priority player {} not found on game {}",
                    priorityPlayerId, gameId);
            return;
        }
        if (!player.isComputer()) {
            // Should never happen — we only fire on AI segments — but defense
            // in depth: never force a human's pass. Using !isComputer()
            // rather than isHuman() per upstream convention
            // (Player.java:68 explicitly recommends isComputer in
            // gameplay-relevant logic for AI-test coverage).
            LOG.warn("Stuck-AI fallback: priority player {} ({}) is not "
                    + "a computer, skipping intervention",
                    priorityPlayerId, player.getName());
            return;
        }
        try {
            player.pass(game);
            LOG.info("Stuck-AI fallback: forced pass on player={} (id={})",
                    player.getName(), priorityPlayerId);
        } catch (RuntimeException ex) {
            LOG.warn("Stuck-AI fallback: pass() failed for player={}: {}",
                    player.getName(), ex.toString());
        }
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
        Map<UUID, UUID> stackHint = resolveStackCardIdHint(cc.getObjectId());
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                wireMethod,
                cc.getMessageId(),
                cc.getObjectId() == null ? null : cc.getObjectId().toString(),
                GameViewMapper.toDto(upstream, stackHint)
        );
    }

    /**
     * Slice 52a — best-effort lookup of the
     * {@code SpellAbility-UUID → Card-UUID} hint map for stack
     * entries. Returns {@link Map#of()} when the embedded reference
     * is absent (test ctor), the gameId is null, the controller is
     * not registered, or any reflection step fails — in all of those
     * cases the wire format simply falls back to {@code cardId == id}
     * for stack entries, which costs only the cross-zone animation
     * polish.
     */
    private Map<UUID, UUID> resolveStackCardIdHint(UUID gameId) {
        if (embedded == null || gameId == null) {
            return Map.of();
        }
        return GameLookup.findGame(gameId, embedded.managerFactory())
                .map(StackCardIdHint::extract)
                .orElse(Map.of());
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
