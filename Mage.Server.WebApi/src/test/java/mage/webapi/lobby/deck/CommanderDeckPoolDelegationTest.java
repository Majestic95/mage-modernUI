package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardLists;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Pins the Slice B stub guarantee: until Slice C / C2 author the per-
 * difficulty card lists, {@link CommanderDecksMedium} and
 * {@link CommanderDecksEasy} delegate to {@link CommanderDecksHard} so
 * the dispatcher returns a buildable deck for every (difficulty, color)
 * cell.
 *
 * <p>Once Slice C lands, the {@code mediumDelegatesToHard} test should
 * be replaced with a "Medium has at most one anthem per deck" check
 * (per the spec at {@code docs/decisions/ai-commander-rebalance-2026-05.md}).
 * Same for {@code easyDelegatesToHard} after Slice C2.
 *
 * <p>{@code @TestInstance(PER_CLASS)} required for the non-static
 * {@code @BeforeAll}; {@code EmbeddedServer.boot} populates the card
 * repository so the delegated builds resolve cards.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CommanderDeckPoolDelegationTest {

    private static final String CONFIG_PATH = "../Mage.Server/config/config.xml";
    private static final int ROTATION_LENGTH = 5;

    @BeforeAll
    void boot() {
        EmbeddedServer.boot(CONFIG_PATH);
    }

    @Test
    void mediumDelegatesToHard_forAllFiveColors() {
        CommanderDecksHard hard = new CommanderDecksHard();
        CommanderDecksMedium medium = new CommanderDecksMedium();
        for (int idx = 0; idx < ROTATION_LENGTH; idx++) {
            DeckCardLists hardDeck = hard.build(idx);
            DeckCardLists mediumDeck = medium.build(idx);
            assertNotNull(mediumDeck, "Medium build returned null at idx=" + idx);
            assertEquals(hardDeck.getName(), mediumDeck.getName(),
                    "Medium stub should mirror Hard's deck name at idx=" + idx
                            + " (delegation guarantee — Slice C will diverge this).");
            assertEquals(sumMain(hardDeck), sumMain(mediumDeck),
                    "Medium stub mainboard count should mirror Hard's at idx=" + idx);
        }
    }

    @Test
    void easyDelegatesToHard_forAllFiveColors() {
        CommanderDecksHard hard = new CommanderDecksHard();
        CommanderDecksEasy easy = new CommanderDecksEasy();
        for (int idx = 0; idx < ROTATION_LENGTH; idx++) {
            DeckCardLists hardDeck = hard.build(idx);
            DeckCardLists easyDeck = easy.build(idx);
            assertNotNull(easyDeck, "Easy build returned null at idx=" + idx);
            assertEquals(hardDeck.getName(), easyDeck.getName(),
                    "Easy stub should mirror Hard's deck name at idx=" + idx
                            + " (delegation guarantee — Slice C2 will diverge this).");
            assertEquals(sumMain(hardDeck), sumMain(easyDeck),
                    "Easy stub mainboard count should mirror Hard's at idx=" + idx);
        }
    }

    @Test
    void hard_buildsAtAllFiveColors() {
        CommanderDecksHard hard = new CommanderDecksHard();
        for (int idx = 0; idx < ROTATION_LENGTH; idx++) {
            DeckCardLists deck = hard.build(idx);
            assertNotNull(deck, "Hard build returned null at idx=" + idx);
            assertEquals(99, sumMain(deck),
                    "Hard mainboard at idx=" + idx + " must total 99 cards.");
            assertEquals(1, sumSide(deck),
                    "Hard sideboard at idx=" + idx + " must hold exactly 1 commander.");
        }
    }

    private static int sumMain(DeckCardLists deck) {
        return deck.getCards().stream().mapToInt(c -> c.getAmount()).sum();
    }

    private static int sumSide(DeckCardLists deck) {
        return deck.getSideboard().stream().mapToInt(c -> c.getAmount()).sum();
    }
}
