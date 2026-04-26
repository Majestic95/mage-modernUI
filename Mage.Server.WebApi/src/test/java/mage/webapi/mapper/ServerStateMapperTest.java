package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebServerState;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Snapshot tests for {@link ServerStateMapper}. Locks the JSON output
 * shape so any drift in upstream {@code GameTypeView} or
 * {@code TournamentTypeView} surfaces here before reaching a client.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ServerStateMapperTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();

    private EmbeddedServer embedded;

    @BeforeAll
    void boot() {
        embedded = EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void fromState_returnsWebServerStateWithSchemaVersion() throws Exception {
        WebServerState state = ServerStateMapper.fromState(embedded.server().getServerState());

        assertEquals(SchemaVersion.CURRENT, state.schemaVersion());
        assertNotNull(state.gameTypes());
        assertNotNull(state.tournamentTypes());
        assertNotNull(state.playerTypes());
        assertNotNull(state.deckTypes());
        assertNotNull(state.draftCubes());
    }

    @Test
    void fromState_includesAtLeastOneGameType() throws Exception {
        WebServerState state = ServerStateMapper.fromState(embedded.server().getServerState());
        assertTrue(state.gameTypes().size() >= 1,
                "expected populated gameTypes, got " + state.gameTypes().size());

        var first = state.gameTypes().get(0);
        assertNotNull(first.name());
        assertTrue(first.minPlayers() >= 1);
        assertTrue(first.maxPlayers() >= first.minPlayers());
    }

    @Test
    void jsonOutput_topLevelHasExactlyTheDocumentedFields() throws Exception {
        WebServerState state = ServerStateMapper.fromState(embedded.server().getServerState());
        JsonNode node = JSON.readTree(JSON.writeValueAsString(state));

        // Lock the top-level field set: 7 fields. Adding a field is a
        // minor schema bump; this assertion forces an explicit change.
        assertEquals(7, node.size(),
                "WebServerState JSON must have exactly 7 fields; got: " + node);
        assertTrue(node.has("schemaVersion"));
        assertTrue(node.has("gameTypes"));
        assertTrue(node.has("tournamentTypes"));
        assertTrue(node.has("playerTypes"));
        assertTrue(node.has("deckTypes"));
        assertTrue(node.has("draftCubes"));
        assertTrue(node.has("testMode"));
    }

    @Test
    void jsonOutput_nestedGameTypeHasExactlyTheDocumentedFields() throws Exception {
        WebServerState state = ServerStateMapper.fromState(embedded.server().getServerState());
        JsonNode node = JSON.readTree(JSON.writeValueAsString(state));

        JsonNode firstGameType = node.get("gameTypes").get(0);
        assertNotNull(firstGameType, "expected at least one nested game type");
        // 7 fields per WebGameType, none of which is schemaVersion (nested).
        assertEquals(7, firstGameType.size(),
                "WebGameType JSON must have exactly 7 fields; got: " + firstGameType);
        assertTrue(firstGameType.has("name"));
        assertTrue(firstGameType.has("minPlayers"));
        assertTrue(firstGameType.has("maxPlayers"));
        assertTrue(firstGameType.has("numTeams"));
        assertTrue(firstGameType.has("playersPerTeam"));
        assertTrue(firstGameType.has("useRange"));
        assertTrue(firstGameType.has("useAttackOption"));
    }
}
