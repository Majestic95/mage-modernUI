package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.utils.MageVersion;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebVersion;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Snapshot tests for {@link VersionMapper}. Locks the JSON output shape so
 * that any drift in upstream {@link MageVersion} constants surfaces here
 * before reaching a client.
 */
class VersionMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void fromConstants_includesSchemaVersion() {
        WebVersion v = VersionMapper.fromConstants();
        assertEquals(SchemaVersion.CURRENT, v.schemaVersion(),
                "schemaVersion must always be SchemaVersion.CURRENT");
    }

    @Test
    void fromConstants_mageVersionMatchesUpstreamConstants() {
        WebVersion v = VersionMapper.fromConstants();
        String expected = MageVersion.MAGE_VERSION_MAJOR + "."
                + MageVersion.MAGE_VERSION_MINOR + "."
                + MageVersion.MAGE_VERSION_RELEASE + "-"
                + MageVersion.MAGE_VERSION_RELEASE_INFO;
        assertEquals(expected, v.mageVersion());
    }

    @Test
    void fromConstants_buildTimeIsNonNull() {
        WebVersion v = VersionMapper.fromConstants();
        // buildTime may be empty (developer build, no jar manifest), but
        // never null — that's the contract.
        assertNotNull(v.buildTime());
    }

    @Test
    void jsonOutput_hasExactlyTheDocumentedFields() throws Exception {
        WebVersion v = VersionMapper.fromConstants();
        String json = JSON.writeValueAsString(v);
        JsonNode node = JSON.readTree(json);

        // Lock the field set: schemaVersion, mageVersion, buildTime. Adding
        // a field is a minor schema bump; this assertion forces an explicit
        // change here when that happens.
        assertEquals(3, node.size(),
                "WebVersion JSON must have exactly 3 fields; got: " + json);
        assertTrue(node.has("schemaVersion"));
        assertTrue(node.has("mageVersion"));
        assertTrue(node.has("buildTime"));
    }
}
