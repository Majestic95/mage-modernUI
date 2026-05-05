package mage.webapi.lobby;

import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.DeckValidator;
import mage.cards.decks.DeckValidatorError;
import mage.game.GameException;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.util.List;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins each AI Commander fallback deck against the upstream
 * {@code mage.deck.Commander} validator. Catches color-identity bugs,
 * banlist regressions, singleton violations, and 99+1 count drift
 * before they reach a live lobby — where validation failure cascades
 * into upstream destroying the whole table (see notes in
 * {@code LobbyService.addAi}).
 *
 * <p>The validator class lives in {@code mage-deck-constructed}, which
 * is a {@code runtime}-scope dep of {@code mage-server} — so it's on
 * the test runtime classpath but not the test compile classpath.
 * Reflection sidesteps the issue without dragging the dep into the
 * WebApi pom directly.
 *
 * <p>Boots a real embedded server so {@code CardRepository} is
 * populated. {@code @TestInstance(PER_CLASS)} is required for the
 * non-static {@code @BeforeAll}.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AiDeckLibraryTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";

    private final AiDeckLibrary library = new AiDeckLibrary();

    @BeforeAll
    void boot() {
        EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void white_passesCommanderValidator() {
        assertCommanderLegal("white", library::buildCommanderFallbackDeckWhite);
    }

    @Test
    void blue_passesCommanderValidator() {
        assertCommanderLegal("blue", library::buildCommanderFallbackDeckBlue);
    }

    @Test
    void black_passesCommanderValidator() {
        assertCommanderLegal("black", library::buildCommanderFallbackDeckBlack);
    }

    @Test
    void red_passesCommanderValidator() {
        assertCommanderLegal("red", library::buildCommanderFallbackDeckRed);
    }

    @Test
    void green_passesCommanderValidator() {
        assertCommanderLegal("green", library::buildCommanderFallbackDeckGreen);
    }

    /**
     * The non-Commander fallback deck has its own count contract — 60
     * cards mainboard, 0 sideboard. Doesn't need the Commander
     * validator; just pin the totals.
     */
    @Test
    void bearsDeck_isSixtyCards_zeroSideboard() {
        DeckCardLists deck = library.buildFallbackBasicLandsDeck();
        int main = deck.getCards().stream().mapToInt(c -> c.getAmount()).sum();
        int side = deck.getSideboard().stream().mapToInt(c -> c.getAmount()).sum();
        assertEquals(60, main, "Bears deck mainboard must total 60 cards.");
        assertEquals(0, side, "Bears deck has no sideboard.");
    }

    // ---- helpers --------------------------------------------------------

    /**
     * Build the deck via {@code builder}, load it through the upstream
     * {@link Deck#load} pipeline, and validate against a fresh
     * {@link Commander} validator. Failure fails the assertion with
     * the validator's full error list — same diagnostic shape the
     * {@code addAi} route logs in production.
     */
    private void assertCommanderLegal(String colorLabel, Supplier<DeckCardLists> builder) {
        DeckCardLists deckCards = builder.get();
        assertNotNull(deckCards, "Builder returned null for " + colorLabel);

        // Mainboard count: Commander mandates exactly 99 (or 100 for
        // partner — none here). Sideboard holds the 1 commander.
        int main = deckCards.getCards().stream().mapToInt(c -> c.getAmount()).sum();
        int side = deckCards.getSideboard().stream().mapToInt(c -> c.getAmount()).sum();
        assertEquals(99, main, colorLabel + " deck mainboard must total 99 cards.");
        assertEquals(1, side, colorLabel + " deck sideboard must hold exactly 1 commander.");

        Deck loaded;
        try {
            loaded = Deck.load(deckCards, false, false);
        } catch (GameException ex) {
            throw new AssertionError("Deck.load failed for " + colorLabel + ": "
                    + ex.getMessage(), ex);
        }

        DeckValidator validator = newCommanderValidator();
        boolean valid = validator.validate(loaded);
        if (!valid) {
            List<DeckValidatorError> errors = validator.getErrorsListSorted(50);
            StringBuilder sb = new StringBuilder("Commander validator rejected ")
                    .append(colorLabel).append(" deck (").append(errors.size())
                    .append(" errors):");
            for (DeckValidatorError e : errors) {
                sb.append("\n  - [").append(e.getErrorType()).append("] ")
                        .append("group='").append(e.getGroup()).append("' ")
                        .append("card='").append(e.getCardName()).append("': ")
                        .append(e.getMessage());
            }
            throw new AssertionError(sb.toString());
        }
        assertTrue(valid);
    }

    private static DeckValidator newCommanderValidator() {
        try {
            Class<?> cls = Class.forName("mage.deck.Commander");
            return (DeckValidator) cls.getDeclaredConstructor().newInstance();
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError(
                    "Could not instantiate mage.deck.Commander via reflection — "
                            + "is mage-deck-constructed on the test runtime classpath?",
                    ex);
        }
    }
}
