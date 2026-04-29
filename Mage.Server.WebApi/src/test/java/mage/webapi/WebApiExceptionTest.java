package mage.webapi;

import mage.webapi.dto.WebDeckValidationError;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Slice 72-A — pins the {@link WebApiException} contract after the
 * validationErrors field add. The legacy 3-arg constructor must keep
 * its old semantics (validationErrors=null) so every existing call
 * site stays binary-compatible with the change.
 */
class WebApiExceptionTest {

    @Test
    void legacyConstructor_leavesValidationErrorsNull() {
        WebApiException ex = new WebApiException(401, "MISSING_TOKEN", "Auth required.");
        assertEquals(401, ex.status());
        assertEquals("MISSING_TOKEN", ex.code());
        assertEquals("Auth required.", ex.getMessage());
        assertNull(ex.validationErrors(),
                "3-arg constructor must default to null — existing call sites "
                        + "(MISSING_TOKEN, UPSTREAM_REJECTED, NOT_OWNER, etc.) rely on this");
    }

    @Test
    void fourArgConstructor_attachesValidationPayload() {
        List<WebDeckValidationError> errs = List.of(
                new WebDeckValidationError("BANNED", "Mana Crypt", "Banned",
                        "Mana Crypt", false, false));
        WebApiException ex = new WebApiException(422, "DECK_INVALID",
                "Deck failed validation.", errs);
        assertEquals(422, ex.status());
        assertEquals("DECK_INVALID", ex.code());
        assertEquals(1, ex.validationErrors().size());
        assertEquals("BANNED", ex.validationErrors().get(0).errorType());
    }

    @Test
    void validationErrorsAreDefensivelyCopied() {
        // The exception travels through the Javalin handler chain and
        // gets serialized to JSON. Caller-mutating the original list
        // must not change what's already on the wire.
        List<WebDeckValidationError> mutable = new ArrayList<>();
        mutable.add(new WebDeckValidationError("BANNED", "Sol Ring", "Banned",
                "Sol Ring", false, false));
        WebApiException ex = new WebApiException(422, "DECK_INVALID", "x", mutable);
        mutable.clear();
        assertEquals(1, ex.validationErrors().size(),
                "mutating the source list after throw must not retroactively change "
                        + "what the exception holds");
        assertNotSame(mutable, ex.validationErrors(),
                "stored reference must not be the caller-owned list");
    }

    @Test
    void validationErrorsListIsImmutable() {
        WebApiException ex = new WebApiException(422, "DECK_INVALID", "x", List.of(
                new WebDeckValidationError("BANNED", "x", "y", "x", false, false)));
        assertThrows(UnsupportedOperationException.class,
                () -> ex.validationErrors().add(
                        new WebDeckValidationError("OTHER", "g", "m", null, false, false)),
                "exposed list must be immutable so handlers can't mutate the wire payload");
    }

    @Test
    void nullValidationErrors_passThroughViaFourArgCtor() {
        WebApiException ex = new WebApiException(422, "UPSTREAM_REJECTED", "msg", null);
        assertNull(ex.validationErrors(),
                "explicit null in 4-arg constructor must round-trip as null, "
                        + "not coerce to empty list (NON_NULL omits vs. emits empty array — "
                        + "they're different wire shapes)");
    }
}
