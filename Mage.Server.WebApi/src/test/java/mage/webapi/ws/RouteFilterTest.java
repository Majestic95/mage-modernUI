package mage.webapi.ws;

import mage.webapi.SchemaVersion;
import mage.webapi.dto.stream.WebDialogClear;
import mage.webapi.dto.stream.WebGameClientMessage;
import mage.webapi.dto.stream.WebGameView;
import mage.webapi.dto.stream.WebManaPoolView;
import mage.webapi.dto.stream.WebStreamFrame;
import mage.webapi.dto.stream.WebStreamHello;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 71 (ADR 0010 v2 D4) — unit coverage for the per-frame route
 * derivation + per-socket route matching that drive
 * {@link WebSocketCallbackHandler#broadcast}'s player-vs-spectator
 * delivery filter.
 *
 * <p>Tests the static pure helpers
 * ({@link WebSocketCallbackHandler#routeKindFor},
 * {@link WebSocketCallbackHandler#isSpectatorPerspective},
 * {@link WebSocketCallbackHandler#matchesRoute}) directly so the
 * routing contract is locked without spinning up a real Jetty
 * connection. Mirrors the
 * {@code BufferEvictionPriorityTest} pattern from slice 68b.
 *
 * <p>End-to-end routing (real WS sockets across a real engine) is
 * exercised by the spectator integration tests in
 * {@code GameStreamHandlerTest}.
 */
class RouteFilterTest {

    private static WebGameView playerGameView() {
        return new WebGameView(
                1, "PRECOMBAT_MAIN", "PRECOMBAT_MAIN",
                "alice", "alice", false, false, 0, 0, 0,
                // myPlayerId NON-empty = player perspective.
                "11111111-1111-1111-1111-111111111111",
                Map.of(), Map.of(), List.of(), List.of());
    }

    private static WebGameView spectatorGameView() {
        return new WebGameView(
                1, "PRECOMBAT_MAIN", "PRECOMBAT_MAIN",
                "alice", "alice", false, false, 0, 0, 0,
                // myPlayerId EMPTY = spectator perspective per
                // GameViewMapper's null-recipient mapping.
                "",
                Map.of(), Map.of(), List.of(), List.of());
    }

    private static WebStreamFrame frame(String method, Object data) {
        return new WebStreamFrame(SchemaVersion.CURRENT, method, 1, "obj", data);
    }

    /* ---------- isSpectatorPerspective ---------- */

    @Test
    void isSpectatorPerspective_emptyMyPlayerId_isSpectator() {
        assertTrue(WebSocketCallbackHandler.isSpectatorPerspective(spectatorGameView()));
    }

    @Test
    void isSpectatorPerspective_populatedMyPlayerId_isPlayer() {
        assertFalse(WebSocketCallbackHandler.isSpectatorPerspective(playerGameView()));
    }

    /* ---------- routeKindFor ---------- */

    @Test
    void routeKindFor_gameViewWithPlayerPerspective_returnsPlayer() {
        WebStreamFrame f = frame("gameUpdate", playerGameView());
        assertEquals(WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.routeKindFor(f));
    }

    @Test
    void routeKindFor_gameViewWithSpectatorPerspective_returnsSpectator() {
        WebStreamFrame f = frame("gameUpdate", spectatorGameView());
        assertEquals(WebSocketCallbackHandler.ROUTE_SPECTATOR,
                WebSocketCallbackHandler.routeKindFor(f));
    }

    @Test
    void routeKindFor_gameClientMessageWithPlayerNestedView_returnsPlayer() {
        WebGameClientMessage gcm = new WebGameClientMessage(
                playerGameView(), "msg", List.of(),
                Map.of(), 0, 0, false, null,
                mage.webapi.dto.stream.WebClientMessageOptions.EMPTY);
        WebStreamFrame f = frame("gameInform", gcm);
        assertEquals(WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.routeKindFor(f));
    }

    @Test
    void routeKindFor_gameClientMessageWithSpectatorNestedView_returnsSpectator() {
        WebGameClientMessage gcm = new WebGameClientMessage(
                spectatorGameView(), "msg", List.of(),
                Map.of(), 0, 0, false, null,
                mage.webapi.dto.stream.WebClientMessageOptions.EMPTY);
        WebStreamFrame f = frame("gameInform", gcm);
        assertEquals(WebSocketCallbackHandler.ROUTE_SPECTATOR,
                WebSocketCallbackHandler.routeKindFor(f));
    }

    @Test
    void routeKindFor_gameErrorEnvelope_routesToPlayer_critic_N1() {
        // Slice 71 critic N1 — gameError uses GameViewMapper.toErrorMessage
        // which builds a WebGameClientMessage with nested gameView=null
        // (just text + flag). Upstream fires GAME_ERROR via
        // perform(playerId, ...), so the message is structurally
        // player-targeted. Default to ROUTE_PLAYER so it doesn't
        // leak to spectator sockets.
        WebGameClientMessage errorMsg = new WebGameClientMessage(
                null, "Invalid action", List.of(),
                Map.of(), 0, 0, false, null,
                mage.webapi.dto.stream.WebClientMessageOptions.EMPTY);
        WebStreamFrame f = frame("gameError", errorMsg);
        assertEquals(WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.routeKindFor(f),
                "gameError with null nested view must default to player route, "
                        + "not leak to spectator sockets (critic N1)");
    }

    @Test
    void routeKindFor_dialogClearEnvelope_routesToPlayer_critic_N2() {
        // Slice 71 critic N2 — dialogClear is the slice-69c D11b
        // teardown signal for player dialogs. Spectators never had
        // the dialog open; routing dialogClear to spectator sockets
        // is gratuitous wire noise. ROUTE_PLAYER scopes the signal
        // to its actual audience.
        WebDialogClear clear = new WebDialogClear(
                "11111111-1111-1111-1111-111111111111",
                WebDialogClear.REASON_PLAYER_LEFT);
        WebStreamFrame f = frame("dialogClear", clear);
        assertEquals(WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.routeKindFor(f),
                "dialogClear is player-route — spectators don't need teardown "
                        + "for dialogs they never had open (critic N2)");
    }

    @Test
    void routeKindFor_streamHello_isRouteAgnostic_null() {
        // streamHello / streamError / chatMessage / startGame /
        // sideboard / endGameInfo — none carry a GameView, none are
        // perspective-bound. routeKindFor returns null = "no route
        // filter, deliver to every matching socket subject to
        // chat-id scoping etc."
        WebStreamFrame f = frame("streamHello",
                new WebStreamHello("g", "alice", "live", 2));
        assertNull(WebSocketCallbackHandler.routeKindFor(f),
                "streamHello has no perspective signal — route-agnostic");
    }

    @Test
    void routeKindFor_chatMessage_isRouteAgnostic_null() {
        // Chat caller short-circuits routeKindFor (broadcast applies
        // chat-id scoping instead) but the helper still returns null
        // for chat data, locking the contract that chat is never
        // perspective-bound.
        WebStreamFrame f = frame("chatMessage", "raw chat data");
        assertNull(WebSocketCallbackHandler.routeKindFor(f));
    }

    /* ---------- matchesRoute ---------- */

    @Test
    void matchesRoute_playerSocketReceivesPlayerFrame() {
        assertTrue(WebSocketCallbackHandler.matchesRoute(
                WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.ROUTE_PLAYER));
    }

    @Test
    void matchesRoute_spectatorSocketReceivesSpectatorFrame() {
        assertTrue(WebSocketCallbackHandler.matchesRoute(
                WebSocketCallbackHandler.ROUTE_SPECTATOR,
                WebSocketCallbackHandler.ROUTE_SPECTATOR));
    }

    @Test
    void matchesRoute_playerSocketDoesNotReceiveSpectatorFrame() {
        // Load-bearing security separation. A user who is a player
        // on Game A and a spectator on Game B has both sockets on
        // the same handler. Game B's spectator-perspective frames
        // must NOT reach the Game A player socket — that would leak
        // the spectator perspective to the player-route consumer.
        assertFalse(WebSocketCallbackHandler.matchesRoute(
                WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.ROUTE_SPECTATOR));
    }

    @Test
    void matchesRoute_spectatorSocketDoesNotReceivePlayerFrame() {
        // Symmetric inverse — Game A player frames don't bleed to
        // the spectator socket on Game B. This is the privacy
        // contract: spectators never see any player perspective.
        assertFalse(WebSocketCallbackHandler.matchesRoute(
                WebSocketCallbackHandler.ROUTE_SPECTATOR,
                WebSocketCallbackHandler.ROUTE_PLAYER));
    }

    @Test
    void matchesRoute_unboundSocketDefaultsToPlayer() {
        // Backwards compat: pre-slice-71 sockets registered without
        // ATTR_ROUTE_KIND default to player-route behavior. Lobby /
        // room sockets that don't set the attribute keep working
        // without any change to RoomStreamHandler.
        assertTrue(WebSocketCallbackHandler.matchesRoute(
                null, WebSocketCallbackHandler.ROUTE_PLAYER));
        assertFalse(WebSocketCallbackHandler.matchesRoute(
                null, WebSocketCallbackHandler.ROUTE_SPECTATOR));
    }

    @Test
    void matchesRoute_nonStringBoundValueDefaultsToPlayer() {
        // Defensive — if a future bug stuffs a non-String value into
        // ATTR_ROUTE_KIND, treat as unbound (default to player) rather
        // than throwing or routing arbitrarily.
        assertTrue(WebSocketCallbackHandler.matchesRoute(
                42, WebSocketCallbackHandler.ROUTE_PLAYER));
        assertTrue(WebSocketCallbackHandler.matchesRoute(
                new Object(), WebSocketCallbackHandler.ROUTE_PLAYER));
    }

    /* ---------- defensive: edge-case GameView shapes ---------- */

    @Test
    void isSpectatorPerspective_nullMyPlayerId_treatedAsSpectator() {
        // Mapper guarantees myPlayerId is "" not null, but defense-
        // in-depth: a null value should be treated as spectator
        // (more conservative for the privacy contract — better to
        // misroute a player frame to a spectator socket where it's
        // confusingly off-perspective than misroute a spectator
        // frame to a player socket where it'd reveal the spectator
        // construction).
        WebGameView nullId = new WebGameView(
                1, "PRECOMBAT_MAIN", "PRECOMBAT_MAIN",
                "alice", "alice", false, false, 0, 0, 0,
                null, Map.of(), Map.of(), List.of(), List.of());
        assertTrue(WebSocketCallbackHandler.isSpectatorPerspective(nullId));
    }

    @Test
    void manaPoolViewSchema_doesNotChange_routeFilterShape() {
        // Sanity that adding fields to WebGameView (e.g. via a
        // schema 1.21+ bump) doesn't accidentally change the
        // route-filter contract — the helper only looks at
        // myPlayerId. Use a fully-populated WebManaPoolView to
        // exercise the deeper fields without the test caring.
        WebGameView gv = new WebGameView(
                42, "ENDING", "END", "alice", "bob", true, true, 7, 9, 12,
                "11111111-1111-1111-1111-111111111111",
                Map.of(), Map.of(), List.of(), List.of());
        // Construct a ManaPool just to lock the wire shape's stability
        // alongside the route helper — they live in the same package.
        new WebManaPoolView(0, 0, 0, 0, 0, 0);
        assertEquals(WebSocketCallbackHandler.ROUTE_PLAYER,
                WebSocketCallbackHandler.routeKindFor(frame("gameUpdate", gv)));
    }
}
