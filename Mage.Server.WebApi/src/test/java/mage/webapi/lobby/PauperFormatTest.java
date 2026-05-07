package mage.webapi.lobby;

import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.DeckValidator;
import mage.cards.repository.CardScanner;
import mage.cards.repository.RepositoryUtil;
import mage.game.GameException;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the upstream {@code mage.deck.Pauper} validator against the
 * WebApi module's runtime classpath. The validator class lives in
 * {@code mage-deck-constructed}, which is a {@code runtime}-scope
 * transitive of {@code mage-server} — present on the test runtime
 * classpath but not the compile classpath. Reflection sidesteps the
 * scope mismatch (mirrors the {@code AiDeckLibraryTest} pattern), so
 * adding {@code mage-deck-constructed} to our pom is unnecessary.
 *
 * <p>Tests cover the three Pauper-specific validator behaviours that
 * sit on top of stock {@code Constructed} (banlist, common-rarity-only,
 * 60-card minimum), plus a positive case to prove the validator does
 * accept a legal deck. Without {@code CardScanner.scan()} the rarity
 * walk in {@code Constructed.legalRarity} would short-circuit on every
 * card with an "unknown card" error and the Pauper-specific behaviour
 * would never get exercised — bootstrap is therefore load-bearing.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PauperFormatTest {

    @BeforeAll
    static void bootstrap() {
        // CardRepository must be populated for legalRarity / legalSets
        // to walk printings. Both calls are idempotent across the
        // surefire JVM, so back-to-back test classes don't re-pay the
        // cost.
        RepositoryUtil.bootstrapLocalDb();
        CardScanner.scan();
    }

    @Test
    void pauperValidator_acceptsLegalCommonsDeck() {
        // Lightning Bolt M11 #149 is COMMON; Counterspell 6ED #61 is
        // COMMON (the more recent 4ED #65 printing is uncommon — pick
        // a printing that's actually common-rare so the rarity walk
        // returns true on the first hit).
        DeckCardLists list = makeDeck(
                entry("Lightning Bolt", "149", "M11", 4),
                entry("Counterspell", "61", "6ED", 4),
                entry("Mountain", "271", "M21", 52)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertTrue(valid,
                "expected legal Pauper deck to validate. errors: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void pauperValidator_rejectsBannedCard() {
        // Treasure Cruise sits on the Pauper banlist (Pauper.java:60).
        // The card itself is printed common (KTK #59), so the failure
        // reason is the banlist — not the rarity check.
        DeckCardLists list = makeDeck(
                entry("Treasure Cruise", "59", "KTK", 4),
                entry("Island", "265", "M21", 56)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertFalse(valid, "Treasure Cruise must be rejected by Pauper banlist");
        String errors = validator.getErrorsListInfo().toLowerCase(Locale.ROOT);
        assertTrue(errors.contains("treasure cruise"),
                "expected error mentioning 'Treasure Cruise', got: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void pauperValidator_rejectsNeverCommonCard() {
        // Force of Will has never been printed common — Alliances
        // original is uncommon (ALL #28). The legalRarity walk in
        // Constructed inspects every printing in CardRepository; if
        // none is common, validation must fail with an "Invalid rarity"
        // error grouped under the card name.
        DeckCardLists list = makeDeck(
                entry("Force of Will", "28", "ALL", 4),
                entry("Island", "265", "M21", 56)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertFalse(valid, "Force of Will must be rejected — never printed common");
        String errors = validator.getErrorsListInfo().toLowerCase(Locale.ROOT);
        assertTrue(errors.contains("force of will"),
                "expected error mentioning 'Force of Will', got: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void pauperValidator_acceptsBasicLandOnlyDeck() {
        // Simplest possible positive case: 60 basics, no spells. Immune
        // to upstream rarity-flag drift on any specific printing — if
        // this baseline ever fires red, the regression is in the
        // validator's basic-land handling or the bootstrap, not in the
        // fixture choices for the spells-included test above.
        DeckCardLists list = makeDeck(
                entry("Mountain", "271", "M21", 60)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertTrue(valid,
                "60-Mountain deck must validate. errors: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void pauperValidator_acceptsCardViaLaterCommonPrinting() {
        // Pins the "ever-common-anywhere" rule: Counterspell 4ED #65 is
        // UNCOMMON, but a later printing (6ED #61) is COMMON. The
        // validator's legalRarity walks CardRepository.findCards(name)
        // across ALL printings, so the 4ED printing should still
        // validate. If the walk ever short-circuits on the printing
        // identifier in the deck list (or on the first printing scanned),
        // this test catches it — the legal-deck test above wouldn't,
        // because it points at the 6ED common directly.
        DeckCardLists list = makeDeck(
                entry("Counterspell", "65", "4ED", 4),
                entry("Island", "265", "M21", 56)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertTrue(valid,
                "Counterspell at 4ED (uncommon) must validate via the 6ED "
                        + "common printing. errors: " + validator.getErrorsListInfo());
    }

    @Test
    void pauperValidator_rejectsOverFourCopies() {
        // Constructed.checkCounts caps non-basics at 4 copies. A
        // 5-Lightning-Bolt deck must fail with a count error grouped
        // under the card name, distinct from banlist / rarity errors.
        DeckCardLists list = makeDeck(
                entry("Lightning Bolt", "149", "M11", 5),
                entry("Mountain", "271", "M21", 55)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertFalse(valid, "5x Lightning Bolt must fail the 4-of cap");
        String errors = validator.getErrorsListInfo().toLowerCase(Locale.ROOT);
        assertTrue(errors.contains("lightning bolt"),
                "expected error grouped under 'Lightning Bolt', got: "
                        + validator.getErrorsListInfo());
    }

    @Test
    void pauperValidator_rejectsUndersizedDeck() {
        // Constructed.validate emits exactly:
        //   "Must contain at least 60 cards: has only N cards"
        // (Constructed.java:221). Asserting the literal "60" pins the
        // Constructed minimum without coupling to the surrounding
        // wording.
        DeckCardLists list = makeDeck(
                entry("Mountain", "271", "M21", 30)
        );

        DeckValidator validator = newPauperValidator();
        Deck deck = loadOrFail(list);

        boolean valid = validator.validate(deck);
        assertFalse(valid, "30-card deck must fail the 60-card minimum");
        String errors = validator.getErrorsListInfo();
        assertTrue(errors.contains("60"),
                "expected error mentioning the 60-card minimum, got: " + errors);
    }

    // ---------------------------------------------------------------
    // Fixture builders
    // ---------------------------------------------------------------

    private static DeckCardInfo entry(String name, String number, String setCode, int count) {
        return new DeckCardInfo(name, number, setCode, count);
    }

    private static DeckCardLists makeDeck(DeckCardInfo... entries) {
        DeckCardLists deck = new DeckCardLists();
        deck.setName("PauperFormatTest");
        deck.setAuthor("PauperFormatTest");
        List<DeckCardInfo> cards = new ArrayList<>(entries.length);
        for (DeckCardInfo entry : entries) {
            cards.add(entry);
        }
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    private static Deck loadOrFail(DeckCardLists list) {
        // Strict load: ignoreErrors=false + mockCards=false. Matches
        // AiDeckLibraryTest's pattern. If a printing identifier above
        // is wrong, GameException fires here with a helpful message
        // before the validator ever sees the deck.
        try {
            return Deck.load(list, false, false);
        } catch (GameException ex) {
            throw new AssertionError(
                    "Deck.load failed — printing identifier mismatch? " + ex.getMessage(),
                    ex);
        }
    }

    private static DeckValidator newPauperValidator() {
        // Reflection because mage-deck-constructed is runtime-scope
        // only on this module. Same shape as AiDeckLibraryTest's
        // newCommanderValidator(): a clear AssertionError points at
        // the classpath if the dep is ever lost.
        try {
            Class<?> cls = Class.forName("mage.deck.Pauper");
            Object instance = cls.getDeclaredConstructor().newInstance();
            assertNotNull(instance, "Pauper validator was null after construction");
            return (DeckValidator) instance;
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError(
                    "Could not instantiate mage.deck.Pauper via reflection — "
                            + "is mage-deck-constructed on the test runtime classpath?",
                    ex);
        }
    }
}
