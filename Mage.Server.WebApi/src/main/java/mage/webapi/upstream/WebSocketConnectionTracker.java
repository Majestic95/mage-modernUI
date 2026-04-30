package mage.webapi.upstream;

import mage.webapi.dto.stream.WebPlayerView;

import java.util.UUID;

/**
 * Slice 70-H (ADR 0010 v2 D11(e), ADR 0011 D3) — abstraction over the
 * WebSocket-layer per-player connection oracle, threaded into the
 * mapper via {@link MultiplayerFrameContext}.
 *
 * <p><b>Why an interface, not a direct {@code WebSocketCallbackHandler}
 * reference?</b> Three reasons. First, the handler-per-username model
 * (slice 63) means a recipient's handler holds both the lobby socket
 * and the game socket on the same {@code Set<WsContext>} — a tracker
 * implementation can route-filter via {@code ATTR_ROUTE_KIND ==
 * ROUTE_PLAYER} once at the boundary so the mapper sees only the
 * game-socket count. Second, the mapper builds a {@link WebPlayerView}
 * for every player in the frame (recipient + opponents), so the
 * tracker needs to answer "does any handler in this game have a live
 * player-route socket for player X?" — that's an
 * {@code AuthService}-level lookup, not a single-handler property.
 * Third, the static {@code GameViewMapper.toPlayerDto} signature stays
 * test-friendly: tests instantiate a synthetic
 * {@link MultiplayerFrameContext} with no tracker, the
 * {@link #EVERY_PLAYER_CONNECTED} default fires, and wire-shape
 * contract tests don't need a fake handler / fake AuthService.
 *
 * <p><b>Connection state semantics.</b> "connected" means the player
 * has at least one open WebSocket on the player route in the frame's
 * game. "disconnected" means all such sockets are closed but the
 * player is still seated in the game ({@code hasLeft=false}). The
 * terminal state is {@code WebPlayerView.hasLeft} — disconnected is
 * recoverable; the player can rejoin and the engine resumes their
 * pod's prompts. The schema-1.23 wire field
 * {@link WebPlayerView#connectionState()} surfaces this distinction
 * for the client's PlayerFrame DISCONNECTED overlay (design-system
 * §7.3 — desaturate + label).
 *
 * <p><b>Thread safety.</b> Implementations are called on the engine
 * event-dispatch thread inside the synchronized
 * {@code GameController.updateGame()} block. Reads against the
 * AuthService handler registry are concurrent-safe by construction
 * ({@code ConcurrentHashMap}); the tracker just walks the map.
 */
@FunctionalInterface
public interface WebSocketConnectionTracker {

    /**
     * Resolve the connection state of {@code playerId} in the game
     * this tracker is bound to. Returns one of
     * {@link WebPlayerView#CONNECTION_STATE_CONNECTED} /
     * {@link WebPlayerView#CONNECTION_STATE_DISCONNECTED}.
     *
     * <p>Defensive contract: a null {@code playerId}, an unknown
     * playerId (e.g. spectator perspective with no seat in this
     * game), or any internal lookup failure must return
     * {@code "connected"} — the "disconnected" state is the visible
     * overlay, so a fail-open default keeps a transient AuthService
     * issue from painting healthy players as disconnected.
     */
    String connectionStateFor(UUID playerId);

    /**
     * Default tracker — every player reads as connected. Used by:
     * <ul>
     *   <li>{@link MultiplayerFrameContext#EMPTY} (test / legacy
     *       call sites without a live AuthService)</li>
     *   <li>The wire-shape contract tests that lock
     *       {@link WebPlayerView}'s field count without standing up
     *       a real WebSocket layer</li>
     *   <li>The fall-through in {@code WebSocketCallbackHandler}
     *       when {@code embedded} is null (test ctor without an
     *       AuthService)</li>
     * </ul>
     */
    WebSocketConnectionTracker EVERY_PLAYER_CONNECTED =
            playerId -> WebPlayerView.CONNECTION_STATE_CONNECTED;
}
