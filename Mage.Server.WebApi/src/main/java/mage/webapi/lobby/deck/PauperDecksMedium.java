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
 * Medium Pauper pool for AI seats: ten 60-card, zero-sideboard
 * creature decks selected by predictable rotation. The lists are kept
 * combat-forward and low-decision: no counterspells, no X-cost spells,
 * no modal "choose one" cards, no tutors, no extra turns, and no
 * cascade / suspend / foretell / madness / echo / dash alternate-cost
 * bait.
 *
 * <p>Two-color lists include at least four common dual lands and stay
 * creature-heavy so the current AI spends most decisions on attacking,
 * blocking, and simple removal.
 *
 * <p>Most archetypes carry a 4-slot spell package — AI-safe removal
 * (Lightning Bolt, Doom Blade, Disfigure, Journey to Nowhere, Pacifism,
 * Vapor Snag, Hunt the Weak) and / or raw card draw (Sign in Blood) —
 * to avoid the cardboard-flat feel of pure creature piles. Mono-Blue
 * Faeries is the only archetype left as a clean evasive aggro shell;
 * Pauper's blue toolkit is too counter-heavy to pull a clean spell
 * package from.
 */
public final class PauperDecksMedium implements PauperDeckPool {

    @Override
    public DeckCardLists build(int rotationIdx) {
        switch (rotationIdx) {
            case 0: return buildWhiteSoldiers();
            case 1: return buildBlueFaeries();
            case 2: return buildBlackVampires();
            case 3: return buildRedGoblins();
            case 4: return buildGreenStompy();
            case 5: return buildRedWhiteAggro();
            case 6: return buildWhiteBlueSkies();
            case 7: return buildBlackGreenBeats();
            case 8: return buildBlueBlackRogues();
            case 9: return buildRedGreenBears();
            default:
                throw new IllegalStateException("Unreachable rotationIdx: " + rotationIdx);
        }
    }

