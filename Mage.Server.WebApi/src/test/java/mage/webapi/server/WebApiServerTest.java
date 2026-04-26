package mage.webapi.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.SchemaVersion;
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
 * Integration tests for the WebApi routes. Boots an embedded Mage server
 * once for the test class (idempotent — reuses the JVM-singleton) and
 * exercises every route via real HTTP, per CLAUDE.md.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WebApiServerTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    private WebApiServer server;

    @BeforeAll
    void start() {
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        server = new WebApiServer(embedded).start(0); // bind to random free port
    }

    @AfterAll
    void stop() {
        if (server != null) {
            server.stop();
        }
    }

    @Test
    void getVersion_returnsSchemaAndMageVersion() throws Exception {
        HttpResponse<String> resp = get("/api/version");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertNotNull(body.get("mageVersion"));
        assertTrue(body.get("mageVersion").asText().startsWith("1.4."),
                "expected mageVersion to start with 1.4.; got: " + body.get("mageVersion"));
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

    @Test
    void getServerState_returnsLoadedTypes() throws Exception {
        // getServerState() in MageServerImpl sleeps 1 second for DDoS
        // protection. Allow extra time for this call.
        HttpResponse<String> resp = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + "/api/server/state"))
                        .timeout(Duration.ofSeconds(10))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertTrue(body.get("gameTypes").size() >= 1,
                "expected at least one game type, got " + body.get("gameTypes").size());
        assertTrue(body.get("playerTypes").size() >= 1,
                "expected at least one player type, got " + body.get("playerTypes").size());
        assertTrue(body.get("deckTypes").size() >= 1,
                "expected at least one deck type, got " + body.get("deckTypes").size());
    }

    @Test
    void getCards_byName_returnsOneMatch() throws Exception {
        HttpResponse<String> resp = get("/api/cards?name=Lightning+Bolt");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertEquals(1, body.get("cards").size());
        assertEquals("Lightning Bolt", body.get("cards").get(0).get("name").asText());
    }

    @Test
    void getCards_unknownName_returnsEmptyListing() throws Exception {
        HttpResponse<String> resp = get("/api/cards?name=NoSuchCardEverExists12345");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(0, body.get("cards").size());
        assertFalse(body.get("truncated").asBoolean());
    }

    @Test
    void getCards_missingNameParam_returns400() throws Exception {
        HttpResponse<String> resp = get("/api/cards");
        assertEquals(400, resp.statusCode());
    }

    @Test
    void getCardsPrintings_returnsManyPrintingsAndRespectsLimit() throws Exception {
        HttpResponse<String> resp = get("/api/cards/printings?name=Forest&limit=3");
        assertEquals(200, resp.statusCode());

        JsonNode body = JSON.readTree(resp.body());
        assertEquals(3, body.get("cards").size(),
                "expected exactly 3 printings (limit=3)");
        assertTrue(body.get("truncated").asBoolean(),
                "limit was hit, truncated must be true");
    }

    @Test
    void getCardsPrintings_invalidLimit_returns400() throws Exception {
        HttpResponse<String> resp = get("/api/cards/printings?name=Forest&limit=not-a-number");
        assertEquals(400, resp.statusCode());
    }

    @Test
    void unknownRoute_returns404() throws Exception {
        HttpResponse<String> resp = get("/api/does-not-exist");
        assertEquals(404, resp.statusCode());
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

    private HttpResponse<String> get(String path) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create("http://localhost:" + server.port() + path))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();
        return HTTP.send(req, HttpResponse.BodyHandlers.ofString());
    }
}
