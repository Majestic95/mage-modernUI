package mage.webapi.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Schema 1.33 (audit-fix M1) — pin the rolling-upgrade tolerance for
 * {@link WebDeckCardLists}. The displayCard field was added additively
 * in 1.33; a 1.32-old client that posts a deck without {@code displayCard}
 * MUST still deserialize cleanly with {@code displayCard=null}. The
 * route handler then passes {@code null} through to the registry,
 * which is a no-op set.
 *
 * <p>Without this test, a future Jackson upgrade (or a {@code @JsonCreator}
 * config drift on the records) could silently start rejecting old-client
 * payloads with 400 BAD_REQUEST on a body that's wire-valid by spec.
 */
class WebDeckCardListsJsonTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void deserializesOldClientPayload_missingDisplayCard_defaultsToNull() throws Exception {
        // Schema 1.32 wire shape — no displayCard key.
        String oldClientJson = """
                {
                  "name": "Kuldotha Red",
                  "author": "alice",
                  "cards": [
                    {"cardName": "Monastery Swiftspear", "setCode": "KTK",
                     "cardNumber": "118", "amount": 4}
                  ],
                  "sideboard": []
                }
                """;
        WebDeckCardLists deck = JSON.readValue(oldClientJson, WebDeckCardLists.class);
        assertEquals("Kuldotha Red", deck.name());
        assertEquals("alice", deck.author());
        assertEquals(1, deck.cards().size());
        assertEquals("Monastery Swiftspear", deck.cards().get(0).cardName());
        assertEquals(0, deck.sideboard().size());
        assertNull(deck.displayCard(),
                "Missing displayCard must default to null so 1.32 clients "
                        + "keep working against a 1.33 server.");
    }

    @Test
    void deserializesNewClientPayload_withDisplayCard_populatesField() throws Exception {
        String newClientJson = """
                {
                  "name": "Kuldotha Red",
                  "author": "alice",
                  "cards": [
                    {"cardName": "Monastery Swiftspear", "setCode": "KTK",
                     "cardNumber": "118", "amount": 4}
                  ],
                  "sideboard": [],
                  "displayCard": {
                    "cardName": "Monastery Swiftspear",
                    "setCode": "KTK",
                    "cardNumber": "118",
                    "amount": 4
                  }
                }
                """;
        WebDeckCardLists deck = JSON.readValue(newClientJson, WebDeckCardLists.class);
        assertEquals("Monastery Swiftspear", deck.displayCard().cardName());
        assertEquals("KTK", deck.displayCard().setCode());
        assertEquals("118", deck.displayCard().cardNumber());
    }

    @Test
    void deserializesPayload_withExplicitNullDisplayCard() throws Exception {
        // Some clients may send an explicit "displayCard": null rather
        // than omitting the key. Both shapes must produce null.
        String json = """
                {
                  "name": "Empty",
                  "author": "alice",
                  "cards": [],
                  "sideboard": [],
                  "displayCard": null
                }
                """;
        WebDeckCardLists deck = JSON.readValue(json, WebDeckCardLists.class);
        assertNull(deck.displayCard());
    }

    @Test
    void roundTrip_preservesDisplayCard() throws Exception {
        WebDeckCardLists original = new WebDeckCardLists(
                "Kuldotha Red", "alice",
                List.of(new WebDeckCardInfo("Monastery Swiftspear", "KTK", "118", 4)),
                List.of(),
                new WebDeckCardInfo("Monastery Swiftspear", "KTK", "118", 4));
        String json = JSON.writeValueAsString(original);
        WebDeckCardLists round = JSON.readValue(json, WebDeckCardLists.class);
        assertEquals(original.displayCard().cardName(), round.displayCard().cardName());
        assertEquals(original.displayCard().setCode(), round.displayCard().setCode());
        assertEquals(original.displayCard().cardNumber(), round.displayCard().cardNumber());
    }
}
