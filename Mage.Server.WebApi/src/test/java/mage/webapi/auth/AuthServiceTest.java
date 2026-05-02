package mage.webapi.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for {@link AuthService} username validation
 * (slice 64). Boots an embedded Mage server + WebApi and exercises
 * the {@code POST /api/session} route with a range of usernames to
 * lock the regex + reserved-prefix policy.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthServiceTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    private WebApiServer server;

    @BeforeAll
    void start() {
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0);
        // Slice L8 review — disable session-mint rate limiting; tests
        // exercise the auth path at high cadence.
        server.setSessionMintLimiter(
                new mage.webapi.auth.IpRateLimiter(Integer.MAX_VALUE, 60_000L));
    }

    @AfterAll
    void stop() {
        if (server != null) server.stop();
    }

    @Test
    void login_usernameWithSpaces_rejected() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{\"username\":\"alice bob\"}");
        assertEquals(400, r.statusCode(), r.body());
        JsonNode body = JSON.readTree(r.body());
        assertEquals("INVALID_USERNAME", body.get("code").asText());
    }

    @Test
    void login_usernameTooLong_rejected() throws Exception {
        // 33-char username — one over the 32-char limit.
        String tooLong = "a".repeat(33);
        HttpResponse<String> r = postJson("/api/session",
                "{\"username\":\"" + tooLong + "\"}");
        assertEquals(400, r.statusCode(), r.body());
        JsonNode body = JSON.readTree(r.body());
        assertEquals("INVALID_USERNAME", body.get("code").asText());
    }

    @Test
    void login_usernameSpecialChars_rejected() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{\"username\":\"alice!\"}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("INVALID_USERNAME", JSON.readTree(r.body()).get("code").asText());

        HttpResponse<String> r2 = postJson("/api/session",
                "{\"username\":\"alice@example.com\"}");
        assertEquals(400, r2.statusCode(), r2.body());
        assertEquals("INVALID_USERNAME", JSON.readTree(r2.body()).get("code").asText());
    }

    @Test
    void login_validUsername_accepted() throws Exception {
        // Each name in this set passes the regex and is not a reserved
        // prefix. Use a unique 12-byte tail per test invocation to
        // avoid newest-wins revoking us if the test is rerun under the
        // same JVM.
        String[] valid = {"alice_x64a", "user-1_x64b", "abc123_x64c", "Z_x64d"};
        for (String name : valid) {
            HttpResponse<String> r = postJson("/api/session",
                    "{\"username\":\"" + name + "\"}");
            assertEquals(200, r.statusCode(),
                    "valid username '" + name + "' must be accepted: " + r.body());
            JsonNode body = JSON.readTree(r.body());
            assertEquals(name, body.get("username").asText());
            assertNotNull(body.get("token").asText());
        }
    }

    @Test
    void login_guestPrefix_rejected() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{\"username\":\"guest-mine\"}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("RESERVED_PREFIX", JSON.readTree(r.body()).get("code").asText());

        // Case-insensitive — Guest-foo and GUEST-FOO both blocked.
        HttpResponse<String> r2 = postJson("/api/session", "{\"username\":\"Guest-foo\"}");
        assertEquals(400, r2.statusCode(), r2.body());
        assertEquals("RESERVED_PREFIX", JSON.readTree(r2.body()).get("code").asText());
    }

    @Test
    void login_anonymous_bypassesValidation() throws Exception {
        // Anonymous (empty body or blank username) still works — the
        // generated guest-XXXXXXXX is server-issued and skips the
        // user-supplied validation path.
        HttpResponse<String> r = postJson("/api/session", "{}");
        assertEquals(200, r.statusCode(), r.body());
        JsonNode body = JSON.readTree(r.body());
        assertTrue(body.get("username").asText().startsWith("guest-"),
                "anonymous login must still produce a guest- name");
        assertTrue(body.get("isAnonymous").asBoolean());

        HttpResponse<String> r2 = postJson("/api/session", "{\"username\":\"  \"}");
        assertEquals(200, r2.statusCode(), r2.body());
        assertTrue(JSON.readTree(r2.body()).get("username").asText().startsWith("guest-"),
                "blank username must still take the anonymous path");
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
}
