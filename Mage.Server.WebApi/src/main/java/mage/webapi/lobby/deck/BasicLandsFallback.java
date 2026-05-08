package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;

import java.util.ArrayList;
import java.util.List;

import static mage.webapi.lobby.deck.AiDeckBuilderSupport.addAll;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.addEntry;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.newDeck;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.requireBasic;

/**
 * 60-card mono-green creature pile used for non-Commander tables when
 * no AI deck pool exists for that format yet. Slice 24 upgrade — was
 * a 60-Forest pile (no creatures, no combat). Now exercises the slice
 * -20 combat panel + slice-21 manual mana paths in live testing.
 *
 * <p>Returned regardless of {@code AiDifficulty} for formats without
 * their own pool. Pauper now has a dedicated pool; Standard remains a
 * future slice.
 */
public final class BasicLandsFallback {

    private BasicLandsFallback() {}

    public static DeckCardLists buildBearsDeck() {
        CardInfo forest = requireBasic("Forest");
        DeckCardLists deck = newDeck("AI Bears Deck");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 24);
        addAll(cards, forest, 4,
                "Llanowar Elves", "Grizzly Bears", "Centaur Courser",
                "Trained Armodon", "Spined Wurm", "Craw Wurm",
                "Yavimaya Wurm", "Plated Slagwurm", "Quirion Sentinel");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }
}
