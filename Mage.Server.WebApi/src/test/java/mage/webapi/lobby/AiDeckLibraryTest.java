package mage.webapi.lobby;

import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.DeckValidator;
import mage.cards.decks.DeckValidatorError;
import mage.game.GameException;
import mage.webapi.embed.EmbeddedServer;
import mage.webapi.lobby.deck.BasicLandsFallback;
import mage.webapi.lobby.deck.CommanderDecksHard;
import mage.webapi.lobby.deck.CommanderDecksMedium;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import java.util.List;
import java.util.Set;

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

    private final CommanderDecksHard hard = new CommanderDecksHard();
    private final CommanderDecksMedium medium = new CommanderDecksMedium();

    @BeforeAll
    void boot() {
        EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void white_passesCommanderValidator() {
        DeckCardLists deck = hard.buildWhite();
        assertCommanderLegal("white", deck);
        assertNoSilentSubstitutions("white commander deck", deck, "Plains", 36);
    }

    @Test
    void blue_passesCommanderValidator() {
        DeckCardLists deck = hard.buildBlue();
        assertCommanderLegal("blue", deck);
        assertNoSilentSubstitutions("blue commander deck", deck, "Island", 36);
    }

    @Test
    void black_passesCommanderValidator() {
        DeckCardLists deck = hard.buildBlack();
        assertCommanderLegal("black", deck);
        assertNoSilentSubstitutions("black commander deck", deck, "Swamp", 36);
    }

    @Test
    void red_passesCommanderValidator() {
        DeckCardLists deck = hard.buildRed();
        assertCommanderLegal("red", deck);
        assertNoSilentSubstitutions("red commander deck", deck, "Mountain", 36);
    }

    @Test
    void green_passesCommanderValidator() {
        DeckCardLists deck = hard.buildGreen();
        assertCommanderLegal("green", deck);
        assertNoSilentSubstitutions("green commander deck", deck, "Forest", 36);
    }

    // ---- Medium pool (Bracket 2-3, the production default) -------------

    @Test
    void medium_white_passesCommanderValidator() {
        DeckCardLists deck = medium.buildWhite();
        assertCommanderLegal("white-medium", deck);
        assertNoSilentSubstitutions("white medium commander deck", deck, "Plains", 36);
    }

    @Test
    void medium_blue_passesCommanderValidator() {
        DeckCardLists deck = medium.buildBlue();
        assertCommanderLegal("blue-medium", deck);
        assertNoSilentSubstitutions("blue medium commander deck", deck, "Island", 36);
    }

    @Test
    void medium_black_passesCommanderValidator() {
        DeckCardLists deck = medium.buildBlack();
        assertCommanderLegal("black-medium", deck);
        assertNoSilentSubstitutions("black medium commander deck", deck, "Swamp", 36);
    }

    @Test
    void medium_red_passesCommanderValidator() {
        DeckCardLists deck = medium.buildRed();
        assertCommanderLegal("red-medium", deck);
        assertNoSilentSubstitutions("red medium commander deck", deck, "Mountain", 36);
    }

    @Test
    void medium_green_passesCommanderValidator() {
        DeckCardLists deck = medium.buildGreen();
        assertCommanderLegal("green-medium", deck);
        assertNoSilentSubstitutions("green medium commander deck", deck, "Forest", 36);
    }

    /**
     * Pins the spec's "no Bracket 4 game-ender / no exponential snowball
     * / no board-lock finisher" cuts across every Medium deck. If any
     * of these names ever reappears in CommanderDecksMedium, the bracket
     * promise to the user is broken and this fires.
     */
    @Test
    void medium_noBracket4DisallowListCardsAcrossAllDecks() {
        Set<String> disallowed = Set.of(
                // White stacked anthems / lock
                "Honor of the Pure", "Spear of Heliod", "True Conviction",
                "Marshal's Anthem", "Cathars' Crusade", "Anointed Procession",
                "Hero of Bladehold", "Avacyn, Angel of Hope",
                // Blue lock / overdraw / Game Changer (Mind's Eye is
                // intentionally NOT here — spec only cut it from Blue
                // Medium because Blue stacked it with Mystic Remora +
                // Bident + Coastal Piracy. Other decks keep it as a
                // single, slow draw source.)
                "Cyclonic Rift", "Treasure Cruise",
                "Coastal Piracy", "Mystic Remora",
                "Stormtide Leviathan", "Inkwell Leviathan",
                // Black combo / lock / steal-engine
                "Whip of Erebos", "Sanguine Bond",
                "Vito, Thorn of the Dusk Rose", "Necropolis Regent",
                "Sheoldred, Whispering One", "Captivating Vampire",
                "Reaper from the Abyss",
                // Red snowball amplifiers
                "Coat of Arms", "Purphoros, God of the Forge",
                "Hellrider", "Hellkite Charger", "Goblin Bombardment",
                "Hanweir Garrison", "Krenko's Command", "Goldspan Dragon",
                "Outpost Siege",
                // Green game-enders / lock
                "Craterhoof Behemoth", "Avenger of Zendikar",
                "Apex Devastator", "Asceticism", "Lurking Predators",
                "Overrun", "Beastmaster Ascension", "Hornet Queen",
                "Terastodon"
        );
        DeckCardLists[] mediumDecks = {
                medium.buildWhite(), medium.buildBlue(), medium.buildBlack(),
                medium.buildRed(), medium.buildGreen()
        };
        // White, Blue (no anthem), Black, Red, Green
        for (DeckCardLists deck : mediumDecks) {
            for (DeckCardInfo entry : deck.getCards()) {
                assertTrue(!disallowed.contains(entry.getCardName()),
                        "Medium deck '" + deck.getName() + "' contains "
                                + "Bracket-4 disallow-list card '" + entry.getCardName()
                                + "' — re-cut per "
                                + "docs/decisions/ai-commander-rebalance-2026-05.md");
            }
        }
    }

    /**
     * Pins the spec's anthem ceiling per Medium deck: 1 anthem max for
     * White/Blue/Black/Red; 2 for Green (documented exception — both
     * are static +1/+1 effects with secondary roles, not stacked
     * snowballs). Only "anthem" cards listed in {@code GLOBAL_ANTHEMS}
     * count — local anthems on individual creatures (Veteran Armorsmith
     * etc.) don't apply to the global ceiling.
     */
    @Test
    void medium_atMostNAnthemsPerDeck() {
        Set<String> globalAnthems = Set.of(
                // Whites
                "Glorious Anthem", "Honor of the Pure", "Spear of Heliod",
                "True Conviction", "Marshal's Anthem", "Cathars' Crusade",
                "Anointed Procession",
                // Black
                "Bad Moon",
                // Red (creature anthem; tribal but mono-red so not exempt)
                "Goblin Chieftain", "Coat of Arms",
                // Green
                "Garruk's Uprising", "Nylea, God of the Hunt",
                "Beastmaster Ascension"
        );
        assertAnthemCount("white-medium", medium.buildWhite(), globalAnthems, 1);
        assertAnthemCount("blue-medium", medium.buildBlue(), globalAnthems, 1);
        assertAnthemCount("black-medium", medium.buildBlack(), globalAnthems, 1);
        assertAnthemCount("red-medium", medium.buildRed(), globalAnthems, 1);
        // Green is the documented exception — see CommanderDecksMedium
        // javadoc + spec doc.
        assertAnthemCount("green-medium", medium.buildGreen(), globalAnthems, 2);
    }

    private static void assertAnthemCount(String label, DeckCardLists deck,
                                          Set<String> anthemAllowList, int max) {
        long count = deck.getCards().stream()
                .filter(c -> anthemAllowList.contains(c.getCardName()))
                .count();
        assertTrue(count <= max,
                label + " has " + count + " global anthem(s) — spec ceiling is "
                        + max + " for this color. Anthem cards are: "
                        + deck.getCards().stream()
                                .filter(c -> anthemAllowList.contains(c.getCardName()))
                                .map(DeckCardInfo::getCardName)
                                .toList());
    }

    // ---- Non-Commander fallback (60-card bears pile) -------------------

    /**
     * The non-Commander fallback deck has its own count contract — 60
     * cards mainboard, 0 sideboard. Doesn't need the Commander
     * validator; just pin the totals + zero-substitution.
     */
    @Test
    void bearsDeck_isSixtyCards_zeroSideboard_noSubstitutions() {
        DeckCardLists deck = BasicLandsFallback.buildBearsDeck();
        int main = deck.getCards().stream().mapToInt(c -> c.getAmount()).sum();
        int side = deck.getSideboard().stream().mapToInt(c -> c.getAmount()).sum();
        assertEquals(60, main, "Bears deck mainboard must total 60 cards.");
        assertEquals(0, side, "Bears deck has no sideboard.");
        assertNoSilentSubstitutions("bears deck", deck, "Forest", 24);
    }

    // ---- helpers --------------------------------------------------------

    /**
     * Build the deck via {@code builder}, load it through the upstream
     * {@link Deck#load} pipeline, and validate against a fresh
     * {@link Commander} validator. Failure fails the assertion with
     * the validator's full error list — same diagnostic shape the
     * {@code addAi} route logs in production.
     */
    private void assertCommanderLegal(String colorLabel, DeckCardLists deckCards) {
        assertNotNull(deckCards, "Builder returned null for " + colorLabel);

        // Mainboard count: Commander mandates exactly 99 (or 100 for
        // partner — none here). Sideboard holds the 1 commander.
        int main = deckCards.getCards().stream().mapToInt(c -> c.getAmount()).sum();
        int side = deckCards.getSideboard().stream().mapToInt(c -> c.getAmount()).sum();
        assertEquals(99, main, colorLabel + " deck mainboard must total 99 cards.");
        assertEquals(1, side, colorLabel + " deck sideboard must hold exactly 1 commander.");

        // Strict load: ignoreErrors=false + mockCards=false. Throws
        // GameException if any card name is unresolvable. Mock cards
        // are explicitly forbidden because the AI cannot play them
        // (per Deck.load javadoc warning at Deck.java:68).
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

    /**
     * Detect silent fallback substitutions. {@code addEntryOrFallback}
     * replaces a missing non-basic with the deck's basic land BEFORE
     * the deck is built, so {@code Deck.load} sees only valid cards
     * and never raises. The only signature of substitution is the
     * basic-land count being higher than what the deck spec
     * requested. Pin the expected count exactly — any excess basic
     * indicates {@code addEntryOrFallback} fell into its substitute
     * branch (visible in WARN logs as "missing from repository").
     *
     * <p>If this assertion ever fires, the deck has been silently
     * degraded — the AI is playing a flooded mana base instead of
     * the curve we designed. Fix by replacing the missing card with
     * one that exists in the local DB.
     */
    private static void assertNoSilentSubstitutions(String label, DeckCardLists deck,
                                                     String basicLandName,
                                                     int expectedBasicCount) {
        int actualBasicCount = deck.getCards().stream()
                .filter(c -> c.getCardName().equals(basicLandName))
                .mapToInt(c -> c.getAmount())
                .sum();
        assertEquals(expectedBasicCount, actualBasicCount,
                label + " has " + actualBasicCount + " " + basicLandName
                        + " — expected exactly " + expectedBasicCount + ". "
                        + "Excess basics indicate addEntryOrFallback silently "
                        + "substituted one or more missing non-basic cards. "
                        + "Check WARN logs above for "
                        + "'missing from repository — substituting' lines.");
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
