package mage.webapi.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebSession;
import mage.webapi.embed.EmbeddedServer;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for the WebApi routes. Boots an embedded Mage
 * server once for the test class (idempotent — reuses the JVM-singleton)
 * and exercises every route via real HTTP. Per ADR 0004, all routes
 * outside the public allow-list require a Bearer token; tests acquire
 * one in {@link #start()} via the anonymous-login flow.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WebApiServerTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    private WebApiServer server;
    private String bearer;

    @BeforeAll
    void start() throws Exception {
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0);

        // Acquire an anonymous Bearer for all subsequent protected routes.
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

    // ---------- public endpoints ----------

    @Test
    void getVersion_returnsSchemaAndMageVersion() throws Exception {
        HttpResponse<String> resp = get("/api/version");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertNotNull(body.get("mageVersion"));
        assertTrue(body.get("mageVersion").asText().startsWith("1.4."));
        assertNotNull(body.get("buildTime"));
    }

    @Test
    void getHealth_returnsReady() throws Exception {
        HttpResponse<String> resp = get("/api/health");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertEquals("ready", body.get("status").asText());
    }

    // ---------- auth endpoints ----------

    @Test
    void postSession_emptyBody_returnsGuestSession() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{}");
        assertEquals(200, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertTrue(body.get("isAnonymous").asBoolean());
        assertFalse(body.get("isAdmin").asBoolean());
        assertTrue(body.get("username").asText().startsWith("guest-"),
                "guest username should have guest- prefix; got: " + body.get("username"));
        assertNotNull(body.get("token").asText());
        assertNotNull(body.get("expiresAt").asText());
    }

    @Test
    void postSession_withUsername_returnsGuestWithName() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{\"username\":\"alice\"}");
        assertEquals(200, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals("alice", body.get("username").asText());
        assertTrue(body.get("isAnonymous").asBoolean(),
                "no password ⇒ anonymous regardless of username");
    }

    @Test
    void postSession_admin_correctPassword_returnsAdminSession() throws Exception {
        // EmbeddedServer.boot passes adminPassword="" — empty matches empty.
        HttpResponse<String> r = postJson("/api/session/admin",
                "{\"adminPassword\":\"\"}");
        assertEquals(200, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertTrue(body.get("isAdmin").asBoolean());
        assertFalse(body.get("isAnonymous").asBoolean());
        assertEquals("Admin", body.get("username").asText());
    }

    @Test
    void postSession_admin_wrongPassword_returns401() throws Exception {
        HttpResponse<String> r = postJson("/api/session/admin",
                "{\"adminPassword\":\"definitely-wrong\"}");
        assertEquals(401, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals("INVALID_ADMIN_PASSWORD", body.get("code").asText());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
    }

    @Test
    void getSessionMe_withBearer_returnsSession() throws Exception {
        HttpResponse<String> r = getAuthed("/api/session/me");
        assertEquals(200, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals(bearer, body.get("token").asText(),
                "/me must return the same token used for the request");
    }

    @Test
    void getSessionMe_withoutBearer_returns401() throws Exception {
        HttpResponse<String> r = get("/api/session/me");
        assertEquals(401, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals("MISSING_TOKEN", body.get("code").asText());
    }

    @Test
    void getSessionMe_invalidToken_returns401() throws Exception {
        HttpResponse<String> r = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/session/me"))
                        .header("Authorization", "Bearer not-a-real-token")
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals("INVALID_TOKEN", body.get("code").asText());
    }

    @Test
    void deleteSession_revokesToken() throws Exception {
        // Acquire a fresh disposable token so this test doesn't kill `bearer`.
        HttpResponse<String> login = postJson("/api/session", "{}");
        String disposable = JSON.readTree(login.body()).get("token").asText();

        HttpResponse<String> del = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/session"))
                        .header("Authorization", "Bearer " + disposable)
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(204, del.statusCode());

        // Token should now reject.
        HttpResponse<String> me = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/session/me"))
                        .header("Authorization", "Bearer " + disposable)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, me.statusCode());
    }

    @Test
    void newestWins_secondLoginRevokesFirst() throws Exception {
        // Same username twice — the first token should stop working.
        HttpResponse<String> first = postJson("/api/session", "{\"username\":\"raceuser\"}");
        String firstToken = JSON.readTree(first.body()).get("token").asText();

        HttpResponse<String> second = postJson("/api/session", "{\"username\":\"raceuser\"}");
        assertEquals(200, second.statusCode());

        // First token is now revoked.
        HttpResponse<String> me = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/session/me"))
                        .header("Authorization", "Bearer " + firstToken)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, me.statusCode(), "newest-wins must revoke prior tokens");
    }

    // ---------- protected info endpoints (now require auth) ----------

    @Test
    void getServerState_returnsLoadedTypes() throws Exception {
        HttpResponse<String> resp = HTTP.send(
                authedRequest("/api/server/state").GET().timeout(Duration.ofSeconds(10)).build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertTrue(body.get("gameTypes").size() >= 1);
    }

    @Test
    void getCards_byName_returnsOneMatch() throws Exception {
        HttpResponse<String> resp = getAuthed("/api/cards?name=Lightning+Bolt");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(1, body.get("cards").size());
        assertEquals("Lightning Bolt", body.get("cards").get(0).get("name").asText());
    }

    @Test
    void getCards_unknownName_returnsEmptyListing() throws Exception {
        HttpResponse<String> resp = getAuthed("/api/cards?name=NoSuchCard12345");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(0, body.get("cards").size());
    }

    @Test
    void getCards_missingNameParam_returns400() throws Exception {
        HttpResponse<String> resp = getAuthed("/api/cards");
        assertEquals(400, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals("BAD_REQUEST", body.get("code").asText());
    }

    @Test
    void getCardsPrintings_returnsManyPrintingsAndRespectsLimit() throws Exception {
        HttpResponse<String> resp = getAuthed("/api/cards/printings?name=Forest&limit=3");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(3, body.get("cards").size());
        assertTrue(body.get("truncated").asBoolean());
    }

    @Test
    void getCardsPrintings_invalidLimit_returns400() throws Exception {
        HttpResponse<String> resp = getAuthed("/api/cards/printings?name=Forest&limit=not-a-number");
        assertEquals(400, resp.statusCode());
    }

    @Test
    void unknownRoute_returns404WithEnvelope() throws Exception {
        HttpResponse<String> resp = getAuthed("/api/does-not-exist");
        assertEquals(404, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals("NOT_FOUND", body.get("code").asText());
    }

    @Test
    void doubleStart_throws() {
        WebApiServer second = new WebApiServer(EmbeddedServer.boot(CONFIG_PATH));
        try {
            second.start(0);
            second.start(0);
            throw new AssertionError("expected IllegalStateException on double start");
        } catch (IllegalStateException expected) {
            // ok
        } finally {
            second.stop();
        }
    }

    // ---------- helpers ----------

    private HttpResponse<String> get(String path) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .timeout(Duration.ofSeconds(5))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> getAuthed(String path) throws Exception {
        return HTTP.send(authedRequest(path).GET().build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest.Builder authedRequest(String path) {
        return HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + server.port() + path))
                .header("Authorization", "Bearer " + bearer)
                .timeout(Duration.ofSeconds(5));
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
