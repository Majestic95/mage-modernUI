package mage.webapi.server;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.SchemaVersion;
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
 * Integration tests for the Phase 2 first-slice routes: every WebApi route
 * has at least one test that hits the real Javalin instance, per CLAUDE.md.
 * Mocks lie; integration tests don't.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class WebApiServerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(2))
            .build();

    private final WebApiServer server = new WebApiServer();

    @BeforeAll
    void start() {
        server.start(0); // bind to a random free port
    }

    @AfterAll
    void stop() {
        server.stop();
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
    void unknownRoute_returns404() throws Exception {
        HttpResponse<String> resp = get("/api/does-not-exist");
        assertEquals(404, resp.statusCode());
    }

    @Test
    void doubleStart_throws() {
        WebApiServer second = new WebApiServer();
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
