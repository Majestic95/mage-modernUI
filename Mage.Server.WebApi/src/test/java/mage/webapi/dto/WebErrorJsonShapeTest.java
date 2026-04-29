package mage.webapi.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 72-A — pins the wire shape of {@link WebError} after the
 * {@code validationErrors} field add. The forward-compat contract is
 * that older 1.20 clients never see the new field on legacy paths,
 * even when the response goes through the same Jackson mapper.
 */
class WebErrorJsonShapeTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void legacyConstructor_leavesValidationErrorsNull() {
        WebError err = new WebError("1.21", "MISSING_TOKEN", "Auth required.");
        assertNull(err.validationErrors(),
                "3-arg constructor must default validationErrors=null — every "
                        + "existing call site relies on this");
    }

    @Test
    void nullValidationErrors_omittedFromWire() throws Exception {
        WebError err = new WebError("1.21", "MISSING_TOKEN", "Auth required.", null);
        String json = JSON.writeValueAsString(err);
        assertFalse(json.contains("validationErrors"),
                "Jackson NON_NULL must omit validationErrors when null — older "
                        + "1.20 clients see the same shape they always have. Got: " + json);
    }

    @Test
    void emptyListValidationErrors_isEmittedAsEmptyArray() throws Exception {
        // Empty list is a deliberate signal (validation ran, no errors)
        // distinct from null (validation didn't run / not the
        // DECK_INVALID path). NON_NULL only omits literal null.
        WebError err = new WebError("1.21", "DECK_INVALID", "Empty failure.", List.of());
        String json = JSON.writeValueAsString(err);
        assertTrue(json.contains("\"validationErrors\":[]"),
                "Empty list must serialize as []. Got: " + json);
    }

    @Test
    void nonEmptyValidationErrors_serializesWithEntries() throws Exception {
        List<WebDeckValidationError> errs = List.of(
                new WebDeckValidationError("BANNED", "Mana Crypt", "Banned",
                        "Mana Crypt", false, false),
                new WebDeckValidationError("DECK_SIZE", "Deck",
                        "Must contain at least 100 cards: has only 60 cards",
                        null, true, false)
        );
        WebError err = new WebError("1.21", "DECK_INVALID",
                "Deck failed validation for the Commander format.", errs);
        String json = JSON.writeValueAsString(err);

        WebError roundTrip = JSON.readValue(json, WebError.class);
        assertEquals("DECK_INVALID", roundTrip.code());
        assertEquals(2, roundTrip.validationErrors().size());
        assertEquals("BANNED", roundTrip.validationErrors().get(0).errorType());
        assertTrue(roundTrip.validationErrors().get(1).partlyLegal(),
                "DECK_SIZE round-trip must preserve partlyLegal=true");
        assertNull(roundTrip.validationErrors().get(1).cardName(),
                "global (non-card) errors must round-trip with cardName=null");
    }
}
