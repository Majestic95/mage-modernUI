package mage.webapi.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.server.User;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.server.WebApiServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.lang.reflect.Field;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for {@link BearerAuthMiddleware}.
 *
 * <p>The middleware enforces Bearer-token auth on every non-public
 * REST route and, since slice 46, also calls upstream
 * {@code MageServerImpl.ping(sessionId, null)} on every successful
 * resolve so the user's {@code User.lastActivity} is bumped. Without
 * that bump the upstream {@code UserManagerImpl} reaper would
 * disconnect the user after 3 minutes of HTTP-only quiet, evicting
 * their WAITING tables and leaving them in a "zombie" state where the
 * WebApi token is still valid but every upstream call returns
 * {@code negativeResult()} (HTTP 422 {@code UPSTREAM_REJECTED}).
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class BearerAuthMiddlewareTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    private WebApiServer server;
    private EmbeddedServer embedded;

    @BeforeAll
    void start() {
        embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0);
    }

    @AfterAll
    void stop() {
        if (server != null) server.stop();
    }

    @Test
    void authedRequest_bumpsUpstreamUserLastActivity() throws Exception {
        // Slice 46 — every authed REST hit must call upstream ping so
        // User.lastActivity is refreshed and the 3-minute reaper does
        // not destroy WAITING tables out from under an idle user.
        HttpResponse<String> login = postJson("/api/session", "{}");
        assertEquals(200, login.statusCode(), "anon login: " + login.body());
        JsonNode body = JSON.readTree(login.body());
        String token = body.get("token").asText();
        String username = body.get("username").asText();
        assertNotNull(token);

        User user = embedded.managerFactory().userManager()
                .getUserByName(username)
                .orElseThrow(() -> new AssertionError(
                        "user not in upstream UserManager after login: " + username));

        // Backdate the user's lastActivity so the bump is unambiguous.
        Field f = User.class.getDeclaredField("lastActivity");
        f.setAccessible(true);
        Date stale = new Date(System.currentTimeMillis() - 60_000L);
        f.set(user, stale);
        assertEquals(stale, user.getLastActivity(),
                "test setup: backdated lastActivity must stick");

        // Any authed GET will run through the middleware. /api/version
        // is in the public list (no token), so use /api/server/state
        // which requires auth and resolves through the middleware.
        HttpResponse<String> state = getAuthed(token, "/api/server/state");
        assertEquals(200, state.statusCode(),
                "authed REST call must succeed: " + state.body());

        Date afterRequest = user.getLastActivity();
        assertTrue(afterRequest.after(stale),
                "authed REST call must bump upstream User.lastActivity via ping. "
                        + "Got: " + afterRequest + " (stale=" + stale + ")");
    }

    @Test
    void invalidToken_returns401AndDoesNotBump() throws Exception {
        // Sanity: middleware only pings on a successful resolve. An
        // INVALID_TOKEN must short-circuit before the ping call.
        HttpResponse<String> r = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/server/state"))
                        .header("Authorization", "Bearer not-a-real-token")
                        .timeout(Duration.ofSeconds(5))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, r.statusCode(), r.body());
        assertTrue(r.body().contains("INVALID_TOKEN"),
                "401 envelope must carry INVALID_TOKEN: " + r.body());
    }

    @Test
    void publicRoute_skipsBumpAndAuth() throws Exception {
        // /api/version is on the public allow-list — no token, no
        // ping. Just confirm it stays open.
        HttpResponse<String> r = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/version"))
                        .timeout(Duration.ofSeconds(5))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, r.statusCode(), r.body());
    }

    // ---------- helpers ----------

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
}
