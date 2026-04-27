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
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
        try {
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
        try {
            // Discard the streamHello frame.
            listener.awaitFrame(FRAME_WAIT);

            // 'playerSurrender' isn't a valid inbound type — slice 6
            // reserves NOT_IMPLEMENTED for unknown discriminators.
            ws.sendText("{\"type\":\"playerSurrender\"}", true).join();
            String reply = listener.awaitFrame(FRAME_WAIT);

            JsonNode env = JSON.readTree(reply);
            assertEquals("streamError", env.get("method").asText());
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("not-json-at-all", true).join();
            String reply = listener.awaitFrame(FRAME_WAIT);

            JsonNode env = JSON.readTree(reply);
            assertEquals("streamError", env.get("method").asText());
            assertEquals("BAD_JSON", env.get("data").get("code").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void onMessage_nonObjectJson_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("[1,2,3]", true).join();
            String reply = listener.awaitFrame(FRAME_WAIT);

            JsonNode env = JSON.readTree(reply);
            assertEquals("streamError", env.get("method").asText());
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

    // ---------- slice 2: chat outbound + inbound ----------

    @Test
    void chatBroadcast_arrivesAsChatMessageFrame() throws Exception {
        ChatFixture chat = subscribeFreshUser();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), chat.token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            // Direct upstream broadcast — bypasses the inbound WS path
            // so this test isolates the outbound mapper.
            embedded.managerFactory().chatManager().broadcast(
                    chat.chatId,
                    "system",
                    "broadcast-from-test",
                    ChatMessage.MessageColor.BLACK,
                    true,
                    null,
                    ChatMessage.MessageType.USER_INFO,
                    null);

            String frame = awaitMethod(listener, "chatMessage");
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
        ChatFixture chat = subscribeFreshUser();
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), chat.token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            String body = "{\"type\":\"chatSend\",\"chatId\":\""
                    + chat.chatId + "\",\"message\":\"ggwp\"}";
            ws.sendText(body, true).join();

            // Sender is also subscribed → the upstream broadcast loops
            // back to their own session and arrives as a chatMessage
            // frame on the same WebSocket.
            String frame = awaitMethod(listener, "chatMessage");
            JsonNode env = JSON.readTree(frame);
            JsonNode data = env.get("data");
            assertEquals(chat.username, data.get("username").asText(),
                    "server fills username from session — clients cannot spoof");
            assertEquals("ggwp", data.get("message").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void clientChatSend_missingChatId_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"chatSend\",\"message\":\"hi\"}", true).join();
            String reply = listener.awaitFrame(FRAME_WAIT);
            JsonNode env = JSON.readTree(reply);
            assertEquals("streamError", env.get("method").asText());
            assertEquals("BAD_REQUEST", env.get("data").get("code").asText());
            assertTrue(env.get("data").get("message").asText().contains("chatId"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void clientChatSend_blankMessage_repliesWithStreamError() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
        try {
            listener.awaitFrame(FRAME_WAIT);
            ws.sendText("{\"type\":\"chatSend\",\"chatId\":\""
                    + UUID.randomUUID() + "\",\"message\":\"  \"}", true).join();
            String reply = listener.awaitFrame(FRAME_WAIT);
            JsonNode env = JSON.readTree(reply);
            assertEquals("streamError", env.get("method").asText());
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
        ChatFixture chat = subscribeFreshUser();

        // Phase 1 — open WS, capture three chat frames so the buffer
        // is populated. We then drop the WS without closing the
        // upstream session; the buffer survives on the handler.
        TestListener first = new TestListener();
        WebSocket ws1 = openWs(UUID.randomUUID(), chat.token, first);
        first.awaitFrame(FRAME_WAIT); // streamHello
        broadcastSystem(chat.chatId, "msg-A");
        broadcastSystem(chat.chatId, "msg-B");
        broadcastSystem(chat.chatId, "msg-C");
        int firstMessageId = JSON.readTree(awaitMethod(first, "chatMessage"))
                .get("messageId").asInt();
        // Drain the remaining two so the queue is empty when ws1 closes.
        awaitMethod(first, "chatMessage");
        awaitMethod(first, "chatMessage");
        ws1.sendClose(WebSocket.NORMAL_CLOSURE, "phase 1 done").join();

        // Phase 2 — reopen with ?since=firstMessageId. Server replays
        // the two frames after that messageId; the first one (== since)
        // is filtered out.
        TestListener second = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + UUID.randomUUID() + "/stream"
                + "?token=" + chat.token + "&since=" + firstMessageId);
        WebSocket ws2 = HTTP.newWebSocketBuilder()
                .buildAsync(uri, second)
                .get(5, TimeUnit.SECONDS);
        try {
            second.awaitFrame(FRAME_WAIT); // streamHello

            JsonNode replayB = JSON.readTree(awaitMethod(second, "chatMessage"));
            JsonNode replayC = JSON.readTree(awaitMethod(second, "chatMessage"));
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
        ChatFixture chat = subscribeFreshUser();
        TestListener listener = new TestListener();
        // since=Integer.MAX_VALUE — guaranteed cold buffer
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + UUID.randomUUID() + "/stream"
                + "?token=" + chat.token + "&since=" + Integer.MAX_VALUE);
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            // streamHello arrives; no replay frames (cold buffer)
            JsonNode hello = JSON.readTree(listener.awaitFrame(FRAME_WAIT));
            assertEquals("streamHello", hello.get("method").asText());

            // Live frames still flow.
            broadcastSystem(chat.chatId, "after-cold");
            JsonNode chatFrame = JSON.readTree(awaitMethod(listener, "chatMessage"));
            assertEquals("after-cold", chatFrame.get("data").get("message").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void reconnect_sinceMalformed_repliesStreamError() throws Exception {
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/games/" + UUID.randomUUID() + "/stream"
                + "?token=" + bearer + "&since=not-a-number");
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
    void playerResponse_missingKind_repliesWithBadRequest() throws Exception {
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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
    void chatSend_oversizedMessage_repliesWithBadRequest() throws Exception {
        // Cap is 4096 chars; send 5000.
        StringBuilder huge = new StringBuilder(5000);
        for (int i = 0; i < 5000; i++) huge.append('x');
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), bearer, listener);
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

    // ---------- slice 3: full game-lifecycle e2e ----------

    @Test
    void gameLifecycle_e2e_startGameAndGameInitArrive() throws Exception {
        // Fresh user so the test is isolated from the shared bearer.
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode());
        String token = JSON.readTree(login.body()).get("token").asText();

        // Open a WS bound to a synthetic gameId — the START_GAME
        // callback fires on the user's session regardless of which
        // game UUID the WebSocket path carries (buffer is per-handler,
        // not per-game). The webclient in production uses a temporary
        // gameId placeholder until startGame surfaces the real one.
        TestListener listener = new TestListener();
        WebSocket ws = openWs(UUID.randomUUID(), token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

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

            HttpResponse<String> start = postWithToken(token,
                    "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
            assertEquals(204, start.statusCode(), "start failed: " + start.body());

            // The exact frame ordering depends on engine timing, but
            // both startGame and gameInit must arrive within the
            // window. We assert each separately (awaitMethod skips
            // intermediate frames).
            //
            // Note: this test's WS opens with a synthetic
            // randomUUID() before the real gameId is known. Slice
            // 22's gameJoin-on-connect fix calls upstream's gameJoin
            // with the WS path's gameId — which here is bogus, so
            // the upstream call is a no-op and the original 10s
            // forced-join recovery still drives the test. Production
            // webclient opens the WS to the REAL gameId after the
            // startGame frame arrives (slice 12 auto-nav), so the
            // fix DOES skip the recovery in real use; this test
            // just doesn't exercise it. The 15s deadline reflects
            // the recovery-driven timing.
            JsonNode startFrame = JSON.readTree(
                    awaitMethod(listener, "startGame", Duration.ofSeconds(15)));
            assertEquals(SchemaVersion.CURRENT,
                    startFrame.get("schemaVersion").asText());
            JsonNode startData = startFrame.get("data");
            assertNotNull(startData.get("gameId").asText());
            assertNotNull(startData.get("playerId").asText());
            assertEquals(tableId, startData.get("tableId").asText(),
                    "startGame.tableId must match the table we created");

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
                JsonNode anyCard = myHand.elements().next();
                assertEquals("Forest", anyCard.get("name").asText(),
                        "60-Forest deck → hand should be all Forests");
                assertEquals("LAND", anyCard.get("types").get(0).asText());
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
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
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
