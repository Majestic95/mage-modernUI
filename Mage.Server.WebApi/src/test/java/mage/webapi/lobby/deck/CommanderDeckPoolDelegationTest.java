package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardLists;
import mage.webapi.embed.EmbeddedServer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Pins the remaining stub guarantee after Slice C (2026-05-07):
 * {@link CommanderDecksEasy} still delegates to {@link CommanderDecksHard}
 * because Slice C2 hasn't authored the Easy pool yet. Medium is now
 * a real divergent pool — its tests live in {@link mage.webapi.lobby.AiDeckLibraryTest}
 * (validator pin + Bracket-4 disallow-list + anthem ceiling).
 *
 * <p>Once Slice C2 lands, the {@code easyDelegatesToHard} test should
 * be deleted and replaced with Easy-pool tests in {@code AiDeckLibraryTest}
 * (mirroring the Medium pattern: validator pin + Easy-tier compliance
 * checks).
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
