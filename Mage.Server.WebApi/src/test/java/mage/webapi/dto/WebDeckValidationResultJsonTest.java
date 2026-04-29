package mage.webapi.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 72-A — round-trips {@link WebDeckValidationResult} through
 * Jackson to lock the schema 1.21 wire contract for the pre-flight
 * endpoint.
 */
class WebDeckValidationResultJsonTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void validDeck_serializesValidTrueAndPartlyLegalTrue() throws Exception {
        // valid=true implies partlyLegal=true trivially (a legal deck
        // is "legal once finished"). Empty errors[] still serializes —
        // not omitted — so clients render uniformly.
        WebDeckValidationResult ok =
                new WebDeckValidationResult("1.21", true, true, List.of());
        String json = JSON.writeValueAsString(ok);
        assertTrue(json.contains("\"valid\":true"));
        assertTrue(json.contains("\"partlyLegal\":true"));
        assertTrue(json.contains("\"errors\":[]"));
    }

    @Test
    void invalidDeckRoundTrip_preservesAllFields() throws Exception {
        WebDeckValidationResult fail = new WebDeckValidationResult("1.21", false, false, List.of(
                new WebDeckValidationError("BANNED", "Sol Ring", "Banned",
                        "Sol Ring", false, false),
                new WebDeckValidationError("OTHER", "Lightning Bolt",
                        "Color identity violation", "Lightning Bolt", false, false)
        ));
        String json = JSON.writeValueAsString(fail);

        WebDeckValidationResult round = JSON.readValue(json, WebDeckValidationResult.class);
        assertEquals("1.21", round.schemaVersion());
        assertFalse(round.valid());
        assertFalse(round.partlyLegal(),
                "BANNED is a hard error — deck-level partlyLegal must be false");
        assertNotNull(round.errors());
        assertEquals(2, round.errors().size());
        assertEquals("BANNED", round.errors().get(0).errorType());
        assertEquals("Sol Ring", round.errors().get(0).cardName());
        assertEquals("OTHER", round.errors().get(1).errorType());
        assertFalse(round.errors().get(0).synthetic(),
                "real validator findings must round-trip synthetic=false");
    }

    @Test
    void deckSizeOnly_isAmberCase_partlyLegalTrue() throws Exception {
        // The deck-builder UX cares about exactly this case: deck has
        // only DECK_SIZE errors → not currently valid, but legal once
        // finished. partlyLegal must be true.
        WebDeckValidationResult result = new WebDeckValidationResult("1.21",
                false, true, List.of(
                new WebDeckValidationError("DECK_SIZE", "Deck",
                        "Must contain at least 100 cards: has only 60 cards",
                        null, true, false)
        ));
        String json = JSON.writeValueAsString(result);
        WebDeckValidationResult round = JSON.readValue(json, WebDeckValidationResult.class);
        assertFalse(round.valid());
        assertTrue(round.partlyLegal(),
                "DECK_SIZE-only failure must surface partlyLegal=true so clients "
                        + "render the amber 'legal once finished' affordance");
    }

    @Test
    void overflowSentinel_roundTripsSyntheticTrue() throws Exception {
        WebDeckValidationResult result = new WebDeckValidationResult("1.21",
                false, false, List.of(
                new WebDeckValidationError("BANNED", "Mana Crypt",
                        "Banned", "Mana Crypt", false, false),
                new WebDeckValidationError("OTHER", "...",
                        "and more 12 errors", null, false, true)
        ));
        String json = JSON.writeValueAsString(result);
        WebDeckValidationResult round = JSON.readValue(json, WebDeckValidationResult.class);
        assertFalse(round.errors().get(0).synthetic());
        assertTrue(round.errors().get(1).synthetic(),
                "the engine's overflow sentinel must round-trip synthetic=true");
    }
}
