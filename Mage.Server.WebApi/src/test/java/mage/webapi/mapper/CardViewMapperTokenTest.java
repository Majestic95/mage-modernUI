package mage.webapi.mapper;

import mage.view.CardView;
import mage.webapi.dto.stream.WebCardView;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins the token-cardNumber translation in
 * {@link CardViewMapper#resolveWireCardNumber}.
 *
 * <p><b>Why this test exists:</b> upstream {@link CardView} hardcodes
 * {@code cardNumber = "0"} for tokens (see {@code CardView.java:1037,
 * 1102}) and stores the real Scryfall-side identifier in the
 * {@code int imageNumber} field instead. The webclient builds Scryfall
 * image URLs from {@code expansionSetCode + cardNumber} via
 * {@code webclient/src/game/scryfall.ts}. Without this translation,
 * every token URL is {@code /cards/<set>/0} which Scryfall 404s on,
 * so token cards render as blank rectangles. Reported by user
 * 2026-05-07 ("Token cards need artwork").
 *
 * <p>The mapper now substitutes {@code String.valueOf(cv.getImageNumber())}
 * for the wire {@code cardNumber} when {@code cv.isToken()} is true.
 * This test pins that contract end-to-end through the mapper.
 *
 * <p>Style mirrors {@link CardViewMapperCardIdTest} — empty CardView
 * + reflection for protected fields ({@code isToken}, {@code imageNumber}
 * are both protected per CardView.java:94, 98).
 */
class CardViewMapperTokenTest {

    private static final UUID ID =
            UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    @Test
    void tokenCardView_wireCardNumber_takesImageNumber() {
        CardView cv = newEmptyCard(ID);
        setProtected(cv, "isToken", true);
        setProtected(cv, "imageNumber", 11);
        // Upstream sentinel — the literal "0" hardcoded in CardView.java:1037
        // for the token construction path. The mapper must NOT pass this
        // through verbatim; it must substitute imageNumber-as-string.
        setProtected(cv, "cardNumber", "0");
        setProtected(cv, "expansionSetCode", "TAFR");

        WebCardView dto = CardViewMapper.toCardDto(cv);

        assertEquals("11", dto.cardNumber(),
                "token wire cardNumber must be String.valueOf(imageNumber); "
                        + "without this substitution the client builds "
                        + "/cards/tafr/0 which Scryfall 404s and tokens render "
                        + "as blank rectangles");
        assertEquals("TAFR", dto.expansionSetCode(),
                "expansionSetCode is unaffected by the token translation");
    }

    @Test
    void nonTokenCardView_wireCardNumber_unchanged() {
        CardView cv = newEmptyCard(ID);
        setProtected(cv, "isToken", false);
        setProtected(cv, "cardNumber", "161");
        setProtected(cv, "imageNumber", 7);
        setProtected(cv, "expansionSetCode", "LEA");

        WebCardView dto = CardViewMapper.toCardDto(cv);

        assertEquals("161", dto.cardNumber(),
                "non-token cardNumber must pass through verbatim; the "
                        + "token translation must NOT leak into the regular "
                        + "card path (would corrupt every Scryfall URL)");
    }

    @Test
    void tokenCardView_zeroImageNumber_stillEmitsZero_noRegression() {
        // Upstream gap: some token-construction paths leave imageNumber
        // at its default of 0 (CardView.java:98). The wire still emits
        // "0" in that case — same as today's broken state, no
        // regression. Documenting the boundary so a future "fix" that
        // tries to special-case imageNumber=0 doesn't break the
        // contract this test pins.
        CardView cv = newEmptyCard(ID);
        setProtected(cv, "isToken", true);
        setProtected(cv, "imageNumber", 0);
        setProtected(cv, "cardNumber", "0");

        WebCardView dto = CardViewMapper.toCardDto(cv);

        assertEquals("0", dto.cardNumber(),
                "tokens with imageNumber=0 still emit '0' (engine-side "
                        + "gap, not a mapper bug); fixing those requires "
                        + "populating imageNumber in the token's Java "
                        + "constructor upstream");
    }

    private static CardView newEmptyCard(UUID id) {
        CardView cv = new CardView(true);
        cv.overrideId(id);
        return cv;
    }

    /**
     * Reflection helper for the protected CardView fields the
     * convenience constructors don't expose. Walks the class hierarchy
     * because {@code cardNumber} + {@code expansionSetCode} live on
     * {@code SimpleCardView} (parent) while {@code isToken} +
     * {@code imageNumber} live on {@code CardView} (child).
     */
    private static void setProtected(CardView cv, String fieldName, Object value) {
        Class<?> c = cv.getClass();
        while (c != null) {
            try {
                Field f = c.getDeclaredField(fieldName);
                f.setAccessible(true);
                f.set(cv, value);
                return;
            } catch (NoSuchFieldException ignored) {
                c = c.getSuperclass();
            } catch (IllegalAccessException ex) {
                throw new AssertionError(
                        "Test setup: cannot set " + fieldName, ex);
            }
        }
        throw new AssertionError(
                "Test setup: field " + fieldName + " not found on CardView "
                        + "or its parents; if upstream renamed it, update "
                        + "this helper");
    }
}
