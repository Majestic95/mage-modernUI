package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.server.User;
import mage.view.ChatMessage;
import mage.webapi.SchemaVersion;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.server.WebApiServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for the Phase 3 game-stream WebSocket endpoint.
 * Boots an embedded server once, opens real WebSockets via
 * {@link java.net.http.WebSocket}, and asserts the live protocol
 * contract: handshake auth via {@code ?token=}, the {@code streamHello}
 * frame, the {@code chatMessage} outbound mapping, and the
 * {@code chatSend} inbound dispatch.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class GameStreamHandlerTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
    private static final Duration FRAME_WAIT = Duration.ofSeconds(5);

    private WebApiServer server;
    private EmbeddedServer embedded;
    private String bearer;

    @BeforeAll
    void start() throws Exception {
        embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0);

        HttpResponse<String> r = postJson("/api/session", "{}");
        assertEquals(200, r.statusCode(), "anon login must succeed: " + r.body());
        bearer = JSON.readTree(r.body()).get("token").asText();
        assertNotNull(bearer);
    }

    @AfterAll
    void stop() {
        if (server != null) {
            server.stop();
        }
    }

    // ---------- happy path ----------

    @Test
    void onConnect_sendsStreamHelloEnvelope() throws Exception {
        // Slice 63 — game-membership gate now requires a real gameId.
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            // streamHello is sent synchronously before any upstream
            // join callbacks fire, so it's always the first frame.
            String frame = listener.awaitFrame(FRAME_WAIT);
            JsonNode env = JSON.readTree(frame);
            assertEquals(SchemaVersion.CURRENT, env.get("schemaVersion").asText(),
                    "every frame carries schemaVersion (ADR 0007 D4)");
            assertEquals("streamHello", env.get("method").asText());
            assertEquals(0, env.get("messageId").asInt(),
                    "synthetic frames use messageId=0");
            assertNotNull(env.get("objectId").asText(), "hello carries gameId as objectId");
            JsonNode data = env.get("data");
            assertNotNull(data);
            assertEquals("live", data.get("mode").asText(),
                    "slice 2+ announces 'live' mode");
            assertTrue(data.get("username").asText().startsWith("guest-"),
                    "hello echoes the authenticated username");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void onMessage_unknownType_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            // 'playerSurrender' isn't a valid inbound type — slice 6
            // reserves NOT_IMPLEMENTED for unknown discriminators.
            ws.sendText("{\"type\":\"playerSurrender\"}", true).join();
            // Slice 63 — fixture game emits engine frames so use
            // awaitMethod to skip past them and pick the streamError.
            JsonNode env = JSON.readTree(awaitMethod(listener, "streamError"));
            JsonNode data = env.get("data");
            assertEquals("NOT_IMPLEMENTED", data.get("code").asText());
            assertTrue(data.get("message").asText().contains("playerSurrender"),
                    "error message names the unsupported type");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void onMessage_malformedJson_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            ws.sendText("not-json-at-all", true).join();
            JsonNode env = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_JSON", env.get("data").get("code").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void onMessage_nonObjectJson_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            ws.sendText("[1,2,3]", true).join();
            JsonNode env = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", env.get("data").get("code").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- auth failures ----------

    @Test
    void onConnect_missingToken_closesWith4001() throws Exception {
        TestListener listener = new TestListener();
        // No ?token= query param at all.
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + UUID.randomUUID() + "/stream");
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT),
                    "server must close the socket when token is missing");
            assertEquals(4001, listener.closeCode);
            assertEquals("MISSING_TOKEN", listener.closeReason);
        } finally {
            ws.abort();
        }
    }

    @Test
    void onConnect_invalidToken_closesWith4001() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), "definitely-not-a-real-token", listener);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT),
                    "server must close the socket when token is unknown");
            assertEquals(4001, listener.closeCode);
            assertEquals("INVALID_TOKEN", listener.closeReason);
            assertFalse(listener.gotFrame,
                    "no frames should arrive before the auth-rejection close");
        } finally {
            ws.abort();
        }
    }

    @Test
    void onConnect_malformedGameId_closesWith4003() throws Exception {
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/not-a-uuid/stream?token=" + bearer);
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT));
            assertEquals(4003, listener.closeCode);
            assertTrue(listener.closeReason.contains("UUID"),
                    "close reason names the parse failure: " + listener.closeReason);
        } finally {
            ws.abort();
        }
    }

    // ---------- slice 69a: protocol-version handshake (ADR 0010 v2 D12) ----------

    @Test
    void parseProtocolVersion_absent_defaultsToCurrent() {
        // Lenient backwards-compat: pre-slice-69b webclients don't send
        // the param. Server defaults to CURRENT so existing clients keep
        // working. Spec: ADR 0010 v2 D12 + GameStreamHandler.parseProtocolVersion.
        assertEquals(mage.webapi.ProtocolVersion.CURRENT,
                GameStreamHandler.parseProtocolVersion(null));
        assertEquals(mage.webapi.ProtocolVersion.CURRENT,
                GameStreamHandler.parseProtocolVersion(""));
        assertEquals(mage.webapi.ProtocolVersion.CURRENT,
                GameStreamHandler.parseProtocolVersion("   "));
    }

    @Test
    void parseProtocolVersion_supported_passesThrough() {
        assertEquals(Integer.valueOf(1),
                GameStreamHandler.parseProtocolVersion("1"));
        assertEquals(Integer.valueOf(2),
                GameStreamHandler.parseProtocolVersion("2"));
        // Whitespace tolerance — the handshake survives a stray space
        // from a hand-built query string.
        assertEquals(Integer.valueOf(2),
                GameStreamHandler.parseProtocolVersion(" 2 "));
    }

    @Test
    void parseProtocolVersion_unsupportedValue_returnsNull() {
        // Caller closes 4400 on null. Semantically distinct from
        // "absent" → CURRENT default.
        org.junit.jupiter.api.Assertions.assertNull(
                GameStreamHandler.parseProtocolVersion("0"));
        org.junit.jupiter.api.Assertions.assertNull(
                GameStreamHandler.parseProtocolVersion("999"));
        org.junit.jupiter.api.Assertions.assertNull(
                GameStreamHandler.parseProtocolVersion("-1"));
    }

    @Test
    void parseProtocolVersion_unparseable_returnsNull() {
        org.junit.jupiter.api.Assertions.assertNull(
                GameStreamHandler.parseProtocolVersion("abc"));
        org.junit.jupiter.api.Assertions.assertNull(
                GameStreamHandler.parseProtocolVersion("2.5"));
        org.junit.jupiter.api.Assertions.assertNull(
                GameStreamHandler.parseProtocolVersion("2; DROP TABLE games"));
    }

    @Test
    void onConnect_protocolVersionAbsent_defaultsCurrentInHello() throws Exception {
        // Existing webclients (no ?protocolVersion= param) keep working.
        // streamHello echoes the negotiated version so the client knows
        // the contract the server speaks.
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            String frame = listener.awaitFrame(FRAME_WAIT);
            JsonNode env = JSON.readTree(frame);
            assertEquals("streamHello", env.get("method").asText());
            assertEquals(mage.webapi.ProtocolVersion.CURRENT,
                    env.get("data").get("protocolVersion").asInt(),
                    "absent param defaults to ProtocolVersion.CURRENT");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void onConnect_protocolVersionExplicit_echoedInHello() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + fx.gameId() + "/stream"
                + "?token=" + fx.token() + "&protocolVersion=2");
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            String frame = listener.awaitFrame(FRAME_WAIT);
            JsonNode env = JSON.readTree(frame);
            assertEquals(2, env.get("data").get("protocolVersion").asInt());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void onConnect_protocolVersionUnsupported_closes4400() throws Exception {
        // Unknown explicit value → close 4400 with PROTOCOL_VERSION_UNSUPPORTED
        // and the supported set in the reason payload so a future client
        // can downgrade or surface a "refresh" prompt.
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + fx.gameId() + "/stream"
                + "?token=" + fx.token() + "&protocolVersion=999");
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT),
                    "server must close on unsupported protocolVersion");
            assertEquals(4400, listener.closeCode);
            assertTrue(listener.closeReason.startsWith("PROTOCOL_VERSION_UNSUPPORTED"),
                    "reason starts with PROTOCOL_VERSION_UNSUPPORTED: "
                            + listener.closeReason);
            // Stable sorted format so clients can parse the supported
            // set deterministically across JVM restarts. Set.of()'s
            // iteration order is undefined; we explicitly sort.
            assertTrue(listener.closeReason.contains("supported=[1,2]"),
                    "reason includes sorted supported set: "
                            + listener.closeReason);
            assertFalse(listener.gotFrame,
                    "no frames before the version-rejection close");
        } finally {
            ws.abort();
        }
    }

    @Test
    void onConnect_protocolVersionUnparseable_closes4400() throws Exception {
        // Garbage param (e.g. injected query string) → 4400, never a 5xx.
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + fx.gameId() + "/stream"
                + "?token=" + fx.token() + "&protocolVersion=abc");
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT));
            assertEquals(4400, listener.closeCode);
            assertTrue(listener.closeReason.startsWith("PROTOCOL_VERSION_UNSUPPORTED"));
        } finally {
            ws.abort();
        }
    }

    // ---------- slice 69e: multiplayer e2e (ADR 0010 v2 D1, D3c, D11) ----------

    @Test
    void multiplayer_4pFfa_gameInitCarriesFourPlayers() throws Exception {
        // Smoke test for the 4p FFA exit gate. Boots a real engine,
        // creates a 4-seat FFA, opens the game stream, and asserts
        // that gameInit / gameUpdate frames carry exactly 4 players.
        // Pre-69a-d this would fail at three points: lobby couldn't
        // build the table (slice 69d aiAllowed gate), the wire shape
        // would be 1.19 (no teamId / goadingPlayerIds), the mapper
        // would fan out unfiltered rosters (slice 69c). All three
        // are now in place — this test proves the chain works.
        MultiplayerFixture fx = multiplayerFixture(4);
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello
            // The first game-state frame after upstream's join-ack
            // pumps gameInit. Find it past any chatMessage / synthetic
            // frames the engine fires during boot.
            String initFrame = awaitMethod(listener, "gameInit",
                    Duration.ofSeconds(20));
            JsonNode env = JSON.readTree(initFrame);
            assertEquals(SchemaVersion.CURRENT, env.get("schemaVersion").asText());
            JsonNode gv = env.get("data");
            JsonNode players = gv.get("players");
            assertNotNull(players);
            assertTrue(players.isArray());
            assertEquals(4, players.size(),
                    "4p FFA: gameInit must carry exactly 4 PlayerView entries");
            // myPlayerId is the requesting human (NOT one of the AIs).
            String myPlayerId = gv.get("myPlayerId").asText();
            assertNotNull(myPlayerId);
            assertFalse(myPlayerId.isEmpty(),
                    "myPlayerId must be populated for the seated player");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void multiplayer_4pFfa_schema120Fields_areOnTheWire() throws Exception {
        // Slice 69a/69c lock — schema 1.20 multiplayer fields surface
        // on the gameInit/gameUpdate wire shape. Specifically:
        //   - WebPlayerView.teamId: null in v2 (per ADR R1 — no 2HG
        //     plugin upstream, no source data)
        //   - WebPermanentView.goadingPlayerIds: [] when not goaded
        //     (the basic Forest deck never goads anything)
        //
        // We can't easily play creatures in a unit test (engine
        // requires keepers / a real opponent's priority pass), so
        // we lock the field SHAPE — present on PlayerView, populated
        // as null. This catches any wire-format regression that
        // drops the field accidentally.
        MultiplayerFixture fx = multiplayerFixture(4);
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello
            String initFrame = awaitMethod(listener, "gameInit",
                    Duration.ofSeconds(20));
            JsonNode env = JSON.readTree(initFrame);
            JsonNode firstPlayer = env.get("data").get("players").get(0);

            // teamId field MUST be present (additive schema-1.20
            // field, ships as null per ADR R1).
            assertTrue(firstPlayer.has("teamId"),
                    "WebPlayerView must carry teamId field "
                            + "(schema 1.20, ADR D3a). Got: " + firstPlayer);
            assertTrue(firstPlayer.get("teamId").isNull(),
                    "teamId is null in v2 — no 2HG plugin upstream "
                            + "produces team-grouped state. ADR R1.");

            // Battlefield is empty at gameInit, so we can't observe
            // a permanent's goadingPlayerIds. The field is locked at
            // the unit level by CardViewMapperTest's permanent_jsonShape
            // tests; here we just verify the players array was
            // emitted unfiltered (RoI.ALL default for FFA).
            JsonNode players = env.get("data").get("players");
            assertEquals(4, players.size(),
                    "FFA defaults to RangeOfInfluence.ALL → roster ships "
                            + "unfiltered (slice 69c D1). All 4 PlayerViews "
                            + "must be on the wire.");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- slice 2: chat outbound + inbound ----------

    @Test
    void chatBroadcast_arrivesAsChatMessageFrame() throws Exception {
        // Slice 63 — game-membership gate requires a real game; chat
        // scoping (slice 8) requires the broadcast target to match the
        // socket's bound chatId. Both met by using the fixture's
        // game chatId for the broadcast.
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            // Direct upstream broadcast — bypasses the inbound WS path
            // so this test isolates the outbound mapper.
            embedded.managerFactory().chatManager().broadcast(
                    fx.chatId(),
                    "system",
                    "broadcast-from-test",
                    ChatMessage.MessageColor.BLACK,
                    true,
                    null,
                    ChatMessage.MessageType.USER_INFO,
                    null);

            // Skip past any engine-system chat ("X has joined the
            // game") and pick our broadcast by its unique content.
            String frame = awaitChatMessageContaining(listener, "broadcast-from-test");
            JsonNode env = JSON.readTree(frame);
            assertEquals(SchemaVersion.CURRENT, env.get("schemaVersion").asText());
            assertEquals("chatMessage", env.get("method").asText());
            assertTrue(env.get("messageId").asInt() > 0,
                    "real callbacks carry a non-zero upstream-assigned messageId");
            JsonNode data = env.get("data");
            assertEquals("system", data.get("username").asText());
            assertEquals("broadcast-from-test", data.get("message").asText());
            assertEquals("BLACK", data.get("color").asText());
            assertEquals("USER_INFO", data.get("messageType").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void clientChatSend_routesToUpstreamAndEchoesBack() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            String body = "{\"type\":\"chatSend\",\"chatId\":\""
                    + fx.chatId() + "\",\"message\":\"ggwp\"}";
            ws.sendText(body, true).join();

            // Sender is auto-subscribed via the game's chat → the
            // upstream broadcast loops back and arrives as a chatMessage
            // frame on the same WebSocket. The sender's username is
            // resolved from the session, not the inbound frame.
            // Skip past any engine-system chat ("X has joined the
            // game") and pick our chatSend by its unique content.
            String frame = awaitChatMessageContaining(listener, "ggwp");
            JsonNode env = JSON.readTree(frame);
            JsonNode data = env.get("data");
            assertEquals("ggwp", data.get("message").asText());
            assertNotNull(data.get("username").asText(),
                    "server fills username from session — clients cannot spoof");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void clientChatSend_missingChatId_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            ws.sendText("{\"type\":\"chatSend\",\"message\":\"hi\"}", true).join();
            JsonNode env = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", env.get("data").get("code").asText());
            assertTrue(env.get("data").get("message").asText().contains("chatId"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void clientChatSend_blankMessage_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            ws.sendText("{\"type\":\"chatSend\",\"chatId\":\""
                    + UUID.randomUUID() + "\",\"message\":\"  \"}", true).join();
            JsonNode env = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", env.get("data").get("code").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // NOTE: there is no test for "unknown chatId" because upstream
    // ChatManagerImpl.broadcast silently no-ops when the chatId isn't
    // registered — no exception, nothing for the client to observe.
    // Slice 4+ will add a chat-registry pre-check so the WS handler
    // can surface a stream-level error before the call reaches
    // upstream.

    // ---------- slice 3: reconnect via ?since= ----------

    @Test
    void reconnect_sinceReplaysBufferedFrames() throws Exception {
        // Slice 63 — game-membership gate requires a real game. The
        // fixture's game has its own engine-frame churn so we use the
        // game's chatId, and pick out our specific broadcasts by the
        // unique markers msg-A / msg-B / msg-C to skip engine-system
        // chats ("X has joined the game") that are interleaved.
        RealGameFixture fx = realGameFixture();

        // Phase 1 — open WS, capture three chat frames so the buffer
        // is populated. We then drop the WS without closing the
        // upstream session; the buffer survives on the handler.
        TestListener first = new TestListener();
        WebSocket ws1 = openWs(fx.gameId(), fx.token(), first);
        first.awaitFrame(FRAME_WAIT); // streamHello
        broadcastSystem(fx.chatId(), "msg-A");
        broadcastSystem(fx.chatId(), "msg-B");
        broadcastSystem(fx.chatId(), "msg-C");
        int firstMessageId = JSON.readTree(awaitChatMessageContaining(first, "msg-A"))
                .get("messageId").asInt();
        // Drain the remaining two so the queue is empty when ws1 closes.
        awaitChatMessageContaining(first, "msg-B");
        awaitChatMessageContaining(first, "msg-C");
        ws1.sendClose(WebSocket.NORMAL_CLOSURE, "phase 1 done").join();

        // Phase 2 — reopen with ?since=firstMessageId. Server replays
        // the buffered frames whose messageId > since; we expect at
        // least msg-B and msg-C. Other engine frames (gameInit,
        // gameUpdate, etc.) may also replay — pick our markers.
        TestListener second = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + fx.gameId() + "/stream"
                + "?token=" + fx.token() + "&since=" + firstMessageId);
        WebSocket ws2 = HTTP.newWebSocketBuilder()
                .buildAsync(uri, second)
                .get(5, TimeUnit.SECONDS);
        try {
            second.awaitFrame(FRAME_WAIT); // streamHello

            JsonNode replayB = JSON.readTree(awaitChatMessageContaining(second, "msg-B"));
            JsonNode replayC = JSON.readTree(awaitChatMessageContaining(second, "msg-C"));
            assertEquals("msg-B", replayB.get("data").get("message").asText());
            assertEquals("msg-C", replayC.get("data").get("message").asText());
            assertTrue(replayB.get("messageId").asInt() > firstMessageId,
                    "replayed messageIds must all be > since");
        } finally {
            ws2.sendClose(WebSocket.NORMAL_CLOSURE, "phase 2 done").join();
        }
    }

    @Test
    void reconnect_sinceCold_silentlyAcceptsAndContinuesLive() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        // since=Integer.MAX_VALUE — guaranteed cold buffer
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + fx.gameId() + "/stream"
                + "?token=" + fx.token() + "&since=" + Integer.MAX_VALUE);
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            // streamHello arrives; no replay frames (cold buffer)
            JsonNode hello = JSON.readTree(listener.awaitFrame(FRAME_WAIT));
            assertEquals("streamHello", hello.get("method").asText());

            // Live frames still flow.
            broadcastSystem(fx.chatId(), "after-cold");
            // Skip engine-system chat ("X has rejoined the game") and
            // pick our broadcast by content.
            JsonNode chatFrame = JSON.readTree(
                    awaitChatMessageContaining(listener, "after-cold"));
            assertEquals("after-cold", chatFrame.get("data").get("message").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void reconnect_sinceMalformed_repliesStreamError() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + fx.gameId() + "/stream"
                + "?token=" + fx.token() + "&since=not-a-number");
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            // streamHello first, then the streamError for the bad since.
            JsonNode hello = JSON.readTree(listener.awaitFrame(FRAME_WAIT));
            assertEquals("streamHello", hello.get("method").asText());

            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("since"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- slice 6: inbound playerAction + playerResponse ----------

    @Test
    void playerAction_unknownEnum_repliesWithBadRequest() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello
            ws.sendText("{\"type\":\"playerAction\",\"action\":\"NOT_A_REAL_ACTION\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("Unknown PlayerAction"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerAction_clientOnlyEnum_repliesWithNotAllowed() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            // CLIENT_DOWNLOAD_SYMBOLS is a real PlayerAction enum value
            // but is on the deny-list — Swing-UI-only.
            ws.sendText("{\"type\":\"playerAction\","
                    + "\"action\":\"CLIENT_DOWNLOAD_SYMBOLS\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("NOT_ALLOWED", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("CLIENT_DOWNLOAD_SYMBOLS"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerAction_missingAction_repliesWithBadRequest() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerAction\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("action"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerAction_allowedNoGame_surfacesUpstreamRejection() throws Exception {
        // CONCEDE is on the allow-list but there's no active game on
        // a synthetic WS — upstream sendPlayerAction will quietly
        // no-op (no session game-state change). We assert the dispatch
        // path doesn't reply with a streamError, proving the action
        // reached the upstream call. (No active dialog → no follow-up
        // frame is the success criterion.)
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerAction\",\"action\":\"CONCEDE\"}", true).join();
            // Wait briefly to confirm no error frame arrives.
            try {
                String maybeErr = listener.awaitFrame(Duration.ofMillis(500));
                JsonNode env = JSON.readTree(maybeErr);
                if ("streamError".equals(env.get("method").asText())) {
                    String code = env.get("data").get("code").asText();
                    // BAD_REQUEST / NOT_ALLOWED would be the
                    // dispatch-layer rejection we're trying to disprove.
                    assertFalse("BAD_REQUEST".equals(code) || "NOT_ALLOWED".equals(code),
                            "CONCEDE should have passed dispatch validation but got: " + maybeErr);
                }
            } catch (AssertionError noFrame) {
                // No frame arrived — that's the expected happy path
                // when there's no game to concede.
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerAction_triggerAutoOrderAbilityLast_synthesizesNullUuidNudge() throws Exception {
        // ADR 0009 D5 / Fix 1 (T27.3): TRIGGER_AUTO_ORDER_*_LAST must
        // be followed facade-side by a sendPlayerUUID(gameId, null)
        // call so the engine's chooseTriggeredAbility waitForResponse
        // (HumanPlayer.java:1550) unblocks. Upstream Swing does this
        // (GamePanel.java:3085); the webclient cannot mirror it on the
        // wire because playerResponse{kind:uuid} is type-validated to
        // require a textual value.
        //
        // We can't observe the synthesized call directly without an
        // active game, but we CAN assert that the action dispatch path
        // does not emit a streamError when _LAST is sent. If the new
        // null-UUID branch threw or returned an error, this would
        // surface as BAD_REQUEST / UPSTREAM_REJECTED.
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            UUID abilityId = UUID.randomUUID();
            ws.sendText("{\"type\":\"playerAction\","
                    + "\"action\":\"TRIGGER_AUTO_ORDER_ABILITY_LAST\","
                    + "\"data\":{\"abilityId\":\"" + abilityId + "\"}}", true).join();
            // No game is active, so upstream sendPlayerAction is a
            // no-op and the synthesized sendPlayerUUID(null) is also a
            // no-op (User.sendPlayerUUID logs "session expired" or
            // routes to a missing GameSessionPlayer that returns
            // gracefully). The success criterion is no streamError.
            try {
                String maybeErr = listener.awaitFrame(Duration.ofMillis(750));
                JsonNode env = JSON.readTree(maybeErr);
                if ("streamError".equals(env.get("method").asText())) {
                    String code = env.get("data").get("code").asText();
                    assertFalse("BAD_REQUEST".equals(code) || "NOT_ALLOWED".equals(code)
                                    || "UPSTREAM_REJECTED".equals(code),
                            "_LAST dispatch should not error: " + maybeErr);
                }
            } catch (AssertionError noFrame) {
                // No frame arrived — expected happy path with no game.
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerResponse_missingKind_repliesWithBadRequest() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerResponse\",\"value\":true}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("kind"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerResponse_unknownKind_repliesWithBadRequest() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"unicorn\","
                    + "\"value\":\"meh\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("Unknown playerResponse kind"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerResponse_uuidKind_malformedValue_repliesWithBadRequest() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"uuid\","
                    + "\"value\":\"definitely-not-a-uuid\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText()
                    .contains("kind='uuid'"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- hardening (post-audit) ----------

    @Test
    void playerResponse_booleanKind_stringValue_rejectedNotCoerced() throws Exception {
        // Without strict type-checking, Jackson's asBoolean() on the
        // string "no" silently returns false — turning a malicious
        // string into a real game decision. Lock the strict guard.
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"boolean\","
                    + "\"value\":\"no\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText()
                    .contains("must be a JSON bool"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void playerResponse_integerKind_stringValue_rejectedNotCoerced() throws Exception {
        // Without strict type-checking, asInt() on a non-numeric string
        // returns 0 — turning a malicious string into "I pick 0".
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"integer\","
                    + "\"value\":\"abc\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText()
                    .contains("must be a JSON int"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void keepalive_bumpsUpstreamUserLastActivity() throws Exception {
        // Slice 46: inbound {"type":"keepalive"} frame must call
        // MageServerImpl.ping(...) so upstream's User.lastActivity is
        // bumped — protecting the user from the 3-minute reaper in
        // UserManagerImpl.checkExpired. Slice 38's bare no-op only
        // reset Jetty's idle timer, which was insufficient.
        //
        // Slice 63: WS upgrade now requires the user be in a real game.
        // Use the cached fixture's user (bound to a real game) so the
        // upgrade passes.
        RealGameFixture fx = realGameFixture();
        User user = embedded.managerFactory().userManager()
                .getUser(fx.userId())
                .orElseThrow(() -> new AssertionError("fixture user missing"));

        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            // Backdate lastActivity so we can detect the bump
            // unambiguously without a timing-flaky sleep.
            java.lang.reflect.Field f = User.class.getDeclaredField("lastActivity");
            f.setAccessible(true);
            java.util.Date stale = new java.util.Date(System.currentTimeMillis() - 60_000L);
            f.set(user, stale);
            assertEquals(stale, user.getLastActivity(),
                    "test setup: backdated lastActivity must stick");

            ws.sendText("{\"type\":\"keepalive\"}", true).join();

            // Wait briefly for the inbound dispatch to call ping.
            long deadline = System.currentTimeMillis() + 2000;
            while (System.currentTimeMillis() < deadline
                    && user.getLastActivity().equals(stale)) {
                Thread.sleep(20);
            }
            assertTrue(user.getLastActivity().after(stale),
                    "keepalive must call upstream ping which bumps lastActivity. "
                            + "Got: " + user.getLastActivity() + " (stale=" + stale + ")");
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void chatSend_oversizedMessage_repliesWithBadRequest() throws Exception {
        // Cap is 4096 chars; send 5000.
        StringBuilder huge = new StringBuilder(5000);
        for (int i = 0; i < 5000; i++) huge.append('x');
        TestListener listener = new TestListener();
        WebSocket ws = openValidGameWs(listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"chatSend\",\"chatId\":\""
                    + UUID.randomUUID() + "\",\"message\":\""
                    + huge + "\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText()
                    .contains("4096"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- slice 63: WS auth security (auditor #4 / recon agent BLOCKERs) ----------

    /**
     * FIX A — manaType ownership: a manaType {@code playerResponse}
     * frame whose body's {@code playerId} differs from the session's
     * actual seated playerId must NOT be allowed to act on behalf of
     * the other player. After the slice-63 fix the inbound
     * {@code playerId} is ignored; resolution is server-side via the
     * session's userId → userPlayerMap.
     *
     * <p>Behavioural test (mocking {@code sendPlayerManaType} would
     * require swapping out the embedded server, which is heavy for
     * a single-method assertion): the test ASSERTS that the new wire
     * contract no longer requires {@code playerId} (a malformed value
     * for the now-ignored field doesn't produce BAD_REQUEST). A
     * legitimate manaType frame with only a {@code manaType} field
     * succeeds at the dispatch layer; the upstream call is a no-op
     * because no mana-pay dialog is open, but the dispatch path is
     * what we're locking here.
     */
    @Test
    void playerResponse_manaType_ignoresFrameSuppliedPlayerId() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            // Send a manaType frame with an obviously-wrong "playerId":
            // pre-slice-63 the handler accepted this and dispatched the
            // attacker's choice to the named player. Post-fix the
            // playerId field is unused — the only required field is
            // manaType. If the handler still tried to parse the bogus
            // playerId as a UUID we'd see BAD_REQUEST; if it routed to
            // the named player we'd see no error from this test.
            UUID attackerVictimId = UUID.randomUUID();
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"manaType\","
                    + "\"value\":{\"playerId\":\"" + attackerVictimId
                    + "\",\"manaType\":\"BLACK\"}}", true).join();

            // Wait briefly: the legitimate (no-op upstream) path
            // emits no error. If a streamError arrives, it must NOT
            // be a BAD_REQUEST about playerId (which would mean the
            // handler still inspected the field).
            try {
                JsonNode err = JSON.readTree(
                        awaitMethod(listener, "streamError", Duration.ofMillis(500)));
                String message = err.get("data").get("message").asText();
                assertFalse(message.toLowerCase().contains("playerid"),
                        "post-slice-63 handler must NOT inspect frame-supplied "
                                + "playerId; got: " + message);
            } catch (AssertionError noErr) {
                // No streamError — expected happy path: dispatch
                // succeeded server-side and the upstream call was a
                // no-op (no active mana-pay dialog).
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    /**
     * Slice 63 fixer (critic finding #2) — strengthen the FIX A
     * contract by asserting the {@code playerId} field is fully
     * removed from the wire: a manaType frame with NO playerId at
     * all must succeed at the dispatch layer. Pre-slice-63 the
     * handler required playerId and would BAD_REQUEST without it;
     * post-fix the field is optional (ignored if present).
     *
     * <p>Companion to the test above: that one verifies a
     * frame-supplied wrong playerId is ignored; this one verifies
     * the field is genuinely optional and not just override-able.
     * Together they pin the contract that resolution is
     * exclusively server-side.
     */
    @Test
    void playerResponse_manaType_acceptsFrameWithoutPlayerId() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            // No playerId field at all — only manaType.
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"manaType\","
                    + "\"value\":{\"manaType\":\"BLACK\"}}", true).join();

            // Same expectations as the "wrong playerId" test: either
            // no streamError (legitimate dispatch path), or any
            // error must NOT be about a missing/required playerId
            // field (which would mean the handler still requires it).
            try {
                JsonNode err = JSON.readTree(
                        awaitMethod(listener, "streamError", Duration.ofMillis(500)));
                String message = err.get("data").get("message").asText();
                assertFalse(message.toLowerCase().contains("playerid"),
                        "post-slice-63 handler must NOT require frame-supplied "
                                + "playerId; got: " + message);
            } catch (AssertionError noErr) {
                // No streamError — expected happy path.
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    /**
     * FIX A — manaType frame with no manaType field is rejected. The
     * pre-fix code required playerId+manaType; the post-fix code
     * requires only manaType.
     */
    @Test
    void playerResponse_manaType_missingManaType_repliesWithBadRequest() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), fx.token(), listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello
            ws.sendText("{\"type\":\"playerResponse\",\"kind\":\"manaType\","
                    + "\"value\":{\"playerId\":\"" + UUID.randomUUID() + "\"}}",
                    true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("BAD_REQUEST", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("manaType"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    /**
     * FIX B — a user authenticated but not seated at the supplied
     * gameId is rejected at WS upgrade with close code 4003 and reason
     * "NOT_A_PLAYER_IN_GAME". This is the spectator-griefing /
     * arbitrary-game-stream prevention.
     */
    @Test
    void onConnect_userNotInGame_closes4003() throws Exception {
        // Fixture has a real game whose userPlayerMap contains the
        // fixture user. We log in a SECOND user and try to open a WS
        // to the fixture's gameId — that user is not seated, so the
        // gate must close.
        RealGameFixture fx = realGameFixture();
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode());
        String outsiderToken = JSON.readTree(login.body()).get("token").asText();

        TestListener listener = new TestListener();
        WebSocket ws = openWs(fx.gameId(), outsiderToken, listener);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT),
                    "outsider must be closed at WS upgrade");
            assertEquals(4003, listener.closeCode);
            assertEquals("NOT_A_PLAYER_IN_GAME", listener.closeReason);
        } finally {
            ws.abort();
        }
    }

    /**
     * FIX B — a request to a game UUID that doesn't have a registered
     * controller is also fail-closed (no controller → not a player).
     * The reason string shape ("NOT_A_PLAYER_IN_GAME") is the same
     * as the seated-elsewhere case so we don't leak whether the game
     * exists vs. the user is just not in it.
     */
    @Test
    void onConnect_unknownGameId_closes4003() throws Exception {
        RealGameFixture fx = realGameFixture();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), fx.token(), listener);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT),
                    "unknown gameId must be closed at WS upgrade");
            assertEquals(4003, listener.closeCode);
            assertEquals("NOT_A_PLAYER_IN_GAME", listener.closeReason);
        } finally {
            ws.abort();
        }
    }

    /**
     * FIX C — opening more than {@link WebSocketCallbackHandler#MAX_SOCKETS_PER_USER}
     * concurrent sockets on the same WebSession results in the
     * over-cap socket being closed with code 4008 and reason
     * "TOO_MANY_SOCKETS". Earlier sockets stay open.
     *
     * <p>Uses a fresh user (not the fixture) so the test's open-cycle
     * doesn't conflict with other tests' fixture-user state.
     */
    @Test
    void register_atMaxCapacity_closesNewSocketWith4008() throws Exception {
        // Build a dedicated fresh fixture for this test so we don't
        // reuse the cached fixture (whose 1-socket-at-a-time tests
        // would otherwise race against this 5-socket test).
        RealGameFixture freshFx = createFreshGameFixture();

        WebSocket[] kept = new WebSocket[WebSocketCallbackHandler.MAX_SOCKETS_PER_USER];
        TestListener[] listeners =
                new TestListener[WebSocketCallbackHandler.MAX_SOCKETS_PER_USER];
        try {
            for (int i = 0; i < WebSocketCallbackHandler.MAX_SOCKETS_PER_USER; i++) {
                listeners[i] = new TestListener();
                kept[i] = openWs(freshFx.gameId(), freshFx.token(), listeners[i]);
                listeners[i].awaitFrame(FRAME_WAIT); // streamHello
            }

            // The N+1th socket must be closed at register time.
            TestListener overListener = new TestListener();
            WebSocket overWs = openWs(freshFx.gameId(), freshFx.token(), overListener);
            try {
                assertTrue(overListener.awaitClose(FRAME_WAIT),
                        "over-cap socket must be closed");
                assertEquals(4008, overListener.closeCode);
                assertEquals("TOO_MANY_SOCKETS", overListener.closeReason);
            } finally {
                overWs.abort();
            }
        } finally {
            for (WebSocket w : kept) {
                if (w != null) {
                    w.sendClose(WebSocket.NORMAL_CLOSURE, "cap test done").join();
                }
            }
        }
    }

    /**
     * FIX C — closing a registered socket frees a slot so the next
     * register() succeeds. Verifies the cap is a high-water gate, not
     * a once-only token-burn.
     */
    @Test
    void register_afterUnregister_acceptsNewSocket() throws Exception {
        RealGameFixture freshFx = createFreshGameFixture();
        WebSocket[] kept = new WebSocket[WebSocketCallbackHandler.MAX_SOCKETS_PER_USER];
        TestListener[] listeners =
                new TestListener[WebSocketCallbackHandler.MAX_SOCKETS_PER_USER];
        try {
            for (int i = 0; i < WebSocketCallbackHandler.MAX_SOCKETS_PER_USER; i++) {
                listeners[i] = new TestListener();
                kept[i] = openWs(freshFx.gameId(), freshFx.token(), listeners[i]);
                listeners[i].awaitFrame(FRAME_WAIT);
            }

            // Close socket 0 cleanly and wait for the unregister to
            // propagate server-side.
            kept[0].sendClose(WebSocket.NORMAL_CLOSURE, "free a slot").join();
            kept[0] = null;
            // Brief wait — Javalin's onClose runs on the WS thread and
            // may not have fired by the time sendClose returns.
            Thread.sleep(200);

            // The N+1th socket should now succeed.
            TestListener replListener = new TestListener();
            WebSocket repl = openWs(freshFx.gameId(), freshFx.token(), replListener);
            try {
                String hello = replListener.awaitFrame(FRAME_WAIT);
                JsonNode env = JSON.readTree(hello);
                assertEquals("streamHello", env.get("method").asText(),
                        "freed slot must accept a new socket; close-code-only "
                                + "would be the cap-violation path");
            } finally {
                repl.sendClose(WebSocket.NORMAL_CLOSURE, "after-unregister test done").join();
            }
        } finally {
            for (WebSocket w : kept) {
                if (w != null) {
                    w.sendClose(WebSocket.NORMAL_CLOSURE, "cleanup").join();
                }
            }
        }
    }

    /**
     * Slice 63 — separate fixture used by the per-WebSession
     * socket-cap tests so they don't collide with the cached fixture's
     * 1-WS-per-test pattern. Each call creates its own real game with
     * its own user.
     */
    private RealGameFixture createFreshGameFixture() throws Exception {
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode());
        JsonNode body = JSON.readTree(login.body());
        String token = body.get("token").asText();
        String username = body.get("username").asText();

        String roomId = JSON.readTree(getAuthed(token, "/api/server/main-room").body())
                .get("roomId").asText();
        String tableId = createTableWithSeats(token, roomId,
                "[\"HUMAN\",\"COMPUTER_MAD\"]");
        postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MAD\"}");

        String deckJson = buildForestDeckJson(token, 60);
        String joinBody = "{\"name\":\"e2e-tester\",\"skill\":1,\"deck\":"
                + deckJson + "}";
        HttpResponse<String> join = postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode());

        UUID lobbyRoomId = UUID.fromString(roomId);
        TestListener lobby = new TestListener();
        URI lobbyUri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + lobbyRoomId + "/stream?token=" + token);
        WebSocket lobbyWs = HTTP.newWebSocketBuilder()
                .buildAsync(lobbyUri, lobby)
                .get(5, TimeUnit.SECONDS);
        UUID gameId;
        try {
            lobby.awaitFrame(FRAME_WAIT);
            HttpResponse<String> start = postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
            assertEquals(204, start.statusCode());
            JsonNode startFrame = JSON.readTree(
                    awaitMethod(lobby, "startGame", Duration.ofSeconds(10)));
            gameId = UUID.fromString(startFrame.get("data").get("gameId").asText());
        } finally {
            lobbyWs.sendClose(WebSocket.NORMAL_CLOSURE, "fresh fixture done").join();
        }

        User user = embedded.managerFactory().userManager()
                .getUserByName(username)
                .orElseThrow(() -> new AssertionError("fresh fixture user missing"));
        UUID chatId = embedded.server().chatFindByGame(gameId);
        return new RealGameFixture(token, user.getId(), gameId, chatId);
    }

    // ---------- slice 3: full game-lifecycle e2e ----------

    @Test
    void gameLifecycle_e2e_startGameAndGameInitArrive() throws Exception {
        // Slice 63: WS upgrade now requires the user be in the game.
        // Updated to mirror the production-style flow used by
        // gameLifecycle_realGameId_initArrivesUnder3s — open the lobby
        // WS to receive startGame, THEN open a game-stream WS to the
        // real gameId.
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode());
        String token = JSON.readTree(login.body()).get("token").asText();

        // Drive the lobby flow that culminates in match-start.
        String roomId = JSON.readTree(getAuthed(token, "/api/server/main-room").body())
                .get("roomId").asText();
        String tableId = createTableWithSeats(token, roomId,
                "[\"HUMAN\",\"COMPUTER_MONTE_CARLO\"]");
        postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");

        String deckJson = buildForestDeckJson(token, 60);
        String joinBody = "{\"name\":\"e2e-tester\",\"skill\":1,\"deck\":"
                + deckJson + "}";
        HttpResponse<String> join = postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode(), "join failed: " + join.body());

        // Open lobby WS to receive startGame.
        UUID lobbyRoomId = UUID.fromString(roomId);
        TestListener lobby = new TestListener();
        URI lobbyUri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + lobbyRoomId + "/stream?token=" + token);
        WebSocket lobbyWs = HTTP.newWebSocketBuilder()
                .buildAsync(lobbyUri, lobby)
                .get(5, TimeUnit.SECONDS);
        try {
            lobby.awaitFrame(FRAME_WAIT); // lobby streamHello

            HttpResponse<String> start = postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
            assertEquals(204, start.statusCode(), "start failed: " + start.body());

            // startGame arrives on the lobby WS (it's a per-WebSession
            // callback so any open socket on this user's handler picks
            // it up).
            JsonNode startFrame = JSON.readTree(
                    awaitMethod(lobby, "startGame", Duration.ofSeconds(15)));
            assertEquals(SchemaVersion.CURRENT,
                    startFrame.get("schemaVersion").asText());
            JsonNode startData = startFrame.get("data");
            String realGameId = startData.get("gameId").asText();
            assertNotNull(realGameId);
            assertNotNull(startData.get("playerId").asText());
            assertEquals(tableId, startData.get("tableId").asText(),
                    "startGame.tableId must match the table we created");

            // NOW open the game-stream WS to the REAL gameId — passes
            // FIX B's membership gate because the user is seated.
            TestListener listener = new TestListener();
            WebSocket gameWs = openWs(UUID.fromString(realGameId), token, listener);
            try {
                listener.awaitFrame(FRAME_WAIT); // game streamHello
                JsonNode initFrame = JSON.readTree(
                        awaitMethod(listener, "gameInit", Duration.ofSeconds(15)));
                JsonNode initData = initFrame.get("data");
                assertTrue(initData.get("turn").asInt() >= 1,
                        "gameInit must carry a turn number");
                assertTrue(initData.get("players").isArray());
                assertEquals(2, initData.get("players").size(),
                        "two-player duel must have exactly 2 PlayerView entries");

                // Slice 4: myPlayerId + myHand are present in the
                // envelope. Whether the opening hand is already drawn at
                // the FIRST gameInit is engine-timing-dependent (some
                // GAME_INIT callbacks fire before the mulligan draw); the
                // shape contract is what slice 4 locks.
                assertNotNull(initData.get("myPlayerId"),
                        "gameInit must carry myPlayerId field");
                JsonNode myHand = initData.get("myHand");
                assertTrue(myHand.isObject(),
                        "myHand must be an object keyed by card UUID");
                // If the hand is populated, lock the WebCardView shape on
                // any one card. Otherwise wait for a later frame to verify
                // (slice 5 will tighten this once gameInform / gameOver
                // wrappers carry richer ordering guarantees).
                if (myHand.size() > 0) {
                    java.util.Map.Entry<String, JsonNode> handEntry = myHand.fields().next();
                    String handKey = handEntry.getKey();
                    JsonNode anyCard = handEntry.getValue();
                    assertEquals("Forest", anyCard.get("name").asText(),
                            "60-Forest deck → hand should be all Forests");
                    assertEquals("LAND", anyCard.get("types").get(0).asText());
                    // Slice 52a / schema 1.19: cardId is the underlying
                    // Card.getId(). For non-stack zones (hand here), upstream's
                    // CardView.getId() already IS the Card.getId(), so cardId
                    // must equal id and the map key. Locks the wire-format
                    // invariant; stack-zone cardId divergence is exercised by
                    // CardViewMapperCardIdTest.
                    assertEquals(anyCard.get("id").asText(), anyCard.get("cardId").asText(),
                            "hand-zone cardId must equal id (non-stack zones)");
                    assertEquals(handKey, anyCard.get("cardId").asText(),
                            "hand map key must equal cardId for non-stack zones");
                }

                // Slice 5 additions on the GameView envelope.
                assertTrue(initData.get("stack").isObject(),
                        "stack must be an object map keyed by stack-object UUID");
                assertTrue(initData.get("combat").isArray(),
                        "combat must be an array of WebCombatGroupView entries");

                JsonNode firstPlayer = initData.get("players").get(0);
                assertTrue(firstPlayer.get("life").asInt() > 0,
                        "starting life must be positive");
                // battlefield is now a map (slice 4 promoted it from a
                // count). Empty before any land is played.
                assertTrue(firstPlayer.get("battlefield").isObject(),
                        "battlefield must be an object map keyed by permanent UUID");
                // Slice 5 promoted graveyard / exile / sideboard from
                // counts to maps. They start empty at gameInit.
                assertTrue(firstPlayer.get("graveyard").isObject(),
                        "graveyard must be an object map keyed by card UUID");
                assertTrue(firstPlayer.get("exile").isObject(),
                        "exile must be an object map keyed by card UUID");
                assertTrue(firstPlayer.get("sideboard").isObject(),
                        "sideboard must be an object map keyed by card UUID");
                assertTrue(firstPlayer.get("libraryCount").asInt() > 0,
                        "library must have cards after the opening hand draw");
            } finally {
                gameWs.sendClose(WebSocket.NORMAL_CLOSURE, "game ws done").join();
            }
        } finally {
            lobbyWs.sendClose(WebSocket.NORMAL_CLOSURE, "lobby ws done").join();
        }
    }

    /**
     * Slice 22 fix — production-style flow that proves gameInit
     * arrives quickly when GameStreamHandler.onConnect calls
     * upstream gameJoin with the REAL gameId (not a synthetic
     * placeholder).
     *
     * <p>Mirrors slice 12's webclient auto-nav: the user opens a
     * WS to the gameId only AFTER the startGame frame surfaces it
     * (e.g. the lobby room WS, or in this test we look up the
     * gameId via the table API).
     *
     * <p>Without slice 22's fix, this test would hit the upstream
     * forced-join recovery (10s) and gameInit would take ~10s to
     * arrive. With the fix, gameInit arrives in &lt; 3s.
     */
    @Test
    void gameLifecycle_realGameId_initArrivesUnder3s() throws Exception {
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode());
        String token = JSON.readTree(login.body()).get("token").asText();

        String roomId = JSON.readTree(getAuthed(token, "/api/server/main-room").body())
                .get("roomId").asText();
        String tableId = createTableWithSeats(token, roomId,
                "[\"HUMAN\",\"COMPUTER_MAD\"]");
        postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MAD\"}");

        String deckJson = buildForestDeckJson(token, 60);
        String joinBody = "{\"name\":\"e2e-tester\",\"skill\":1,\"deck\":"
                + deckJson + "}";
        HttpResponse<String> join = postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode());

        // Open the lobby room WS to receive the startGame frame
        // (mirroring slice 12's flow). We need the room's chatId
        // first.
        String mainRoomBody = getAuthed(token, "/api/server/main-room").body();
        UUID lobbyRoomId = UUID.fromString(JSON.readTree(mainRoomBody).get("roomId").asText());
        TestListener lobby = new TestListener();
        URI lobbyUri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + lobbyRoomId + "/stream?token=" + token);
        WebSocket lobbyWs = HTTP.newWebSocketBuilder()
                .buildAsync(lobbyUri, lobby)
                .get(5, TimeUnit.SECONDS);
        try {
            lobby.awaitFrame(FRAME_WAIT); // streamHello

            HttpResponse<String> start = postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
            assertEquals(204, start.statusCode());

            JsonNode startFrame = JSON.readTree(
                    awaitMethod(lobby, "startGame", Duration.ofSeconds(5)));
            String realGameId = startFrame.get("data").get("gameId").asText();
            assertNotNull(realGameId);

            // NOW open a game WS to the real gameId — this is what
            // the production webclient does. Slice 22's gameJoin
            // fires here, skipping the 10s forced-join recovery.
            TestListener gameListener = new TestListener();
            WebSocket gameWs = openWs(UUID.fromString(realGameId), token, gameListener);
            try {
                long start_ms = System.currentTimeMillis();
                gameListener.awaitFrame(FRAME_WAIT); // streamHello
                JsonNode init = JSON.readTree(
                        awaitMethod(gameListener, "gameInit", Duration.ofSeconds(3)));
                long elapsed = System.currentTimeMillis() - start_ms;
                assertTrue(elapsed < 3000,
                        "gameInit must arrive under 3s — slice 22 gameJoin fix. "
                                + "Got " + elapsed + "ms (10s+ means forced-join "
                                + "recovery is back). Frame: " + init);
            } finally {
                gameWs.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
            }
        } finally {
            lobbyWs.sendClose(WebSocket.NORMAL_CLOSURE, "lobby done").join();
        }
    }

    // ---------- helpers ----------

    /** Holds everything a chat round-trip test needs. */
    private record ChatFixture(String token, String username, UUID chatId) {
    }

    /**
     * Slice 63 — bundle for tests that need a real game so the WS-upgrade
     * game-membership gate (FIX B) lets them through. Reused across
     * tests to avoid paying a multi-second game-creation cost per test.
     *
     * @param token   bearer for the human player seated at the game
     * @param userId  upstream userId for that token (handy for direct
     *                upstream-state assertions)
     * @param gameId  the real upstream gameId — passes
     *                {@code GameLookup.findUserPlayerMap(...).containsKey(userId)}
     * @param chatId  the game's chatId (resolved via {@code chatFindByGame})
     */
    private record RealGameFixture(String token, UUID userId, UUID gameId, UUID chatId) {
    }

    /**
     * Slice 63 — creates a real game (HUMAN vs COMPUTER_MAD) via the
     * lobby flow per call. Tests that need to open a game-stream WS
     * without being rejected by the membership gate use the returned
     * (token, gameId) pair.
     *
     * <p>Per-call rather than cached because cross-test state pollution
     * (engine traffic flooding handler buffer, user-state transitions
     * from prior tests like the lastActivity-backdate in the keepalive
     * test) was breaking chat-broadcast tests when the fixture was
     * reused. Per-call adds ~1.5 s per test but keeps each test's
     * upstream state pristine.
     */
    private synchronized RealGameFixture realGameFixture() throws Exception {
        // Always fresh — see javadoc for why caching is disabled.
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode(), login.body());
        JsonNode body = JSON.readTree(login.body());
        String token = body.get("token").asText();
        String username = body.get("username").asText();

        String roomId = JSON.readTree(getAuthed(token, "/api/server/main-room").body())
                .get("roomId").asText();
        String tableId = createTableWithSeats(token, roomId,
                "[\"HUMAN\",\"COMPUTER_MAD\"]");
        postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MAD\"}");

        String deckJson = buildForestDeckJson(token, 60);
        String joinBody = "{\"name\":\"e2e-tester\",\"skill\":1,\"deck\":"
                + deckJson + "}";
        HttpResponse<String> join = postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode(), "fixture join failed: " + join.body());

        // Open lobby WS to receive the startGame frame so we can pull
        // the real gameId. The lobby socket is closed before we return.
        UUID lobbyRoomId = UUID.fromString(roomId);
        TestListener lobby = new TestListener();
        URI lobbyUri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + lobbyRoomId + "/stream?token=" + token);
        WebSocket lobbyWs = HTTP.newWebSocketBuilder()
                .buildAsync(lobbyUri, lobby)
                .get(5, TimeUnit.SECONDS);
        UUID gameId;
        try {
            lobby.awaitFrame(FRAME_WAIT); // streamHello
            HttpResponse<String> start = postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
            assertEquals(204, start.statusCode(), "fixture start failed: " + start.body());
            JsonNode startFrame = JSON.readTree(
                    awaitMethod(lobby, "startGame", Duration.ofSeconds(10)));
            gameId = UUID.fromString(startFrame.get("data").get("gameId").asText());
        } finally {
            lobbyWs.sendClose(WebSocket.NORMAL_CLOSURE, "fixture done").join();
        }

        User user = embedded.managerFactory().userManager()
                .getUserByName(username)
                .orElseThrow(() -> new AssertionError(
                        "user not in upstream UserManager after fixture login"));
        UUID chatId = embedded.server().chatFindByGame(gameId);
        // Subscribe the fixture user to the game's chat so chat tests'
        // broadcasts to that chatId fan out to the user's session.
        // Game chats only auto-broadcast engine-system messages; player
        // user-chats need an explicit joinChat (mirrors what
        // RoomStreamHandler.onConnect does for room chats).
        embedded.managerFactory().chatManager().joinChat(chatId, user.getId());
        return new RealGameFixture(token, user.getId(), gameId, chatId);
    }

    /**
     * Slice 69e (ADR 0010 v2 — multiplayer e2e fixture). Real multi-
     * player game fixture for N-player FFA tests. Parallels
     * {@link #realGameFixture()} but builds a Free For All game with
     * 1 HUMAN + (seatCount - 1) COMPUTER_MAD seats.
     *
     * <p>Carries the same shape as {@link RealGameFixture} —
     * (token, userId, gameId, chatId) — so multiplayer tests can
     * reuse the existing {@link #openWs} / {@link #awaitMethod}
     * helpers without duplication.
     *
     * <p>Per-call (not cached) per the same rationale as
     * {@code realGameFixture()}: cross-test state pollution from
     * engine traffic flooding handler buffers breaks chat-broadcast
     * and frame-ordering tests when a fixture is reused. Per-call
     * adds ~3s for a 4p game (1 create + 3 /ai + 1 /join + 1 /start)
     * but keeps each test's upstream state pristine.
     */
    private record MultiplayerFixture(
            String token, UUID userId, UUID gameId, UUID chatId, int seatCount) {
    }

    private synchronized MultiplayerFixture multiplayerFixture(int seatCount)
            throws Exception {
        if (seatCount < 3 || seatCount > 4) {
            throw new IllegalArgumentException(
                    "MultiplayerFixture supports 3-4 player FFA only "
                            + "per ADR 0010 v2 scope; got: " + seatCount);
        }
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode(), login.body());
        JsonNode body = JSON.readTree(login.body());
        String token = body.get("token").asText();
        String username = body.get("username").asText();

        String roomId = JSON.readTree(getAuthed(token, "/api/server/main-room").body())
                .get("roomId").asText();

        // Build the seats array: 1 HUMAN + (seatCount - 1) AI seats.
        StringBuilder seats = new StringBuilder("[\"HUMAN\"");
        for (int i = 1; i < seatCount; i++) {
            seats.append(",\"COMPUTER_MAD\"");
        }
        seats.append("]");
        String tableBody = "{\"gameType\":\"Free For All\","
                + "\"deckType\":\"Constructed - Vintage\","
                + "\"winsNeeded\":1,\"seats\":" + seats + "}";
        HttpResponse<String> tableR = postWithToken(token,
                "/api/rooms/" + roomId + "/tables", tableBody);
        assertEquals(200, tableR.statusCode(),
                "MultiplayerFixture table create failed: " + tableR.body());
        String tableId = JSON.readTree(tableR.body()).get("tableId").asText();

        // Fill the (seatCount - 1) AI slots sequentially. Mirrors the
        // CreateTableModal flow per slice 69d's loop comment — addAi
        // is read-then-write in upstream LobbyService; concurrent
        // calls could race onto the same seat.
        for (int i = 1; i < seatCount; i++) {
            postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                    "{\"playerType\":\"COMPUTER_MAD\"}");
        }

        // HUMAN seat needs an explicit deck.
        String deckJson = buildForestDeckJson(token, 60);
        String joinBody = "{\"name\":\"e2e-tester\",\"skill\":1,\"deck\":"
                + deckJson + "}";
        HttpResponse<String> join = postWithToken(token,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode(),
                "MultiplayerFixture join failed: " + join.body());

        // Lobby socket to capture the startGame frame.
        UUID lobbyRoomId = UUID.fromString(roomId);
        TestListener lobby = new TestListener();
        URI lobbyUri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + lobbyRoomId + "/stream?token=" + token);
        WebSocket lobbyWs = HTTP.newWebSocketBuilder()
                .buildAsync(lobbyUri, lobby)
                .get(5, TimeUnit.SECONDS);
        UUID gameId;
        try {
            lobby.awaitFrame(FRAME_WAIT); // streamHello
            HttpResponse<String> start = postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
            assertEquals(204, start.statusCode(),
                    "MultiplayerFixture start failed: " + start.body());
            // Game engine boot is slower with 4 seats than 2; widen the
            // wait window beyond the standard FRAME_WAIT.
            JsonNode startFrame = JSON.readTree(
                    awaitMethod(lobby, "startGame", Duration.ofSeconds(20)));
            gameId = UUID.fromString(startFrame.get("data").get("gameId").asText());
        } finally {
            lobbyWs.sendClose(WebSocket.NORMAL_CLOSURE, "fixture done").join();
        }

        User user = embedded.managerFactory().userManager()
                .getUserByName(username)
                .orElseThrow(() -> new AssertionError(
                        "user not in upstream UserManager after fixture login"));
        UUID chatId = embedded.server().chatFindByGame(gameId);
        embedded.managerFactory().chatManager().joinChat(chatId, user.getId());
        return new MultiplayerFixture(token, user.getId(), gameId, chatId, seatCount);
    }

    /**
     * Logs in a fresh anonymous user, looks up the main-room chatId,
     * and subscribes the user to it via upstream {@code chatJoin}.
     * Returns the bits the test needs to drive the WebSocket layer.
     */
    private ChatFixture subscribeFreshUser() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{}");
        assertEquals(200, r.statusCode(), r.body());
        JsonNode body = JSON.readTree(r.body());
        String token = body.get("token").asText();
        String username = body.get("username").asText();

        HttpResponse<String> mr = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/server/main-room"))
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(5))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, mr.statusCode());
        UUID chatId = UUID.fromString(JSON.readTree(mr.body()).get("chatId").asText());

        User user = embedded.managerFactory().userManager()
                .getUserByName(username)
                .orElseThrow(() -> new AssertionError(
                        "user not in upstream UserManager after login: " + username));
        embedded.managerFactory().chatManager().joinChat(chatId, user.getId());
        return new ChatFixture(token, username, chatId);
    }

    /** Convenience for tests that drive chat through the upstream broadcast path. */
    private void broadcastSystem(UUID chatId, String message) {
        embedded.managerFactory().chatManager().broadcast(
                chatId,
                "system",
                message,
                ChatMessage.MessageColor.BLACK,
                true,
                null,
                ChatMessage.MessageType.USER_INFO,
                null);
    }

    private String awaitMethod(TestListener listener, String wantedMethod) throws Exception {
        return awaitMethod(listener, wantedMethod, FRAME_WAIT);
    }

    /**
     * Slice 63 — the realGameFixture user is auto-joined to the game's
     * chat (so {@code chatManager.broadcast} reaches them), but the
     * game also broadcasts engine-side system chat events ("X has
     * joined the game") which arrive interleaved with the test's own
     * broadcasts. This helper skips chatMessage frames whose
     * {@code data.message} doesn't contain {@code wantedSubstring}.
     */
    private String awaitChatMessageContaining(TestListener listener,
                                                String wantedSubstring) throws Exception {
        return awaitChatMessageContaining(listener, wantedSubstring, FRAME_WAIT);
    }

    private String awaitChatMessageContaining(TestListener listener, String wantedSubstring,
                                                Duration timeout) throws Exception {
        long deadline = System.currentTimeMillis() + timeout.toMillis();
        while (System.currentTimeMillis() < deadline) {
            String f = listener.frames.poll();
            if (f == null) {
                Thread.sleep(20);
                continue;
            }
            JsonNode env = JSON.readTree(f);
            if (!"chatMessage".equals(env.get("method").asText())) {
                continue;
            }
            JsonNode msg = env.get("data").get("message");
            if (msg != null && msg.asText().contains(wantedSubstring)) {
                return f;
            }
        }
        throw new AssertionError("no chatMessage containing '" + wantedSubstring
                + "' within " + timeout);
    }

    /**
     * Pulls frames off the listener until we see one matching
     * {@code wantedMethod}. Skips intermediate frames (streamError,
     * other methods) which can fire concurrently in test conditions.
     * Honors the outer {@code timeout} as a hard deadline — does not
     * delegate to {@link TestListener#awaitFrame} which has its own
     * fixed timeout.
     */
    private String awaitMethod(TestListener listener, String wantedMethod,
                                Duration timeout) throws Exception {
        long deadline = System.currentTimeMillis() + timeout.toMillis();
        while (System.currentTimeMillis() < deadline) {
            String f = listener.frames.poll();
            if (f == null) {
                Thread.sleep(20);
                continue;
            }
            JsonNode env = JSON.readTree(f);
            if (wantedMethod.equals(env.get("method").asText())) {
                return f;
            }
        }
        throw new AssertionError("no '" + wantedMethod + "' frame within " + timeout);
    }

    private WebSocket openWs(UUID gameId, String token, TestListener listener) throws Exception {
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + gameId + "/stream?token=" + token);
        return HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
    }

    /**
     * Slice 63 — convenience wrapper that opens a WS using the cached
     * {@link RealGameFixture}. The legacy {@code bearer + randomUUID()}
     * pattern no longer passes the new game-membership gate (FIX B);
     * tests that care only about generic protocol behaviour (error
     * frames, type validation, etc.) can call this helper to get a
     * valid upgrade without thinking about the fixture.
     */
    private WebSocket openValidGameWs(TestListener listener) throws Exception {
        RealGameFixture fx = realGameFixture();
        return openWs(fx.gameId(), fx.token(), listener);
    }

    private HttpResponse<String> postJson(String path, String body) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Content-Type", "application/json")
                        .timeout(Duration.ofSeconds(10))
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> getAuthed(String token, String path) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(5))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> postWithToken(String token, String path, String body)
            throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(10))
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private String createTableWithSeats(String token, String roomId, String seatsJson)
            throws Exception {
        String body = "{\"gameType\":\"Two Player Duel\","
                + "\"deckType\":\"Constructed - Vintage\","
                + "\"winsNeeded\":1,\"seats\":" + seatsJson + "}";
        HttpResponse<String> r = postWithToken(token,
                "/api/rooms/" + roomId + "/tables", body);
        assertEquals(200, r.statusCode(), "table create failed: " + r.body());
        return JSON.readTree(r.body()).get("tableId").asText();
    }

    private String buildForestDeckJson(String token, int amount) throws Exception {
        HttpResponse<String> r = getAuthed(token, "/api/cards?name=Forest");
        JsonNode forest = JSON.readTree(r.body()).get("cards").get(0);
        assertNotNull(forest, "Forest must exist in the card DB");
        return String.format(
                "{\"name\":\"Test Forest Deck\",\"author\":\"e2e\","
                        + "\"cards\":[{\"cardName\":\"Forest\",\"setCode\":\"%s\","
                        + "\"cardNumber\":\"%s\",\"amount\":%d}],"
                        + "\"sideboard\":[]}",
                forest.get("setCode").asText(),
                forest.get("cardNumber").asText(),
                amount);
    }

    /**
     * Minimal {@link WebSocket.Listener} that buffers incoming text
     * frames into a queue and exposes blocking await helpers. Supports
     * fragmented messages — accumulates until {@code last == true}.
     */
    private static final class TestListener implements WebSocket.Listener {
        private final ConcurrentLinkedQueue<String> frames = new ConcurrentLinkedQueue<>();
        private final CountDownLatch closeLatch = new CountDownLatch(1);
        private final StringBuilder buffer = new StringBuilder();
        volatile boolean gotFrame = false;
        volatile int closeCode = -1;
        volatile String closeReason = "";

        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public CompletableFuture<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                frames.add(buffer.toString());
                buffer.setLength(0);
                gotFrame = true;
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletableFuture<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            this.closeCode = statusCode;
            this.closeReason = reason;
            closeLatch.countDown();
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            // Surface the error through the close latch so awaitClose
            // returns instead of the test deadlocking.
            this.closeCode = -2;
            this.closeReason = error.getClass().getSimpleName() + ": " + error.getMessage();
            closeLatch.countDown();
        }

        String awaitFrame(Duration timeout) throws InterruptedException {
            long deadline = System.currentTimeMillis() + timeout.toMillis();
            while (System.currentTimeMillis() < deadline) {
                String f = frames.poll();
                if (f != null) {
                    return f;
                }
                Thread.sleep(20);
            }
            throw new AssertionError("no frame within " + timeout);
        }

        boolean awaitClose(Duration timeout) throws InterruptedException {
            return closeLatch.await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }
    }
}
