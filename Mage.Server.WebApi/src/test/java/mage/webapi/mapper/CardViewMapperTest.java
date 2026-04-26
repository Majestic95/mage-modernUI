package mage.webapi.mapper;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.dto.stream.WebCardView;
import mage.webapi.dto.stream.WebPermanentView;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Locks the JSON shape of {@link WebCardView} and
 * {@link WebPermanentView} so upstream {@code CardView} drift surfaces
 * here, not on the wire.
 *
 * <p>The end-to-end mapping (real {@code CardView} → {@code WebCardView})
 * is covered by the lifecycle e2e in {@code GameStreamHandlerTest}
 * which spins up an embedded server, plays a real Forest into the
 * battlefield, and asserts on the resulting frame. This test focuses
 * on the wire-format shape contract.
 */
class CardViewMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void cardView_jsonShape_locksTwentyFields() throws Exception {
        WebCardView dto = new WebCardView(
                "550e8400-e29b-41d4-a716-446655440000",
                "Lightning Bolt",
                "Lightning Bolt",
                "LEA",
                "161",
                "{R}",
                1,
                "Instant",
                List.of(),
                List.of("INSTANT"),
                List.of(),
                List.of("R"),
                "COMMON",
                "",
                "",
                "",
                List.of("Lightning Bolt deals 3 damage to any target."),
                false,
                "",
                Map.of()
        );
        JsonNode node = JSON.valueToTree(dto);

        assertEquals(20, node.size(),
                "WebCardView must have exactly 20 fields; got: " + node);
        // Snapshot the field set explicitly so adding a field forces
        // a CHANGELOG bump.
        for (String field : List.of(
                "id", "name", "displayName", "expansionSetCode",
                "cardNumber", "manaCost", "manaValue", "typeLine",
                "supertypes", "types", "subtypes", "colors", "rarity",
                "power", "toughness", "startingLoyalty", "rules",
                "faceDown", "tokenSetCode", "counters")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
    }

    @Test
    void permanentView_jsonShape_locksTenFields() throws Exception {
        WebCardView card = new WebCardView(
                "id", "Forest", "Forest", "M21", "281", "", 0,
                "Basic Land — Forest", List.of("BASIC"), List.of("LAND"),
                List.of("Forest"), List.of(), "COMMON",
                "", "", "", List.of("({T}: Add {G}.)"),
                false, "", Map.of());
        WebPermanentView dto = new WebPermanentView(
                card, "alice", false, false, false, true, false, 0,
                List.of(), "");
        JsonNode node = JSON.valueToTree(dto);

        assertEquals(10, node.size(),
                "WebPermanentView must have exactly 10 fields; got: " + node);
        for (String field : List.of(
                "card", "controllerName", "tapped", "flipped",
                "transformed", "phasedIn", "summoningSickness",
                "damage", "attachments", "attachedTo")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
        // Composition: the nested card carries the full WebCardView shape.
        assertEquals(20, node.get("card").size(),
                "permanent.card must be a full WebCardView");
    }

    @Test
    void cardMap_emptyInput_returnsEmptyMap() {
        assertTrue(CardViewMapper.toCardMap(null).isEmpty());
        assertTrue(CardViewMapper.toCardMap(Map.of()).isEmpty());
    }

    @Test
    void permanentMap_emptyInput_returnsEmptyMap() {
        assertTrue(CardViewMapper.toPermanentMap(null).isEmpty());
        assertTrue(CardViewMapper.toPermanentMap(Map.of()).isEmpty());
    }

    @Test
    void mappers_nullInputs_throw() {
        assertThrows(IllegalArgumentException.class,
                () -> CardViewMapper.toCardDto(null));
        assertThrows(IllegalArgumentException.class,
                () -> CardViewMapper.toPermanentDto(null));
    }
}
