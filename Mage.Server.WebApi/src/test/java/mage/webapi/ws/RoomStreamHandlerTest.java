package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for {@code /api/rooms/{roomId}/stream} — the
 * lobby/room chat WebSocket. Boots the embedded server once,
 * discovers the main-room id, and asserts the contract:
 *
 * <ul>
 *   <li>Handshake auth via {@code ?token=}, malformed-roomId rejection</li>
 *   <li>Server-side broadcast on the room chat → {@code chatMessage}
 *       frame on the WS</li>
 *   <li>Client-side {@code chatSend} → upstream broadcast loops back
 *       to the sender (sender is auto-subscribed by the handler's
 *       {@code chatJoin} call)</li>
 * </ul>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RoomStreamHandlerTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();
    private static final Duration FRAME_WAIT = Duration.ofSeconds(5);

    private WebApiServer server;
    private EmbeddedServer embedded;

    @BeforeAll
    void start() throws Exception {
        embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0);
    }

    @AfterAll
    void stop() {
        if (server != null) server.stop();
    }

    // ---------- happy path ----------

    @Test
    void onConnect_sendsStreamHelloEnvelope() throws Exception {
        Fixture f = login();
        String roomId = mainRoomId(f.token);
        TestListener listener = new TestListener();
        WebSocket ws = openRoomWs(roomId, f.token, listener);
        try {
            String frame = listener.awaitFrame(FRAME_WAIT);
            JsonNode env = JSON.readTree(frame);
            assertEquals(SchemaVersion.CURRENT, env.get("schemaVersion").asText());
            assertEquals("streamHello", env.get("method").asText());
            assertEquals(roomId, env.get("objectId").asText(),
                    "hello carries roomId as objectId");
            JsonNode data = env.get("data");
            // The streamHello carries gameId field (named) but the
            // value is the roomId for room streams — the field is
            // overloaded as "the bound id of this stream."
            assertEquals(roomId, data.get("gameId").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void serverBroadcast_arrivesAsChatMessageFrame() throws Exception {
        Fixture f = login();
        String roomId = mainRoomId(f.token);
        UUID chatId = UUID.fromString(
                JSON.readTree(getAuthed(f.token, "/api/server/main-room").body())
                        .get("chatId").asText());

        TestListener listener = new TestListener();
        WebSocket ws = openRoomWs(roomId, f.token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            embedded.managerFactory().chatManager().broadcast(
                    chatId,
                    "system",
                    "lobby-broadcast-from-test",
                    ChatMessage.MessageColor.BLACK,
                    true,
                    null,
                    ChatMessage.MessageType.USER_INFO,
                    null);

            String frame = awaitMethod(listener, "chatMessage");
            JsonNode env = JSON.readTree(frame);
            assertEquals("chatMessage", env.get("method").asText());
            assertEquals("lobby-broadcast-from-test", env.get("data").get("message").asText());
            assertEquals("system", env.get("data").get("username").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    @Test
    void clientChatSend_loopsBackThroughBroadcast() throws Exception {
        Fixture f = login();
        String roomId = mainRoomId(f.token);
        UUID chatId = UUID.fromString(
                JSON.readTree(getAuthed(f.token, "/api/server/main-room").body())
                        .get("chatId").asText());

        TestListener listener = new TestListener();
        WebSocket ws = openRoomWs(roomId, f.token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            String body = "{\"type\":\"chatSend\",\"chatId\":\""
                    + chatId + "\",\"message\":\"hello lobby\"}";
            ws.sendText(body, true).join();

            String frame = awaitMethod(listener, "chatMessage");
            JsonNode env = JSON.readTree(frame);
            assertEquals(f.username, env.get("data").get("username").asText(),
                    "username is filled server-side from session");
            assertEquals("hello lobby", env.get("data").get("message").asText());
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- chat scoping (the slice 5 + 8 invariant) ----------

    @Test
    void roomStream_doesNotForwardForeignChats() throws Exception {
        // A second user broadcasts into a DIFFERENT chat (a synthetic
        // one we make up). Our user, bound to the main-room chatId,
        // must NOT receive it. Proves the per-WsContext chat-scoping
        // filter still works after the slice 8 rename.
        Fixture f = login();
        String roomId = mainRoomId(f.token);

        TestListener listener = new TestListener();
        WebSocket ws = openRoomWs(roomId, f.token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello

            UUID foreignChatId = UUID.randomUUID();
            embedded.managerFactory().chatManager().broadcast(
                    foreignChatId,
                    "alien",
                    "should-not-arrive",
                    ChatMessage.MessageColor.BLACK,
                    true,
                    null,
                    ChatMessage.MessageType.USER_INFO,
                    null);

            // No chat frame should arrive within a short window.
            try {
                String f2 = listener.awaitFrame(Duration.ofMillis(500));
                JsonNode env = JSON.readTree(f2);
                if ("chatMessage".equals(env.get("method").asText())) {
                    throw new AssertionError(
                            "received unexpected chatMessage from foreign chat: " + f2);
                }
            } catch (AssertionError noFrame) {
                // Expected — no foreign chat reaches us.
            }
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- auth / validation failures ----------

    @Test
    void onConnect_missingToken_closesWith4001() throws Exception {
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + UUID.randomUUID() + "/stream");
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT));
            assertEquals(4001, listener.closeCode);
            assertEquals("MISSING_TOKEN", listener.closeReason);
        } finally {
            ws.abort();
        }
    }

    @Test
    void onConnect_malformedRoomId_closesWith4003() throws Exception {
        Fixture f = login();
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/not-a-uuid/stream?token=" + f.token);
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

    @Test
    void onConnect_unknownRoomId_closesWith4003() throws Exception {
        Fixture f = login();
        TestListener listener = new TestListener();
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + UUID.randomUUID() + "/stream?token=" + f.token);
        WebSocket ws = HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
        try {
            assertTrue(listener.awaitClose(FRAME_WAIT));
            assertEquals(4003, listener.closeCode);
        } finally {
            ws.abort();
        }
    }

    @Test
    void onMessage_playerActionRejected() throws Exception {
        Fixture f = login();
        String roomId = mainRoomId(f.token);
        TestListener listener = new TestListener();
        WebSocket ws = openRoomWs(roomId, f.token, listener);
        try {
            listener.awaitFrame(FRAME_WAIT); // streamHello
            ws.sendText("{\"type\":\"playerAction\",\"action\":\"CONCEDE\"}", true).join();
            JsonNode err = JSON.readTree(awaitMethod(listener, "streamError"));
            assertEquals("NOT_IMPLEMENTED", err.get("data").get("code").asText());
            assertTrue(err.get("data").get("message").asText().contains("playerAction"));
        } finally {
            ws.sendClose(WebSocket.NORMAL_CLOSURE, "test done").join();
        }
    }

    // ---------- helpers ----------

    private record Fixture(String token, String username) {
    }

    private Fixture login() throws Exception {
        HttpResponse<String> r = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/session"))
                        .header("Content-Type", "application/json")
                        .timeout(Duration.ofSeconds(10))
                        .POST(HttpRequest.BodyPublishers.ofString("{}"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, r.statusCode(), r.body());
        JsonNode body = JSON.readTree(r.body());
        return new Fixture(body.get("token").asText(), body.get("username").asText());
    }

    private String mainRoomId(String token) throws Exception {
        HttpResponse<String> r = getAuthed(token, "/api/server/main-room");
        return JSON.readTree(r.body()).get("roomId").asText();
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

    private WebSocket openRoomWs(String roomId, String token, TestListener listener)
            throws Exception {
        URI uri = URI.create("ws://localhost:" + server.port()
                + "/api/rooms/" + roomId + "/stream?token=" + token);
        return HTTP.newWebSocketBuilder()
                .buildAsync(uri, listener)
                .get(5, TimeUnit.SECONDS);
    }

    private String awaitMethod(TestListener listener, String wantedMethod) throws Exception {
        long deadline = System.currentTimeMillis() + FRAME_WAIT.toMillis();
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
        throw new AssertionError("no '" + wantedMethod + "' frame within " + FRAME_WAIT);
    }

    /** Same shape as the helper in GameStreamHandlerTest. */
    private static final class TestListener implements WebSocket.Listener {
        final ConcurrentLinkedQueue<String> frames = new ConcurrentLinkedQueue<>();
        private final CountDownLatch closeLatch = new CountDownLatch(1);
        private final StringBuilder buffer = new StringBuilder();
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
            this.closeCode = -2;
            this.closeReason = error.getClass().getSimpleName() + ": " + error.getMessage();
            closeLatch.countDown();
        }

        String awaitFrame(Duration timeout) throws InterruptedException {
            long deadline = System.currentTimeMillis() + timeout.toMillis();
            while (System.currentTimeMillis() < deadline) {
                String f = frames.poll();
                if (f != null) return f;
                Thread.sleep(20);
            }
            throw new AssertionError("no frame within " + timeout);
        }

        boolean awaitClose(Duration timeout) throws InterruptedException {
            return closeLatch.await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }
    }
}
