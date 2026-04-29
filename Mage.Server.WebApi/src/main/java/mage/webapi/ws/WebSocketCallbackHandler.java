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
import mage.webapi.upstream.MultiplayerFrameContext;
import mage.webapi.upstream.StackCardIdHint;
import org.jboss.remoting.callback.AsynchInvokerCallbackHandler;
import org.jboss.remoting.callback.Callback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.Iterator;
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
     * Slice 63 — auditor #4 / recon agent BLOCKER: hard cap on the
     * number of simultaneous WebSockets a single WebSession (i.e. one
     * authenticated user-token) may hold open. Without this cap, a
     * malicious or buggy client could open thousands of sockets, each
     * holding Jetty's per-connection buffers (~32 KB) — 50 such users
     * = memory exhaustion.
     *
     * <p>Calibrated at 4: legitimate concurrent need is 1 lobby socket
     * + 1 game socket + 1 spectator (future) + 1 reconnect-headroom for
     * the close/reopen race during a network blip. Above this is not a
     * legitimate UI shape.
     *
     * <p>Caveat: the cap is per-WebSession, not per-user. A user logged
     * in twice (two browsers / private tab) has two WebSessions and so
     * 2× the cap; that's acceptable because the duplicate-login path
     * (newest-wins, see {@code AuthService.revokePriorTokensForSameUsername})
     * already disconnects the older session.
     *
     * <p>Race acceptance: the {@code sockets} set is concurrent and a
     * race between two simultaneous {@code register} calls might briefly
     * allow 5 sockets through. That's a diagnostic-best-effort window,
     * not a security boundary — explicit synchronisation is unnecessary
     * for this slice.
     */
    static final int MAX_SOCKETS_PER_USER = 4;

    /**
     * WS close code used when {@link #register} rejects an over-cap
     * socket. Picked from the application-defined 4xxx range; 4008
     * (RFC-6455 closes are 1xxx, application closes are 4xxx) signals
     * "policy violation: too many sockets" so the webclient can
     * back off rather than retry-storm.
     */
    static final int CLOSE_TOO_MANY_SOCKETS = 4008;

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
     * Slice 69c (ADR 0010 v2 D11b) — per-game record of player UUIDs
     * we've already announced as left via {@code dialogClear}. Keyed
     * by gameId; value is the leaver set for that game.
     *
     * <p><b>Why per-handler state, not engine-side?</b> Upstream xmage
     * has no {@code PLAYER_LEFT} callback (verified slice-69c recon —
     * {@code ClientCallbackMethod} enumerates ~30 methods, none of
     * them player-left). The mapper detects the transition by
     * diffing {@link mage.view.PlayerView#hasLeft()} between
     * consecutive {@code gameUpdate} / {@code gameInit} /
     * {@code gameInform} frames for the same gameId. The "diff
     * counterparty" is per-handler because each handler has its own
     * frame stream and reconnect history; cross-handler coordination
     * is unnecessary (each handler will see the same upstream
     * GameView and synthesize identical dialogClear frames for its
     * own clients).
     *
     * <p>Reset on {@code gameInit} (game-2 of best-of-three would
     * otherwise carry stale leavers from game-1).
     */
    private final Map<UUID, Set<UUID>> prevHasLeftByGame =
            new ConcurrentHashMap<>();

    /**
     * Slice 68b — count of essential-frame evictions on the
     * fallback path of {@link #evictForOverflow}. Every fallback
     * fire increments this; only every Nth fire emits a WARN log
     * (see {@link #ESSENTIAL_EVICTION_WARN_INTERVAL}) so a 4p FFA
     * burst doesn't spam the log thousands of lines.
     *
     * <p>The volume signal lives on
     * {@link mage.webapi.metrics.MetricsRegistry#BUFFER_OVERFLOW_DROPS_TOTAL}
     * — every overflow eviction (chat-droppable AND fallback) is
     * counted there. The WARN's job is to mark *that the
     * pathological regime is occurring*, not to narrate every frame.
     */
    private final java.util.concurrent.atomic.AtomicLong essentialEvictionsSinceWarn =
            new java.util.concurrent.atomic.AtomicLong();

    /** WARN every Nth essential-frame eviction. Throttle, not silence. */
    private static final long ESSENTIAL_EVICTION_WARN_INTERVAL = 100L;

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

    /**
     * Add a freshly-opened socket. Called from Javalin's
     * {@code onConnect}. Returns {@code true} on successful registration.
     *
     * <p>Slice 63 — auditor #4 / recon agent BLOCKER: enforces the
     * {@link #MAX_SOCKETS_PER_USER} cap. When the user is already at
     * cap, the new socket is closed with {@link #CLOSE_TOO_MANY_SOCKETS}
     * and {@code "TOO_MANY_SOCKETS"} as the reason; the caller (the WS
     * upgrade handler) MUST observe the {@code false} return and skip
     * any further per-socket setup (attribute attach / streamHello)
     * because the socket is already closed.
     *
     * <p>Slice 63 fixer (critic finding #4): the check + add is
     * atomic under {@code synchronized (sockets)} so concurrent
     * register calls from N>>cap threads can't slip past in lockstep
     * and overshoot by N. The lock is held only for the size+add
     * window; the post-add LOG and the close-on-rejection happen
     * outside it. Negligible contention at WS-upgrade frequency.
     */
    public boolean register(WsContext ctx) {
        boolean accepted;
        int sizeAfter;
        synchronized (sockets) {
            if (sockets.size() >= MAX_SOCKETS_PER_USER) {
                accepted = false;
                sizeAfter = sockets.size();
            } else {
                sockets.add(ctx);
                accepted = true;
                sizeAfter = sockets.size();
            }
        }
        if (!accepted) {
            LOG.warn("WS register rejected (cap reached): user={}, sockets={}, cap={}",
                    username, sizeAfter, MAX_SOCKETS_PER_USER);
            try {
                ctx.closeSession(CLOSE_TOO_MANY_SOCKETS, "TOO_MANY_SOCKETS");
            } catch (RuntimeException ex) {
                LOG.debug("WS close-on-cap failed for user={}: {}", username, ex.getMessage());
            }
            return false;
        }
        LOG.debug("WS register: user={}, total sockets={}", username, sizeAfter);
        return true;
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

    /**
     * Slice 68b — test-only accessor for driving buffer state
     * directly. Production code uses {@link #appendBuffer} (private)
     * via the {@link #dispatch} pipeline. Tests use this to fill the
     * buffer to capacity with synthetic frames in a single setup
     * step rather than firing 64+ real callbacks. Mirrors the
     * {@code leaversForTest} / {@code diagnosticsForTest} pattern
     * used elsewhere in this class.
     */
    void appendBufferForTest(WebStreamFrame frame) {
        appendBuffer(frame);
    }

    /**
     * Slice 68b — test-only snapshot of the entire buffer (not just
     * frames-since). Returns a copy so the caller can inspect
     * eviction-priority state without holding the lock.
     */
    List<WebStreamFrame> bufferSnapshotForTest() {
        synchronized (buffer) {
            return new ArrayList<>(buffer);
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
        // Slice 69c — synthesize dialogClear for any newly-hasLeft
        // player. Runs AFTER the triggering frame is sent so clients
        // receive (a) the gameUpdate carrying the new hasLeft=true
        // state and (b) the dialogClear UX-teardown signal in that
        // order. Per ADR 0010 v2 D11b: dialogClear is fire-and-forget
        // UI teardown, not a state-machine transition.
        observeHasLeft(cc, frame);
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
     * Slice 69c (ADR 0010 v2 D11b) — synthesize {@code dialogClear}
     * frames for any player whose {@code hasLeft} flipped 0→1 since
     * the previous game-frame for the same gameId.
     *
     * <p>Detection runs after the triggering frame is sent so the
     * order on the wire is (a) the {@code gameUpdate} carrying the
     * new {@code hasLeft=true} state, (b) one {@code dialogClear} per
     * newly-departed player. Clients receiving (b) tear down any
     * open dialog targeting the leaver; clients receiving only (a)
     * (e.g. on reconnect-replay where the dialogClear preceded the
     * resume cursor) can still infer the teardown from the
     * {@code hasLeft=true} state in the GameView.
     *
     * <p>Resets the per-game leaver-set on {@code gameInit} so game-2
     * of a best-of-three doesn't carry stale leavers from game-1.
     *
     * <p>Package-private for unit-test access — tests drive the
     * transition logic via synthetic frames without a live engine.
     */
    void observeHasLeft(ClientCallback cc, WebStreamFrame frame) {
        GameView gv = extractGameView(cc, frame);
        if (gv == null) {
            return;
        }
        UUID gameId = cc.getObjectId();
        if (gameId == null) {
            return;
        }
        boolean reset = "gameInit".equals(frame.method());
        if (gv.getPlayers() == null || gv.getPlayers().isEmpty()) {
            if (reset) {
                prevHasLeftByGame.remove(gameId);
            }
            return;
        }
        Set<UUID> currentlyLeft = new java.util.HashSet<>();
        for (mage.view.PlayerView pv : gv.getPlayers()) {
            if (pv != null && pv.hasLeft() && pv.getPlayerId() != null) {
                currentlyLeft.add(pv.getPlayerId());
            }
        }
        Set<UUID> newlyLeft = detectNewlyLeft(gameId, currentlyLeft, reset);
        for (UUID leaverId : newlyLeft) {
            emitDialogClear(cc, gameId, leaverId);
        }
    }

    /**
     * Slice 69c — pure data kernel of {@link #observeHasLeft},
     * exposed for unit tests so the transition logic is reachable
     * without constructing a full {@link GameView} (upstream's
     * constructor demands a live {@code Game}/{@code GameState}).
     *
     * <p>Inputs:
     * <ul>
     *   <li>{@code gameId} — keys the per-handler leaver-set state.</li>
     *   <li>{@code currentlyLeft} — UUIDs of players for whom
     *       {@code hasLeft=true} in the most recent GameView for
     *       this gameId.</li>
     *   <li>{@code reset} — true on {@code gameInit} (clears prior
     *       leaver set so game-2 of best-of-three doesn't carry
     *       stale leavers from game-1).</li>
     * </ul>
     *
     * <p>Returns the subset of {@code currentlyLeft} not previously
     * recorded for this game — the new leavers the caller must
     * synthesize {@code dialogClear} frames for. Idempotent: a
     * second call with the same {@code currentlyLeft} returns empty.
     *
     * <p>Mutates {@link #prevHasLeftByGame} as a side effect to
     * record observations across calls.
     */
    Set<UUID> detectNewlyLeft(UUID gameId, Set<UUID> currentlyLeft, boolean reset) {
        if (gameId == null) {
            return Set.of();
        }
        if (reset) {
            prevHasLeftByGame.remove(gameId);
        }
        Set<UUID> previously = prevHasLeftByGame.computeIfAbsent(
                gameId, k -> ConcurrentHashMap.newKeySet());
        if (currentlyLeft == null || currentlyLeft.isEmpty()) {
            return Set.of();
        }
        Set<UUID> newlyLeft = new java.util.HashSet<>();
        for (UUID id : currentlyLeft) {
            if (id != null && previously.add(id)) {
                newlyLeft.add(id);
            }
        }
        return newlyLeft;
    }

    /**
     * Slice 69c — test helper. Returns an unmodifiable view of the
     * leaver set this handler has recorded for {@code gameId}, or
     * an empty set when the game has no recorded leavers (or has
     * been reset). Package-private and intended only for unit tests
     * — production code shouldn't need to introspect this state.
     */
    Set<UUID> leaversForTest(UUID gameId) {
        Set<UUID> set = prevHasLeftByGame.get(gameId);
        return set == null ? Set.of() : Set.copyOf(set);
    }

    /**
     * Build and dispatch a synthetic {@code dialogClear} frame.
     * Reuses the triggering callback's {@code messageId} so the
     * synthesized frame sits adjacent to the gameUpdate in the
     * resume buffer — reconnect with {@code ?since=N} replays both
     * in order. Fires through the same {@link #appendBuffer} +
     * {@link #broadcast} pipeline as native frames, so all client
     * hooks (reconnect, fan-out, AI diagnostic) see it consistently.
     */
    private void emitDialogClear(ClientCallback cc, UUID gameId, UUID leaverId) {
        WebStreamFrame frame = new WebStreamFrame(
                SchemaVersion.CURRENT,
                "dialogClear",
                cc.getMessageId(),
                gameId.toString(),
                new mage.webapi.dto.stream.WebDialogClear(
                        leaverId.toString(),
                        mage.webapi.dto.stream.WebDialogClear.REASON_PLAYER_LEFT
                )
        );
        appendBuffer(frame);
        broadcast(cc, frame);
        // Slice 70 (ADR 0010 v2 D10) — count synthesized dialogClear
        // frames for the admin /metrics endpoint. Per ADR D11b's
        // contract ("at most one dialogClear emitted per leaver per
        // game"), this counter equals the number of distinct
        // (game, leaver) pairs observed since process start.
        mage.webapi.metrics.MetricsRegistry.increment(
                mage.webapi.metrics.MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL);
        if (LOG.isDebugEnabled()) {
            LOG.debug("dialogClear synthesized: user={}, game={}, leaver={}",
                    username, gameId, leaverId);
        }
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
        // Slice 69c — resolve the live Game once per frame and share
        // it across the stack-hint, multiplayer-context, and RoI-
        // filter computations. Per slice-69c recon: this method runs
        // inside the engine's synchronized GameController.updateGame()
        // block, so reads are thread-safe and consistent with the
        // GameView snapshot we received from cc.getData().
        UUID gameId = cc.getObjectId();
        Game liveGame = resolveLiveGame(gameId);
        Map<UUID, UUID> stackHint = liveGame == null
                ? Map.of()
                : StackCardIdHint.extract(liveGame);
        MultiplayerFrameContext mpCtx = liveGame == null
                ? MultiplayerFrameContext.EMPTY
                : MultiplayerFrameContext.extract(liveGame);
        UUID recipientPlayerId = liveGame == null
                ? null
                : resolveRecipientPlayerId(gameId);
        Set<UUID> playersInRange = liveGame == null
                ? null
                : MultiplayerFrameContext.playersInRange(liveGame, recipientPlayerId);
        return new WebStreamFrame(
                SchemaVersion.CURRENT,
                wireMethod,
                cc.getMessageId(),
                gameId == null ? null : gameId.toString(),
                GameViewMapper.toDto(upstream, stackHint, mpCtx, playersInRange)
        );
    }

    /**
     * Slice 52a + 69c — resolve the live {@link Game} for a frame's
     * gameId. Returns {@code null} when the embedded reference is
     * absent (test ctor), the gameId is null, the controller isn't
     * registered, or reflection fails — every downstream consumer
     * (stack hint, multiplayer context, RoI filter) falls back to
     * its empty / no-op behavior, so the wire format degrades
     * gracefully to the pre-slice-69c shape.
     */
    private Game resolveLiveGame(UUID gameId) {
        if (embedded == null || gameId == null) {
            return null;
        }
        return GameLookup.findGame(gameId, embedded.managerFactory()).orElse(null);
    }

    /**
     * Slice 69c — resolve THIS user's playerId in the supplied game.
     * The handler is per-user (per-WebSession), so for any given
     * gameId there is at most one playerId associated with this
     * handler's {@link #username}. Used to compute the per-recipient
     * D1 RoI filter (ADR 0010 v2 D1).
     *
     * <p>Returns {@code null} when:
     * <ul>
     *   <li>{@code embedded} is null (test ctor)</li>
     *   <li>{@code gameId} is null</li>
     *   <li>The user isn't registered (rare — reaped by upstream)</li>
     *   <li>The user isn't seated in this game (e.g. spectator path,
     *       slice 71 — they get no filter, full roster)</li>
     * </ul>
     */
    private UUID resolveRecipientPlayerId(UUID gameId) {
        if (embedded == null || gameId == null) {
            return null;
        }
        UUID userId = embedded.managerFactory().userManager()
                .getUserByName(username)
                .map(mage.server.User::getId)
                .orElse(null);
        if (userId == null) {
            return null;
        }
        return GameLookup.findUserPlayerMap(gameId, embedded.managerFactory())
                .map(m -> m.get(userId))
                .orElse(null);
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
                evictForOverflow();
            }
            buffer.addLast(frame);
        }
    }

    /**
     * Slice 68b (ADR 0010 v2 D6) — priority-aware buffer eviction.
     * Pre-fix the buffer naively dropped the oldest frame regardless
     * of method. ADR D6 mandates dropping non-state frames first
     * (chat, pulse, informational) and preserving state / dialog
     * frames whenever possible — they're the ones the resume buffer
     * actually needs to replay correctly on reconnect.
     *
     * <p><b>Eviction order:</b>
     * <ol>
     *   <li>Walk oldest → newest. Evict the first
     *       {@link #isDroppable droppable} frame found. Single
     *       eviction per overflow — caller's loop or repeated
     *       overflow drives further evictions naturally.</li>
     *   <li>If no droppable frame is buffered, evict the oldest
     *       (last-resort fallback). This means the resume buffer
     *       lost a state/dialog frame the client may need on
     *       reconnect — log WARN so ops sees it.</li>
     * </ol>
     *
     * <p><b>v2 droppable methods:</b> {@code chatMessage} (chat) +
     * {@code gameInform} (the engine's free-text "alice plays
     * Forest" log stream — upstream's
     * {@code GAME_UPDATE_AND_INFORM} per
     * {@code ClientCallbackMethod.java:52}). Both carry state in the
     * sense that {@code gameInform} wraps a {@code GameView}, but
     * the state is cumulative — every subsequent
     * {@code gameInform}/{@code gameUpdate} carries the latest
     * snapshot, so dropping one mid-stream is replay-safe. The cost
     * is the slice-18 game-log strip may miss one descriptive entry
     * during overflow; the cost is bounded and the alternative
     * (dropping a true state/dialog frame the client needs to
     * resume) is materially worse. Pulse frames (slice 71+
     * spectator) will extend {@link #isDroppable} when they ship.
     * {@code dialogClear} (slice 69c D11b) is intentionally NOT
     * droppable — it's a one-shot teardown signal and a missed
     * dialogClear can leave a stuck modal until the next gameUpdate
     * arrives. Cheaper to keep it than reason about the recovery
     * path. (Per the ADR D11b reconnect ordering caveat, the
     * synthesized dialogClear shares a messageId with its
     * triggering gameUpdate; if the gameUpdate is preserved here,
     * the client can infer teardown from the GameView's
     * {@code hasLeft=true} regardless of whether dialogClear made
     * it through.)
     *
     * <p>Caller holds the buffer lock — {@link #appendBuffer}'s
     * {@code synchronized (buffer)} block.
     */
    private void evictForOverflow() {
        // Slice 70 (ADR 0010 v2 D10) — count every overflow eviction
        // for the admin /metrics endpoint. Non-zero values surface
        // when reconnect-via-?since= would have caught replay-worthy
        // frames the buffer dropped before the resume cursor.
        mage.webapi.metrics.MetricsRegistry.increment(
                mage.webapi.metrics.MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL);
        Iterator<WebStreamFrame> it = buffer.iterator();
        while (it.hasNext()) {
            WebStreamFrame candidate = it.next();
            if (isDroppable(candidate.method())) {
                it.remove();
                if (LOG.isDebugEnabled()) {
                    LOG.debug("WS buffer overflow: evicted droppable {} (msgId={}, user={})",
                            candidate.method(), candidate.messageId(), username);
                }
                return;
            }
        }
        // No droppable frames present — the buffer is full of
        // state/dialog frames. Last-resort: evict the oldest. The
        // metrics counter (above) already increments per drop, so
        // ops sees the volume there. The WARN log is THROTTLED to
        // every Nth eviction (ESSENTIAL_EVICTION_WARN_INTERVAL) —
        // a 4p FFA burst can hit this path dozens of times per
        // turn, and an unthrottled WARN would drown the log.
        WebStreamFrame evicted = buffer.removeFirst();
        long n = essentialEvictionsSinceWarn.incrementAndGet();
        if (n == 1L || n % ESSENTIAL_EVICTION_WARN_INTERVAL == 0L) {
            LOG.warn("WS buffer overflow: ALL frames essential, evicted oldest "
                    + "{} (msgId={}, user={}, totalEssentialEvictions={}). "
                    + "Reconnect via ?since= older than this messageId will "
                    + "miss replay frames; see metrics counter "
                    + "xmage_buffer_overflow_drops_total. Throttled to every "
                    + "{}th occurrence.",
                    evicted.method(), evicted.messageId(), username, n,
                    ESSENTIAL_EVICTION_WARN_INTERVAL);
        }
    }

    /**
     * Slice 68b — eviction-priority predicate. Returns true when a
     * frame can be safely evicted from the resume buffer without
     * breaking the client's reconnect contract. v2 droppable set:
     * {@code chatMessage} only. Game state, dialogs, and the slice-
     * 69c {@code dialogClear} envelope are all preserved.
     *
     * <p>Static + package-private — kept out of the synchronized
     * critical section in {@link #evictForOverflow} so future tests
     * can drive it directly without instantiating the handler.
     */
    static boolean isDroppable(String method) {
        return "chatMessage".equals(method) || "gameInform".equals(method);
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
                // Slice 70 — count successful frame egress per send
                // (NOT per call). Failed sends (catch below) don't
                // count — they're observable via the WARN log and
                // are out of scope for v2 metrics.
                mage.webapi.metrics.MetricsRegistry.increment(
                        mage.webapi.metrics.MetricsRegistry
                                .FRAMES_EGRESSED_TOTAL);
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
