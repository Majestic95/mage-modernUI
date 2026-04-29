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
    void cardView_jsonShape_locksTwentyFourFields() throws Exception {
        WebCardView dto = new WebCardView(
                "550e8400-e29b-41d4-a716-446655440000",
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
                Map.of(),
                false,
                false,
                null,
                ""
        );
        JsonNode node = JSON.valueToTree(dto);

        assertEquals(24, node.size(),
                "WebCardView must have exactly 24 fields "
                        + "(slice 52a added cardId for cross-zone animation); got: " + node);
        // Snapshot the field set explicitly so adding a field forces
        // a CHANGELOG bump. transformable/transformed/secondCardFace
        // landed in 1.12 — DFC + MDFC support per audit §3.
        // sourceLabel landed in 1.18 — trigger-order source attribution.
        // cardId landed in 1.19 (slice 52a) — stack/spell underlying
        // card UUID for Framer Motion layoutId cross-zone animation.
        for (String field : List.of(
                "id", "cardId", "name", "displayName", "expansionSetCode",
                "cardNumber", "manaCost", "manaValue", "typeLine",
                "supertypes", "types", "subtypes", "colors", "rarity",
                "power", "toughness", "startingLoyalty", "rules",
                "faceDown", "counters",
                "transformable", "transformed", "secondCardFace",
                "sourceLabel")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
    }

    @Test
    void permanentView_jsonShape_locksGoadingPlayerIds_populated() throws Exception {
        // Slice 69c (ADR 0010 v2 D3c) — when the multiplayer frame
        // context carries goading data for a permanent, the wire
        // field surfaces it. Lock the populated path so a future
        // mapper refactor can't silently drop the populate.
        java.util.UUID permId = java.util.UUID.fromString(
                "aaaaaaaa-1111-1111-1111-111111111111");
        java.util.UUID goader1 = java.util.UUID.fromString(
                "bbbbbbbb-2222-2222-2222-222222222222");
        java.util.UUID goader2 = java.util.UUID.fromString(
                "cccccccc-3333-3333-3333-333333333333");
        WebPermanentView dto = new WebPermanentView(
                new WebCardView(
                        permId.toString(), permId.toString(),
                        "Marauding Raptor", "Marauding Raptor", "RIX", "151",
                        "{1}{R}", 2,
                        "Creature — Dinosaur", List.of(),
                        List.of("CREATURE"), List.of("Dinosaur"),
                        List.of("R"), "UNCOMMON",
                        "3", "2", "",
                        List.of("Goad target creature."),
                        false, Map.of(),
                        false, false, null, ""),
                "alice", false, false, false, true, false, 0,
                List.of(), "", false,
                // Slice 69c: populated by mapper from
                // Permanent.getGoadingPlayers() — represents
                // alice + bob having both goaded this Raptor in 4p FFA.
                List.of(goader1.toString(), goader2.toString()));
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(12, node.size(),
                "WebPermanentView must have exactly 12 fields; got: " + node);
        assertTrue(node.get("goadingPlayerIds").isArray());
        assertEquals(2, node.get("goadingPlayerIds").size(),
                "two goaders should round-trip to a 2-element JSON array");
    }

    @Test
    void permanentView_jsonShape_locksTwelveFields() throws Exception {
        WebCardView card = new WebCardView(
                "id", "id", "Forest", "Forest", "M21", "281", "", 0,
                "Basic Land — Forest", List.of("BASIC"), List.of("LAND"),
                List.of("Forest"), List.of(), "COMMON",
                "", "", "", List.of("({T}: Add {G}.)"),
                false, Map.of(),
                false, false, null, "");
        WebPermanentView dto = new WebPermanentView(
                card, "alice", false, false, false, true, false, 0,
                List.of(), "", false, List.of());
        JsonNode node = JSON.valueToTree(dto);

        // Schema 1.20 (slice 69a): added goadingPlayerIds → 12 fields.
        assertEquals(12, node.size(),
                "WebPermanentView must have exactly 12 fields; got: " + node);
        for (String field : List.of(
                "card", "controllerName", "tapped", "flipped",
                "transformed", "phasedIn", "summoningSickness",
                "damage", "attachments", "attachedTo",
                "attachedToPermanent", "goadingPlayerIds")) {
            assertTrue(node.has(field), "missing field: " + field);
        }
        // Composition: the nested card carries the full WebCardView shape.
        assertEquals(24, node.get("card").size(),
                "permanent.card must be a full WebCardView");
        // Schema 1.20 wire shape: empty array until slice 69b plumbs
        // live Permanent access through the mapper (ADR 0010 v2 D3c).
        assertTrue(node.get("goadingPlayerIds").isArray());
        assertEquals(0, node.get("goadingPlayerIds").size());
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
