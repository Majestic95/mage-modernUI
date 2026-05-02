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
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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

        // Slice 70 — reset MetricsRegistry counters before this test
        // class's HTTP probes start firing them. Counter state is
        // process-wide static; without this, a prior test class that
        // touched the increment paths would leak non-zero state into
        // any assertion here. Defense-in-depth — the slice 70 admin
        // metrics tests don't actually assert counter values today,
        // but the cross-class hygiene contract (see resetForTest
        // Javadoc) applies preemptively.
        mage.webapi.metrics.MetricsRegistry.resetForTest();

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
    void postSession_admin_emptyPassword_failsBecauseAdminDisabledByDefault() throws Exception {
        // Auditor #4 fix (2026-04-29): EmbeddedServer.boot now reads
        // XMAGE_ADMIN_PASSWORD from env. When unset (default in tests),
        // a random UUID is generated and admin login is effectively
        // disabled. Pre-fix, MageServerImpl was constructed with
        // adminPassword="" — anyone calling connectAdmin("") gained
        // admin. Test now pins the secure default: empty password is
        // refused.
        HttpResponse<String> r = postJson("/api/session/admin",
                "{\"adminPassword\":\"\"}");
        assertEquals(401, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals("INVALID_ADMIN_PASSWORD", body.get("code").asText());
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

    // ---------- slice 6: lobby + tables ----------

    @Test
    void getMainRoom_returnsRoomRef() throws Exception {
        HttpResponse<String> r = getAuthed("/api/server/main-room");
        assertEquals(200, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertNotNull(body.get("roomId").asText());
        // chatId may be empty in some configs; just assert the field exists.
        assertTrue(body.has("chatId"));
    }

    @Test
    void listTables_returnsListing() throws Exception {
        String roomId = mainRoomId();
        HttpResponse<String> r = getAuthed("/api/rooms/" + roomId + "/tables");
        assertEquals(200, r.statusCode());

        JsonNode body = JSON.readTree(r.body());
        assertEquals(SchemaVersion.CURRENT, body.get("schemaVersion").asText());
        assertTrue(body.has("tables"));
        assertTrue(body.get("tables").isArray());
    }

    @Test
    void createTable_returnsWebTableWithExpectedShape() throws Exception {
        String roomId = mainRoomId();
        HttpResponse<String> r = postJsonAuthed("/api/rooms/" + roomId + "/tables", """
                {"gameType":"Two Player Duel","deckType":"Constructed - Vintage","winsNeeded":1}
                """);
        assertEquals(200, r.statusCode(), r.body());

        JsonNode table = JSON.readTree(r.body());
        // Lock the 14-field shape.
        assertEquals(14, table.size(),
                "WebTable JSON must have exactly 14 fields; got: " + table);
        assertNotNull(table.get("tableId").asText());
        assertEquals("Two Player Duel", table.get("gameType").asText());
        assertEquals("Constructed - Vintage", table.get("deckType").asText());
        assertEquals("WAITING", table.get("tableState").asText());
        assertTrue(table.get("seats").isArray());
        assertEquals(2, table.get("seats").size(), "Two Player Duel must have 2 seats");
    }

    @Test
    void createTable_missingGameType_returns400() throws Exception {
        String roomId = mainRoomId();
        HttpResponse<String> r = postJsonAuthed("/api/rooms/" + roomId + "/tables", """
                {"deckType":"Constructed - Vintage","winsNeeded":1}
                """);
        assertEquals(400, r.statusCode());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void addAi_returns204() throws Exception {
        String roomId = mainRoomId();
        // Table must declare a COMPUTER seat upfront (ADR 0006 — upstream
        // getNextAvailableSeat filters by declared playerType).
        String tableId = createTableWithSeats(roomId,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));

        HttpResponse<String> r = postJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");
        assertEquals(204, r.statusCode(), r.body());
    }

    @Test
    void addAi_unknownPlayerType_returns400() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTableWithSeats(roomId,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));

        HttpResponse<String> r = postJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"NOT_A_REAL_AI\"}");
        assertEquals(400, r.statusCode());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void unknownTable_addAi_returns422() throws Exception {
        String roomId = mainRoomId();
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        HttpResponse<String> r = postJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + fakeTable + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");
        assertEquals(422, r.statusCode());
    }

    /* ---------- slice 25: delete table ---------- */

    @Test
    void deleteTable_byOwner_returns204_andRemovesFromListing() throws Exception {
        String e2eToken = freshAnonBearer();
        String roomId = mainRoomId();
        String tableId = createTableWith(e2eToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));

        HttpResponse<String> del = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + e2eToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(204, del.statusCode(), del.body());

        HttpResponse<String> list = getWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables");
        JsonNode tables = JSON.readTree(list.body()).get("tables");
        for (JsonNode t : tables) {
            assertNotEquals(tableId, t.get("tableId").asText(),
                    "deleted table must not appear in listing");
        }
    }

    @Test
    void deleteTable_byNonOwner_returns403() throws Exception {
        // Owner creates the table
        String ownerToken = freshAnonBearer();
        String roomId = mainRoomId();
        String tableId = createTableWith(ownerToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));

        // Different session attempts to delete
        String otherToken = freshAnonBearer();
        HttpResponse<String> del = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + otherToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(403, del.statusCode(), del.body());
        assertEquals("NOT_OWNER", JSON.readTree(del.body()).get("code").asText());

        // Cleanup so the test doesn't leak a table to subsequent tests
        HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + ownerToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void deleteTable_malformedTableId_returns400() throws Exception {
        String roomId = mainRoomId();
        HttpResponse<String> del = HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/not-a-uuid"))
                        .header("Authorization", "Bearer " + bearer)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(400, del.statusCode());
        assertEquals("BAD_REQUEST", JSON.readTree(del.body()).get("code").asText());
    }

    /* ---------- slice L3: edit table options (PATCH) ---------- */

    @Test
    void patchTable_byOwner_updatesEditableFields() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTestTable(roomId);
        // Patch a curated subset of fields (one of each interesting kind:
        // string, enum-string, int, boolean) so the success path covers
        // the key dispatch arms in updateMatchOptions.
        String body = """
                {"password":"hunter2","skillLevel":"SERIOUS",
                 "freeMulligans":3,"spectatorsAllowed":false,"rated":true}
                """;
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId, body);
        assertEquals(200, r.statusCode(), r.body());

        JsonNode table = JSON.readTree(r.body());
        // Re-mapped WebTable comes back. Spot-check the fields that
        // surface on the wire (skillLevel + spectatorsAllowed + rated +
        // passworded). freeMulligans isn't surfaced on WebTable today,
        // so it's covered by the "no error" outcome only.
        assertEquals(tableId, table.get("tableId").asText());
        assertEquals("SERIOUS", table.get("skillLevel").asText());
        assertFalse(table.get("spectatorsAllowed").asBoolean());
        assertTrue(table.get("rated").asBoolean());
        assertTrue(table.get("passworded").asBoolean(),
                "non-empty password must mark the table passworded");
    }

    @Test
    void patchTable_emptyPassword_clearsPasswordedFlag() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTestTable(roomId);
        // First set a password.
        patchJsonAuthed("/api/rooms/" + roomId + "/tables/" + tableId,
                "{\"password\":\"x\"}");
        // Then clear it.
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId,
                "{\"password\":\"\"}");
        assertEquals(200, r.statusCode(), r.body());
        assertFalse(JSON.readTree(r.body()).get("passworded").asBoolean(),
                "empty password must clear the passworded flag");
    }

    @Test
    void patchTable_byNonOwner_returns403() throws Exception {
        String ownerToken = freshAnonBearer();
        String roomId = mainRoomId();
        String tableId = createTableWith(ownerToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));

        String otherToken = freshAnonBearer();
        HttpResponse<String> r = patchJsonWithToken(otherToken,
                "/api/rooms/" + roomId + "/tables/" + tableId,
                "{\"password\":\"steal\"}");
        assertEquals(403, r.statusCode(), r.body());
        assertEquals("NOT_OWNER", JSON.readTree(r.body()).get("code").asText());

        // Cleanup
        HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + ownerToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void patchTable_unknownTable_returns404() throws Exception {
        String roomId = mainRoomId();
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + fakeTable,
                "{\"password\":\"x\"}");
        assertEquals(404, r.statusCode(), r.body());
        assertEquals("TABLE_NOT_FOUND", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void patchTable_invalidEnumValue_returns400() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTestTable(roomId);
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId,
                "{\"skillLevel\":\"GOD_TIER\"}");
        assertEquals(400, r.statusCode(), r.body());
        JsonNode err = JSON.readTree(r.body());
        assertEquals("BAD_REQUEST", err.get("code").asText());
        assertTrue(err.get("message").asText().contains("skillLevel"),
                "error message should name the offending field; got: " + err);
    }

    @Test
    void patchTable_outOfRangeFreeMulligans_returns400() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTestTable(roomId);
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId,
                "{\"freeMulligans\":99}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void patchTable_emptyBody_isNoOp_returns200() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTestTable(roomId);
        // {} is valid JSON; every field null → no mutations applied,
        // just returns the current WebTable.
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId, "{}");
        assertEquals(200, r.statusCode(), r.body());
        assertEquals(tableId, JSON.readTree(r.body()).get("tableId").asText());
    }

    @Test
    void patchTable_malformedTableId_returns400() throws Exception {
        String roomId = mainRoomId();
        HttpResponse<String> r = patchJsonAuthed(
                "/api/rooms/" + roomId + "/tables/not-a-uuid",
                "{\"password\":\"x\"}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    /* ---------- slice L5: per-seat ready toggle ---------- */

    @Test
    void seatReady_bySeatedUser_returns204() throws Exception {
        // Create a 2-seat table, fill seat 1 with AI, host /joins seat 0
        // with their session username — only then are they "seated" and
        // permitted to toggle ready. The /seat/ready endpoint round-
        // trips both off and on without error.
        String e2eToken = freshAnonBearer();
        String username = JSON.readTree(
                getWithToken(e2eToken, "/api/session/me").body())
                .get("username").asText();
        String roomId = mainRoomId();
        String tableId = createTableWith(e2eToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));
        // Fill the AI seat
        postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");
        // Host /joins their own seat with the username (matches
        // production webclient behavior — username is the player name).
        String deckJson = buildForestDeckJson(60);
        String joinBody = String.format(
                "{\"name\":\"%s\",\"skill\":1,\"deck\":%s}", username, deckJson);
        HttpResponse<String> join = postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode(), join.body());

        // Now toggle: off, then on. Both must succeed.
        HttpResponse<String> off = postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/ready",
                "{\"ready\":false}");
        assertEquals(204, off.statusCode(), off.body());

        HttpResponse<String> on = postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/ready",
                "{\"ready\":true}");
        assertEquals(204, on.statusCode(), on.body());

        // Cleanup
        HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + e2eToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void seatReady_unknownTable_returns404() throws Exception {
        String roomId = mainRoomId();
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        HttpResponse<String> r = postJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + fakeTable + "/seat/ready",
                "{\"ready\":true}");
        assertEquals(404, r.statusCode(), r.body());
        assertEquals("TABLE_NOT_FOUND", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void seatReady_callerNotSeated_returns403() throws Exception {
        // Host creates the table; a different anon user (no seat) tries
        // to toggle ready and gets 403 NOT_SEATED.
        String ownerToken = freshAnonBearer();
        String roomId = mainRoomId();
        String tableId = createTableWith(ownerToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "HUMAN"));

        String otherToken = freshAnonBearer();
        HttpResponse<String> r = postJsonWithToken(otherToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/ready",
                "{\"ready\":true}");
        assertEquals(403, r.statusCode(), r.body());
        assertEquals("NOT_SEATED", JSON.readTree(r.body()).get("code").asText());

        // Cleanup
        HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + ownerToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void seatReady_missingReadyField_returns400() throws Exception {
        String roomId = mainRoomId();
        String tableId = createTestTable(roomId);
        HttpResponse<String> r = postJsonAuthed(
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/ready",
                "{}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void seatReady_malformedTableId_returns400() throws Exception {
        String roomId = mainRoomId();
        HttpResponse<String> r = postJsonAuthed(
                "/api/rooms/" + roomId + "/tables/not-a-uuid/seat/ready",
                "{\"ready\":true}");
        assertEquals(400, r.statusCode(), r.body());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    /* ---------- slice L6: PUT /seat/deck (deck submit + swap) ---------- */

    /** Slice L6 — PATCH-style helper for deck submit/swap. */
    private HttpResponse<String> putJsonWithToken(String token, String path, String body) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(10))
                        .method("PUT", HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void seatDeck_firstTake_returns204() throws Exception {
        // First-time take: user is not yet seated. PUT /seat/deck
        // joins them with the supplied deck. We don't verify via the
        // table-listing endpoint because GamesRoomImpl.getTables()
        // returns a snapshot refreshed every 2 seconds, so a freshly-
        // created/joined table won't appear there for a beat. The 204
        // response itself confirms the join succeeded — the route's
        // status code path runs only after LobbyService.swapDeck
        // completes without throwing, which means upstream
        // roomJoinTable returned ok=true.
        String e2eToken = freshAnonBearer();
        String username = JSON.readTree(
                getWithToken(e2eToken, "/api/session/me").body())
                .get("username").asText();
        String roomId = mainRoomId();
        String tableId = createTableWith(e2eToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));
        postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");
        String deckJson = buildForestDeckJson(60);
        String body = String.format(
                "{\"name\":\"%s\",\"skill\":1,\"deck\":%s}", username, deckJson);
        HttpResponse<String> r = putJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/deck",
                body);
        assertEquals(204, r.statusCode(), r.body());

        // Cleanup
        HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + e2eToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void seatDeck_swap_returns204() throws Exception {
        // Take seat, then swap deck via PUT — both calls must return
        // 204. The in-place updateDeck path (LobbyService.swapDeck
        // uses Match.updateDeck for seated users) avoids the leave-
        // table trap where the owner leaving in WAITING state would
        // remove the entire lobby. Same reason for not asserting on
        // the listing — the cached snapshot is stale.
        String e2eToken = freshAnonBearer();
        String username = JSON.readTree(
                getWithToken(e2eToken, "/api/session/me").body())
                .get("username").asText();
        String roomId = mainRoomId();
        String tableId = createTableWith(e2eToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));
        postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");
        String deckJson = buildForestDeckJson(60);
        String body = String.format(
                "{\"name\":\"%s\",\"skill\":1,\"deck\":%s}", username, deckJson);
        // First-take seat
        assertEquals(204, putJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/deck",
                body).statusCode());
        // Ready up
        assertEquals(204, postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/ready",
                "{\"ready\":true}").statusCode());
        // Swap deck — same body works as a re-submit
        HttpResponse<String> swap = putJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/seat/deck",
                body);
        assertEquals(204, swap.statusCode(), swap.body());

        // Cleanup
        HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/rooms/" + roomId + "/tables/" + tableId))
                        .header("Authorization", "Bearer " + e2eToken)
                        .timeout(Duration.ofSeconds(5))
                        .DELETE()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void seatDeck_unknownTable_returns404() throws Exception {
        String roomId = mainRoomId();
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        String body = "{\"name\":\"x\",\"skill\":1,\"deck\":"
                + "{\"name\":\"d\",\"author\":\"\",\"cards\":[],\"sideboard\":[]}}";
        HttpResponse<String> r = putJsonWithToken(bearer,
                "/api/rooms/" + roomId + "/tables/" + fakeTable + "/seat/deck",
                body);
        assertEquals(404, r.statusCode(), r.body());
        assertEquals("TABLE_NOT_FOUND", JSON.readTree(r.body()).get("code").asText());
    }

    /* ---------- slice 13: deck submit ---------- */

    @Test
    void submitDeck_unknownTable_returns204() throws Exception {
        // Upstream's TableManagerImpl.submitDeck returns true (with a
        // server-side "Table no longer active" message) when the
        // table doesn't exist — the design lets the user's submit
        // panel close cleanly even after the table evaporated. So
        // the wire response is 204, not 422. This test locks that
        // contract: the route is wired through to upstream, and the
        // request body parses cleanly.
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        String body = "{\"name\":\"x\",\"author\":\"\",\"cards\":[],\"sideboard\":[]}";
        HttpResponse<String> r = postJsonAuthed(
                "/api/tables/" + fakeTable + "/deck", body);
        assertEquals(204, r.statusCode(), r.body());
    }

    @Test
    void submitDeck_updateMode_unknownTable_returns204() throws Exception {
        // ?update=true routes to deckSave (void return). With no
        // table the call no-ops; we still expect a 204.
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        String body = "{\"name\":\"x\",\"author\":\"\",\"cards\":[],\"sideboard\":[]}";
        HttpResponse<String> r = postJsonAuthed(
                "/api/tables/" + fakeTable + "/deck?update=true", body);
        assertEquals(204, r.statusCode(), r.body());
    }

    @Test
    void submitDeck_malformedTableId_returns400() throws Exception {
        HttpResponse<String> r = postJsonAuthed(
                "/api/tables/not-a-uuid/deck",
                "{\"name\":\"x\",\"author\":\"\",\"cards\":[],\"sideboard\":[]}");
        assertEquals(400, r.statusCode());
        assertEquals("BAD_REQUEST", JSON.readTree(r.body()).get("code").asText());
    }

    @Test
    void submitDeck_blankBody_returns400() throws Exception {
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        HttpResponse<String> r = postJsonAuthed(
                "/api/tables/" + fakeTable + "/deck", "");
        assertEquals(400, r.statusCode());
    }

    @Test
    void submitDeck_missingAuth_returns401() throws Exception {
        String fakeTable = "00000000-0000-0000-0000-000000000000";
        HttpResponse<String> r = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port()
                                + "/api/tables/" + fakeTable + "/deck"))
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"name\":\"x\",\"author\":\"\",\"cards\":[],\"sideboard\":[]}"))
                        .header("Content-Type", "application/json")
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(401, r.statusCode());
    }

    @Test
    void endToEnd_createTableAddAiJoinStart_advancesTableState() throws Exception {
        // Use a fresh anon session so test state is isolated from `bearer`.
        String e2eToken = freshAnonBearer();

        String roomId = mainRoomId();
        String tableId = createTableWith(e2eToken, roomId,
                "Two Player Duel", "Constructed - Vintage", 1,
                List.of("HUMAN", "COMPUTER_MONTE_CARLO"));

        // Add an AI seat
        HttpResponse<String> ai = postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/ai",
                "{\"playerType\":\"COMPUTER_MONTE_CARLO\"}");
        assertEquals(204, ai.statusCode(), ai.body());

        // Join with a 60-Forest deck
        String deckJson = buildForestDeckJson(60);
        String joinBody = String.format(
                "{\"name\":\"e2e-tester\",\"skill\":1,\"deck\":%s}", deckJson);
        HttpResponse<String> join = postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/join", joinBody);
        assertEquals(204, join.statusCode(), "join failed: " + join.body());

        // Start the match
        HttpResponse<String> start = postJsonWithToken(e2eToken,
                "/api/rooms/" + roomId + "/tables/" + tableId + "/start", "");
        assertEquals(204, start.statusCode(), "start failed: " + start.body());

        // Verify the table state has advanced past WAITING. Two valid
        // outcomes:
        //   (a) table still appears in the listing with state != WAITING
        //   (b) table has dropped from the listing entirely (which the
        //       upstream lobby refresh does once a match transitions to
        //       DUELING+) — also proof of advancement
        HttpResponse<String> list = getWithToken(e2eToken, "/api/rooms/" + roomId + "/tables");
        JsonNode tables = JSON.readTree(list.body()).get("tables");
        for (JsonNode t : tables) {
            if (tableId.equals(t.get("tableId").asText())) {
                String state = t.get("tableState").asText();
                assertNotEquals("WAITING", state,
                        "table still listed but state is WAITING: should have advanced");
                return;
            }
        }
        // Table not in listing — match transitioned past the lobby snapshot,
        // which is also success.
    }

    @Test
    void cors_defaultOriginsParseAndAcceptPreflight() throws Exception {
        // Regression: Javalin's CORS plugin requires every origin to
        // have an explicit port number. Any default that violates this
        // crashes EVERY request with `IllegalArgumentException: explicit
        // port is required`. Boot a separate server with CORS enabled
        // and assert a real preflight from localhost:5173 succeeds.
        EmbeddedServer embedded = EmbeddedServer.boot(CONFIG_PATH);
        WebApiServer corsServer = new WebApiServer(embedded)
                .allowCorsOrigins(WebApiServer.DEFAULT_CORS_ORIGINS)
                .start(0);
        try {
            HttpResponse<String> preflight = HTTP.send(
                    HttpRequest.newBuilder()
                            .uri(URI.create("http://localhost:" + corsServer.port() + "/api/session"))
                            .header("Origin", "http://localhost:5173")
                            .header("Access-Control-Request-Method", "POST")
                            .header("Access-Control-Request-Headers", "Content-Type")
                            .timeout(Duration.ofSeconds(5))
                            .method("OPTIONS", HttpRequest.BodyPublishers.noBody())
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            // Javalin's CORS plugin may use 200 or 204; either is fine
            // as long as it's not the 500 we'd see on a malformed origin.
            assertTrue(preflight.statusCode() < 400,
                    "CORS preflight must succeed (got " + preflight.statusCode()
                            + "): " + preflight.body());
            // Real request with Origin must not crash.
            HttpResponse<String> real = HTTP.send(
                    HttpRequest.newBuilder()
                            .uri(URI.create("http://localhost:" + corsServer.port() + "/api/session"))
                            .header("Origin", "http://localhost:5173")
                            .header("Content-Type", "application/json")
                            .timeout(Duration.ofSeconds(5))
                            .POST(HttpRequest.BodyPublishers.ofString("{}"))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(200, real.statusCode(),
                    "anon login with Origin header must succeed: " + real.body());
        } finally {
            corsServer.stop();
        }
    }

    @Test
    void postSession_oversizedBody_returns413() throws Exception {
        // Slice 64 — 1 MB body cap. Largest legitimate request is a
        // deck-submit at ~10 KB; 2 MB JSON should be rejected before
        // it parses to prevent memory-amplification DoS. The exact
        // status code depends on Javalin/Jetty's body-size enforcement
        // path. 413 is ideal; 400/500 also acceptable since the
        // request is rejected.
        String oversized = "{\"username\":\"" + "x".repeat(2_000_000) + "\"}";
        HttpResponse<String> r = postJson("/api/session", oversized);
        assertTrue(r.statusCode() == 413 || r.statusCode() == 400 || r.statusCode() == 500,
                "expected 413/400/500 for 2MB body, got: " + r.statusCode());
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

    // ---------- slice 70: admin /metrics endpoint (ADR 0010 v2 D10) ----------

    @Test
    void adminMetrics_noToken_returns401FromMiddleware() throws Exception {
        // Bearer middleware fires before the handler. Missing token =
        // 401 MISSING_TOKEN, regardless of route. Locks that the
        // /api/admin/metrics route is NOT in the public allow-list
        // (which would skip auth entirely).
        HttpResponse<String> r = get("/api/admin/metrics");
        assertEquals(401, r.statusCode());
        JsonNode body = JSON.readTree(r.body());
        assertEquals("MISSING_TOKEN", body.get("code").asText());
    }

    @Test
    void adminMetrics_anonToken_returns403AdminRequired() throws Exception {
        // The default test bearer is anonymous (isAdmin=false). The
        // MetricsHandler's session.isAdmin() check rejects with 403
        // ADMIN_REQUIRED — distinct from 401 (auth failed) because
        // the user IS authenticated, they just lack admin scope.
        HttpResponse<String> r = getAuthed("/api/admin/metrics");
        assertEquals(403, r.statusCode());
        JsonNode body = JSON.readTree(r.body());
        assertEquals("ADMIN_REQUIRED", body.get("code").asText());
        assertTrue(body.get("message").asText().contains("Admin token required"),
                "error message should hint at the admin login flow: "
                        + body);
    }

    @Test
    void adminMetrics_anonToken_doesNotLeakMetricsBody() throws Exception {
        // Defense-in-depth: a 403 response must NOT carry the
        // Prometheus body (would defeat the admin gate). The error
        // envelope is JSON, never plain text. Lock the content type.
        HttpResponse<String> r = getAuthed("/api/admin/metrics");
        assertEquals(403, r.statusCode());
        // Body should be the JSON error envelope, not Prometheus text.
        // Anything that looks like "# HELP" or "# TYPE" leaking through
        // would mean the handler ran before the auth check.
        assertFalse(r.body().contains("# HELP"),
                "403 must NOT include Prometheus output: " + r.body());
        assertFalse(r.body().contains("# TYPE"),
                "403 must NOT include Prometheus output: " + r.body());
        assertFalse(r.body().contains("xmage_active_games"),
                "403 must NOT include the active-games gauge: " + r.body());
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

    private HttpResponse<String> postJsonAuthed(String path, String body) throws Exception {
        return postJsonWithToken(bearer, path, body);
    }

    private HttpResponse<String> postJsonWithToken(String token, String path, String body) throws Exception {
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

    /** Slice L3 — PATCH helper for the new edit-table-options endpoint. */
    private HttpResponse<String> patchJsonAuthed(String path, String body) throws Exception {
        return patchJsonWithToken(bearer, path, body);
    }

    private HttpResponse<String> patchJsonWithToken(String token, String path, String body) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(10))
                        .method("PATCH", HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> getWithToken(String token, String path) throws Exception {
        return HTTP.send(
                HttpRequest.newBuilder()
                        .uri(URI.create("http://localhost:" + server.port() + path))
                        .header("Authorization", "Bearer " + token)
                        .timeout(Duration.ofSeconds(5))
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private String mainRoomId() throws Exception {
        return JSON.readTree(getAuthed("/api/server/main-room").body()).get("roomId").asText();
    }

    private String createTestTable(String roomId) throws Exception {
        HttpResponse<String> r = postJsonAuthed("/api/rooms/" + roomId + "/tables", """
                {"gameType":"Two Player Duel","deckType":"Constructed - Vintage","winsNeeded":1}
                """);
        assertEquals(200, r.statusCode(), "table create failed: " + r.body());
        return JSON.readTree(r.body()).get("tableId").asText();
    }

    private String createTableWithSeats(String roomId, List<String> seats) throws Exception {
        String seatJson = seats.stream()
                .map(s -> "\"" + s + "\"")
                .collect(java.util.stream.Collectors.joining(",", "[", "]"));
        String body = String.format(
                "{\"gameType\":\"Two Player Duel\",\"deckType\":\"Constructed - Vintage\","
                        + "\"winsNeeded\":1,\"seats\":%s}",
                seatJson);
        HttpResponse<String> r = postJsonAuthed("/api/rooms/" + roomId + "/tables", body);
        assertEquals(200, r.statusCode(), "table create failed: " + r.body());
        return JSON.readTree(r.body()).get("tableId").asText();
    }

    private String createTableWith(String token, String roomId, String gameType,
                                    String deckType, int winsNeeded,
                                    List<String> seats) throws Exception {
        String seatJson = seats.stream()
                .map(s -> "\"" + s + "\"")
                .collect(java.util.stream.Collectors.joining(",", "[", "]"));
        String body = String.format(
                "{\"gameType\":\"%s\",\"deckType\":\"%s\",\"winsNeeded\":%d,\"seats\":%s}",
                gameType, deckType, winsNeeded, seatJson);
        HttpResponse<String> r = postJsonWithToken(token,
                "/api/rooms/" + roomId + "/tables", body);
        assertEquals(200, r.statusCode(), "table create failed: " + r.body());
        return JSON.readTree(r.body()).get("tableId").asText();
    }

    private String freshAnonBearer() throws Exception {
        HttpResponse<String> r = postJson("/api/session", "{}");
        return JSON.readTree(r.body()).get("token").asText();
    }

    private String buildForestDeckJson(int amount) throws Exception {
        // Find a real Forest printing in the local card DB so the deck
        // passes upstream validation.
        HttpResponse<String> r = getAuthed("/api/cards?name=Forest");
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
}