    public DeckCardLists buildWhiteSoldiers() {
        CardInfo plains = requireBasic("Plains");
        DeckCardLists deck = newDeck("AI Pauper Deck (White Soldiers, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Plains", plains, 24);
        addAll(cards, plains, 4,
                "Doomed Traveler", "Thraben Inspector", "Youthful Knight",
                "Veteran Armorsmith", "Veteran Swordsmith",
                "Soltari Trooper", "Kor Skyfisher", "Gideon's Lawkeeper");
        addAll(cards, plains, 2, "Journey to Nowhere", "Pacifism");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildBlueFaeries() {
        CardInfo island = requireBasic("Island");
        DeckCardLists deck = newDeck("AI Pauper Deck (Blue Faeries, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Island", island, 24);
        addAll(cards, island, 4,
                "Faerie Miscreant", "Cloud Sprite", "Spire Owl",
                "Wind Drake", "Phantom Monster", "Snapping Drake",
                "Cloud Elemental", "Frost Lynx", "Aven Fleetwing");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildBlackVampires() {
        CardInfo swamp = requireBasic("Swamp");
        DeckCardLists deck = newDeck("AI Pauper Deck (Black Vampires, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Swamp", swamp, 24);
        addAll(cards, swamp, 4,
                "Vampire Lacerator", "Pulse Tracker", "Blood Seeker",
                "Child of Night", "Vampire Spawn", "Markov Patrician",
                "Dusk Legion Zealot", "Vampire Aristocrat");
        addAll(cards, swamp, 2, "Disfigure", "Sign in Blood");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildRedGoblins() {
        CardInfo mountain = requireBasic("Mountain");
        DeckCardLists deck = newDeck("AI Pauper Deck (Red Goblins, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Mountain", mountain, 24);
        addAll(cards, mountain, 4,
                "Mogg Fanatic", "Goblin Cohort", "Frenzied Goblin",
                "Goblin Piker", "Goblin Roughrider", "Goblin Shortcutter",
                "Goblin Sky Raider", "Beetleback Chief", "Lightning Bolt");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildGreenStompy() {
        CardInfo forest = requireBasic("Forest");
        DeckCardLists deck = newDeck("AI Pauper Deck (Green Stompy, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 24);
        addAll(cards, forest, 4,
                "Llanowar Elves", "Quirion Ranger", "Werebear",
                "Garruk's Companion", "Centaur Courser", "Nessian Courser",
                "Yavimaya Wurm", "Hunt the Weak", "Sentinel Spider");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildRedWhiteAggro() {
        CardInfo plains = requireBasic("Plains");
        DeckCardLists deck = newDeck("AI Pauper Deck (RW Aggro, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Plains", plains, 10);
        addEntry(cards, "Mountain", requireBasic("Mountain"), 10);
        addAll(cards, plains, 4, "Boros Garrison");
        addAll(cards, plains, 2, "Wind-Scarred Crag");
        addAll(cards, plains, 4,
                "Thraben Inspector", "Soltari Trooper", "Veteran Armorsmith",
                "Mogg Fanatic", "Goblin Cohort", "Goblin Piker",
                "Goblin Roughrider", "Lightning Bolt");
        addAll(cards, plains, 2, "Beetleback Chief");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildWhiteBlueSkies() {
        CardInfo plains = requireBasic("Plains");
        DeckCardLists deck = newDeck("AI Pauper Deck (UW Skies, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Plains", plains, 10);
        addEntry(cards, "Island", requireBasic("Island"), 10);
        addAll(cards, plains, 4, "Tranquil Cove");
        addAll(cards, plains, 2, "Azorius Chancery");
        addAll(cards, plains, 4,
                "Suntail Hawk", "Kor Skyfisher", "Journey to Nowhere",
                "Faerie Miscreant", "Spire Owl", "Wind Drake",
                "Cloud Elemental", "Phantom Monster");
        addAll(cards, plains, 2, "Aven Fleetwing");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildBlackGreenBeats() {
        CardInfo swamp = requireBasic("Swamp");
        DeckCardLists deck = newDeck("AI Pauper Deck (BG Beats, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Swamp", swamp, 10);
        addEntry(cards, "Forest", requireBasic("Forest"), 10);
        addAll(cards, swamp, 4, "Golgari Rot Farm");
        addAll(cards, swamp, 2, "Jungle Hollow");
        addAll(cards, swamp, 4,
                "Pulse Tracker", "Child of Night", "Dusk Legion Zealot",
                "Llanowar Elves", "Werebear", "Garruk's Companion",
                "Nessian Courser");
        addAll(cards, swamp, 2, "Doom Blade", "Sign in Blood", "Craw Wurm");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildBlueBlackRogues() {
        CardInfo island = requireBasic("Island");
        DeckCardLists deck = newDeck("AI Pauper Deck (UB Rogues, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Island", island, 10);
        addEntry(cards, "Swamp", requireBasic("Swamp"), 10);
        addAll(cards, island, 4, "Dimir Aqueduct");
        addAll(cards, island, 2, "Dismal Backwater");
        addAll(cards, island, 4,
                "Faerie Miscreant", "Cloud Sprite", "Spire Owl",
                "Wind Drake", "Child of Night", "Pulse Tracker",
                "Dusk Legion Zealot");
        addAll(cards, island, 2, "Vapor Snag", "Sign in Blood", "Markov Patrician");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }

    public DeckCardLists buildRedGreenBears() {
        CardInfo mountain = requireBasic("Mountain");
        DeckCardLists deck = newDeck("AI Pauper Deck (RG Bears, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Mountain", mountain, 10);
        addEntry(cards, "Forest", requireBasic("Forest"), 10);
        addAll(cards, mountain, 4, "Gruul Turf");
        addAll(cards, mountain, 2, "Rugged Highlands");
        addAll(cards, mountain, 4,
                "Mogg Fanatic", "Goblin Cohort", "Goblin Roughrider",
                "Llanowar Elves", "Werebear",
                "Garruk's Companion", "Centaur Courser");
        addAll(cards, mountain, 2, "Lightning Bolt", "Hunt the Weak", "Nessian Courser");
        deck.setCards(cards);
        deck.setSideboard(new ArrayList<>());
        return deck;
    }
}
