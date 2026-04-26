package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.cards.repository.CardRepository;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebCardInfo;
import mage.webapi.dto.WebCardListing;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Snapshot tests for {@link CardInfoMapper}. Locks the JSON output shape
 * so any drift in upstream {@code CardInfo} columns surfaces here before
 * reaching a client.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CardInfoMapperTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeAll
    void boot() {
        EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void single_nullCard_returnsEmptyListing() {
        WebCardListing listing = CardInfoMapper.single(null);
        assertEquals(SchemaVersion.CURRENT, listing.schemaVersion());
        assertTrue(listing.cards().isEmpty());
        assertFalse(listing.truncated());
    }

    @Test
    void single_lightningBolt_returnsOneCard() {
        var card = CardRepository.instance.findCard("Lightning Bolt");
        assertNotNull(card, "Lightning Bolt should exist in the card DB");

        WebCardListing listing = CardInfoMapper.single(card);
        assertEquals(SchemaVersion.CURRENT, listing.schemaVersion());
        assertEquals(1, listing.cards().size());

        WebCardInfo info = listing.cards().get(0);
        assertEquals("Lightning Bolt", info.name());
        assertNotNull(info.setCode());
        assertNotNull(info.cardNumber());
        assertEquals(1, info.manaValue());
        assertTrue(info.colors().contains("R"),
                "Lightning Bolt should be red; got colors " + info.colors());
        assertTrue(info.types().contains("INSTANT"),
                "Lightning Bolt should be an INSTANT; got types " + info.types());
    }

    @Test
    void jsonOutput_topLevelHasExactlyTheDocumentedFields() throws Exception {
        var card = CardRepository.instance.findCard("Lightning Bolt");
        WebCardListing listing = CardInfoMapper.single(card);
        JsonNode node = JSON.readTree(JSON.writeValueAsString(listing));

        assertEquals(3, node.size(),
                "WebCardListing JSON must have exactly 3 fields; got: " + node);
        assertTrue(node.has("schemaVersion"));
        assertTrue(node.has("cards"));
        assertTrue(node.has("truncated"));
    }

    @Test
    void jsonOutput_nestedCardHasExactlyTheDocumentedFields() throws Exception {
        var card = CardRepository.instance.findCard("Lightning Bolt");
        WebCardListing listing = CardInfoMapper.single(card);
        JsonNode node = JSON.readTree(JSON.writeValueAsString(listing));
        JsonNode first = node.get("cards").get(0);

        // 14 fields per WebCardInfo, none of which is schemaVersion.
        assertEquals(14, first.size(),
                "WebCardInfo JSON must have exactly 14 fields; got: " + first);
        assertTrue(first.has("name"));
        assertTrue(first.has("setCode"));
        assertTrue(first.has("cardNumber"));
        assertTrue(first.has("manaValue"));
        assertTrue(first.has("manaCosts"));
        assertTrue(first.has("rarity"));
        assertTrue(first.has("types"));
        assertTrue(first.has("subtypes"));
        assertTrue(first.has("supertypes"));
        assertTrue(first.has("colors"));
        assertTrue(first.has("power"));
        assertTrue(first.has("toughness"));
        assertTrue(first.has("startingLoyalty"));
        assertTrue(first.has("rules"));
    }

    @Test
    void many_marksTruncatedFlagWhenLimitHit() {
        // "Forest" has hundreds of printings; cap at 5 to force truncation.
        var cards = CardRepository.instance.findCards("Forest", 5);
        WebCardListing listing = CardInfoMapper.many(cards, cards.size() == 5);
        assertEquals(SchemaVersion.CURRENT, listing.schemaVersion());
        assertEquals(5, listing.cards().size());
        assertTrue(listing.truncated(), "expected truncated=true at limit");
    }
}
