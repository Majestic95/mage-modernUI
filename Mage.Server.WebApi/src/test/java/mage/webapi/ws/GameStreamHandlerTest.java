package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * Integration tests for the Phase 3 slice 1 game-stream WebSocket
 * endpoint. Boots an embedded server once, opens real WebSockets via
 * {@link java.net.http.WebSocket}, and asserts the slice 1 contract:
 * handshake auth via {@code ?token=}, the {@code streamHello} frame,
 * and the in-band {@code streamError} reply for unimplemented inbound
 * types.
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
    private String bearer;

    @BeforeAll
    void start() throws Exception {
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
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
            assertEquals("skeleton", data.get("mode").asText(),
                    "slice 1 announces 'skeleton' mode");
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

            ws.sendText("{\"type\":\"chatSend\",\"message\":\"hello\"}", true).join();
            String reply = listener.awaitFrame(FRAME_WAIT);

            JsonNode env = JSON.readTree(reply);
            assertEquals("streamError", env.get("method").asText());
            JsonNode data = env.get("data");
            assertEquals("NOT_IMPLEMENTED", data.get("code").asText());
            assertTrue(data.get("message").asText().contains("chatSend"),
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

    // ---------- helpers ----------

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
