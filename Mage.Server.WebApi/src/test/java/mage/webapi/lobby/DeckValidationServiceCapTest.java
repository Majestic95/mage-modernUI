package mage.webapi.lobby;

import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.webapi.WebApiException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 72-A — pins the DoS-mitigation entry cap on the pre-flight
 * endpoint. The cap fires BEFORE the deck-load + validator pass so a
 * pathological client cannot pin a worker thread by repeatedly POSTing
 * a maximally-large payload.
 *
 * <p>Pure unit test — exercises the cap precondition, which runs
 * before any engine bootstrap is required. The unknown-deckType case
 * (which would require a populated factory) is covered separately.
 */
class DeckValidationServiceCapTest {

    @Test
    void overCap_throwsDeckTooLarge_413() {
        DeckValidationService svc = new DeckValidationService();
        DeckCardLists big = makeDeck(DeckValidationService.MAX_DECK_ENTRIES + 1, 0);

        WebApiException ex = assertThrows(WebApiException.class,
                () -> svc.validate("Constructed - Vintage", big));
        // 413 PAYLOAD TOO LARGE — distinct from 400 BAD_REQUEST. Lets
        // clients render a different "deck is too big" affordance vs.
        // generic parse / validation failures.
        assertEquals(413, ex.status(),
                "over-cap must return 413 PAYLOAD TOO LARGE, not 400 BAD_REQUEST");
        assertEquals("DECK_TOO_LARGE", ex.code());
        assertNotNull(ex.getMessage());
    }

    @Test
    void mainboardPlusSideboard_summedAgainstCap() {
        // The cap is on the COMBINED total — a deck that splits its
        // entries between cards and sideboard must still be rejected
        // when the sum exceeds the cap.
        DeckValidationService svc = new DeckValidationService();
        int half = (DeckValidationService.MAX_DECK_ENTRIES / 2) + 1;
        DeckCardLists split = makeDeck(half, half);

        WebApiException ex = assertThrows(WebApiException.class,
                () -> svc.validate("Constructed - Vintage", split));
        assertEquals(413, ex.status());
        assertEquals("DECK_TOO_LARGE", ex.code());
        assertTrue(ex.getMessage().contains(String.valueOf(half * 2)),
                "error message should report the actual total so the client can "
                        + "show the user how far over they are. Got: " + ex.getMessage());
    }

    @Test
    void capFiresBeforeFactoryLookup_evenForUnknownDeckType() {
        // Order matters: cap is cheap arithmetic and runs before the
        // factory lookup. When BOTH are wrong (deck oversized + bad
        // deckType), the cap wins so the user fixes deck size first.
        DeckValidationService svc = new DeckValidationService();
        DeckCardLists oversized = makeDeck(
                DeckValidationService.MAX_DECK_ENTRIES + 100, 0);

        WebApiException ex = assertThrows(WebApiException.class,
                () -> svc.validate("not a real format", oversized));
        assertEquals(413, ex.status(),
                "cap must fire before the factory lookup so user-fix priority is "
                        + "size-first, format-second");
        assertEquals("DECK_TOO_LARGE", ex.code());
    }

    @Test
    void underCapWithUnknownDeckType_returnsUnknownDeckType() {
        // Cap passes → factory lookup runs → unknown deckType → 400.
        // This is the "deck is fine but you picked a bad format" path.
        DeckValidationService svc = new DeckValidationService();
        DeckCardLists smallDeck = makeDeck(60, 0);

        WebApiException ex = assertThrows(WebApiException.class,
                () -> svc.validate("not a real format", smallDeck));
        assertEquals(400, ex.status());
        assertEquals("UNKNOWN_DECK_TYPE", ex.code());
    }

    private static DeckCardLists makeDeck(int mainCount, int sideCount) {
        DeckCardLists deck = new DeckCardLists();
        deck.setName("test");
        deck.setAuthor("test");
        deck.setCards(makeEntries(mainCount));
        deck.setSideboard(makeEntries(sideCount));
        return deck;
    }

    private static List<DeckCardInfo> makeEntries(int n) {
        List<DeckCardInfo> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            out.add(new DeckCardInfo("Forest", "1", "M21", 1));
        }
        return out;
    }
}
