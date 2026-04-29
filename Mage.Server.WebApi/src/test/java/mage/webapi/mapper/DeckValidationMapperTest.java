package mage.webapi.mapper;

import mage.cards.decks.DeckValidatorError;
import mage.cards.decks.DeckValidatorErrorType;
import mage.webapi.dto.WebDeckValidationError;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 72-A — pins the DeckValidatorError → WebDeckValidationError
 * translation. Pure unit test; no engine bootstrap required.
 */
class DeckValidationMapperTest {

    @Test
    void nullSource_returnsEmptyList() {
        List<WebDeckValidationError> out = DeckValidationMapper.toDtoList(null);
        assertSame(List.of(), out, "null source must collapse to the canonical empty list");
    }

    @Test
    void emptySource_returnsEmptyList() {
        List<WebDeckValidationError> out = DeckValidationMapper.toDtoList(List.of());
        assertSame(List.of(), out, "empty source must collapse to the canonical empty list");
    }

    @Test
    void mapsErrorTypeNameVerbatim() {
        // The wire contract is the upstream enum's name() — clients
        // switch on these strings. Renaming any of them is a major
        // schema bump.
        for (DeckValidatorErrorType type : DeckValidatorErrorType.values()) {
            DeckValidatorError src = new DeckValidatorError(type, "Group", "msg", null);
            WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(src)).get(0);
            assertEquals(type.name(), dto.errorType(),
                    "errorType wire value must equal the enum's name() — slice 72-A contract");
        }
    }

    @Test
    void preservesGroupMessageCardName() {
        DeckValidatorError src = new DeckValidatorError(
                DeckValidatorErrorType.BANNED, "Mana Crypt", "Banned", "Mana Crypt");
        WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(src)).get(0);
        assertEquals("Mana Crypt", dto.group());
        assertEquals("Banned", dto.message());
        assertEquals("Mana Crypt", dto.cardName());
    }

    @Test
    void cardNameStaysNullForGlobalErrors() {
        DeckValidatorError src = new DeckValidatorError(
                DeckValidatorErrorType.DECK_SIZE, "Deck",
                "Must contain at least 100 cards: has only 60 cards", null);
        WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(src)).get(0);
        assertNull(dto.cardName(),
                "global (non-card) errors must keep cardName null so the client knows "
                        + "this isn't a 'click-this-card' actionable entry");
    }

    @Test
    void deckSizeIsThePartlyLegalType() {
        // Today DECK_SIZE is the only partlyLegal type — denormalizing
        // the flag onto every entry means the webclient doesn't have
        // to maintain a parallel enum table. If upstream adds another
        // partlyLegal type later, this test stays green automatically;
        // the explicit DECK_SIZE assertion below is the canary.
        for (DeckValidatorErrorType type : DeckValidatorErrorType.values()) {
            DeckValidatorError src = new DeckValidatorError(type, "g", "m", null);
            WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(src)).get(0);
            assertEquals(type.isPartlyLegal(), dto.partlyLegal(),
                    "partlyLegal denormalization must match upstream for " + type);
        }
        DeckValidatorError deckSize = new DeckValidatorError(
                DeckValidatorErrorType.DECK_SIZE, "Deck", "size mismatch", null);
        assertTrue(DeckValidationMapper.toDtoList(List.of(deckSize)).get(0).partlyLegal(),
                "DECK_SIZE must serialize partlyLegal=true — that's the engine's "
                        + "'legal once finished' affordance contract");
        DeckValidatorError banned = new DeckValidatorError(
                DeckValidatorErrorType.BANNED, "Mana Crypt", "Banned", "Mana Crypt");
        assertFalse(DeckValidationMapper.toDtoList(List.of(banned)).get(0).partlyLegal(),
                "BANNED must serialize partlyLegal=false — banned cards never become "
                        + "legal by adding more cards to the deck");
    }

    @Test
    void mapsAllEntriesPreservingOrder() {
        // The mapper does not re-sort. Upstream's
        // DeckValidator.getErrorsListSorted(int) is the sort
        // authority; order from the input must be preserved.
        DeckValidatorError a = new DeckValidatorError(
                DeckValidatorErrorType.PRIMARY, "Commander", "missing", null);
        DeckValidatorError b = new DeckValidatorError(
                DeckValidatorErrorType.DECK_SIZE, "Deck", "wrong size", null);
        DeckValidatorError c = new DeckValidatorError(
                DeckValidatorErrorType.OTHER, "Sol Ring", "color identity", "Sol Ring");
        List<WebDeckValidationError> out = DeckValidationMapper.toDtoList(List.of(a, b, c));
        assertEquals(3, out.size());
        assertEquals("PRIMARY", out.get(0).errorType());
        assertEquals("DECK_SIZE", out.get(1).errorType());
        assertEquals("OTHER", out.get(2).errorType());
    }

    @Test
    void resultIsImmutable() {
        DeckValidatorError src = new DeckValidatorError(
                DeckValidatorErrorType.BANNED, "x", "y", "x");
        List<WebDeckValidationError> out = DeckValidationMapper.toDtoList(List.of(src));
        assertThrows(UnsupportedOperationException.class,
                () -> out.add(new WebDeckValidationError(
                        "OTHER", "g", "m", null, false, false)),
                "returned list must be immutable so callers can't mutate the wire payload");
    }

    @Test
    void overflowSentinel_marksSyntheticTrue() {
        // Upstream's DeckValidator.getErrorsListSorted(int) appends
        // {OTHER, "...", "and more N error[s]"} when capped. The
        // mapper detects group="..." and flips synthetic=true so
        // clients can render it as a non-clickable footer.
        DeckValidatorError sentinel = new DeckValidatorError(
                DeckValidatorErrorType.OTHER, "...", "and more 7 errors", null);
        WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(sentinel)).get(0);
        assertTrue(dto.synthetic(),
                "engine's overflow sentinel (group=\"...\") must serialize synthetic=true");
        assertEquals("OTHER", dto.errorType());
        assertNull(dto.cardName());
    }

    @Test
    void realOtherError_synthethicStaysFalse() {
        // A real OTHER error (e.g. color-identity violation) must
        // NOT be confused with the sentinel even though both share
        // errorType=OTHER.
        DeckValidatorError real = new DeckValidatorError(
                DeckValidatorErrorType.OTHER, "Lightning Bolt",
                "Color identity violation", "Lightning Bolt");
        WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(real)).get(0);
        assertFalse(dto.synthetic(),
                "real OTHER findings must serialize synthetic=false; only the "
                        + "group=\"...\" sentinel flips the flag");
    }

    @Test
    void nullGroup_doesNotMatchSyntheticMarker() {
        DeckValidatorError src = new DeckValidatorError(
                DeckValidatorErrorType.OTHER, null, "msg", null);
        WebDeckValidationError dto = DeckValidationMapper.toDtoList(List.of(src)).get(0);
        assertEquals("", dto.group(),
                "null group must coerce to empty string on the wire");
        assertFalse(dto.synthetic(),
                "empty string must not match the \"...\" synthetic marker");
    }
}
