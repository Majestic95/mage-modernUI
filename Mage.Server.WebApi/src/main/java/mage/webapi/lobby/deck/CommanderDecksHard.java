package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.repository.CardInfo;

import java.util.ArrayList;
import java.util.List;

import static mage.webapi.lobby.deck.AiDeckBuilderSupport.addAll;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.addEntry;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.attachCommander;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.newDeck;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.pickCommander;
import static mage.webapi.lobby.deck.AiDeckBuilderSupport.requireBasic;

/**
 * The original high-density Commander pool — Bracket 3-4 power level.
 * Each deck targets a realistic 99-card mainboard:
 * <ul>
 *   <li>~36 basic lands</li>
 *   <li>~8 ramp pieces</li>
 *   <li>~6 card-draw sources (single-trigger)</li>
 *   <li>~30 creatures across the curve</li>
 *   <li>~8 single-mode removal spells + 1-2 wipes</li>
 *   <li>~9 utility / anthem permanents</li>
 *   <li>+ 1 mono-color legendary commander in sideboard</li>
 * </ul>
 *
 * <p>Decks moved verbatim from {@code AiDeckLibrary} on 2026-05-07
 * during the Slice B difficulty-tier refactor. Card lists unchanged
 * — Slice C populates {@link CommanderDecksMedium} with rebalanced
 * Bracket 2-3 versions, and Slice C2 populates {@link CommanderDecksEasy}
 * with Bracket 1 vanilla piles.
 *
 * <p><b>AI-friendliness filter:</b> no counterspells, no X-cost spells,
 * no modal "choose one", no tutors, no hybrid mana, no extra-turn.
 */
public final class CommanderDecksHard implements CommanderDeckPool {

    @Override
    public DeckCardLists build(int rotationIdx) {
        switch (rotationIdx) {
            case 0: return buildWhite();
            case 1: return buildBlue();
            case 2: return buildBlack();
            case 3: return buildRed();
            case 4: return buildGreen();
            default:
                throw new IllegalStateException("Unreachable rotationIdx: " + rotationIdx);
        }
    }

    /**
     * Mono-white humans-aggro deck. Commander candidate ladder picks
     * the first match in the local DB so the deck builds even if a
     * single printing is missing.
     */
    public DeckCardLists buildWhite() {
        CardInfo plains = requireBasic("Plains");
        // Fallback candidates picked to NOT also appear in this deck's
        // mainboard list — duplicating commander + mainboard would be
        // a singleton-validator failure under Commander rules.
        CardInfo commander = pickCommander("white",
                "Adeline, Resplendent Cathar",
                "Linden, the Steadfast Queen",
                "Sephara, Sky's Blade",
                "Heliod, God of the Sun");
        DeckCardLists deck = newDeck("AI Commander Deck (White)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Plains", plains, 36);
        // Ramp (8) — colorless rocks + creature ramp + Land Tax.
        addAll(cards, plains, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Marble Diamond",
                "Wayfarer's Bauble", "Burnished Hart", "Solemn Simulacrum",
                "Land Tax");
        // Card draw (6) — single-trigger sources only.
        addAll(cards, plains, 1,
                "Mentor of the Meek", "Mind's Eye", "Skullclamp",
                "Endless Atlas", "Tome of Legends", "Esper Sentinel");
        // Creatures (30) — humans + angels across the curve.
        addAll(cards, plains, 1,
                "Soldier of the Pantheon", "Champion of the Parish",
                "Thalia's Lieutenant", "Mardu Woe-Reaper",
                "Imposing Sovereign", "Selfless Spirit", "Doomed Traveler",
                "Knight of the White Orchid", "Knight of Glory",
                "Adanto Vanguard", "Tithe Taker", "Thraben Inspector",
                "Mother of Runes", "Dauntless Bodyguard",
                "Brimaz, King of Oreskos", "Hero of Bladehold",
                "Captain of the Watch", "Angel of Invention",
                "Restoration Angel", "Reveillark", "Banisher Priest",
                "Fiend Hunter", "Stoneforge Mystic", "Mirran Crusader",
                "Serra Angel", "Recruiter of the Guard",
                "Avacyn, Angel of Hope", "Reya Dawnbringer",
                "Akroma, Angel of Wrath", "Sun Titan");
        // Removal (8) — single-mode kill spells + wipes.
        addAll(cards, plains, 1,
                "Path to Exile", "Swords to Plowshares", "Oblivion Ring",
                "Banishing Light", "Wrath of God", "Day of Judgment",
                "Disenchant", "Generous Gift");
        // Utility / anthems (11).
        addAll(cards, plains, 1,
                "Glorious Anthem", "Honor of the Pure", "True Conviction",
                "Spear of Heliod", "Mobilization", "Marshal's Anthem",
                "Sword of the Animist", "Heliod, Sun-Crowned",
                "Anointed Procession", "Faith's Reward",
                "Cathars' Crusade");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-blue Talrand spell-aggro deck. Each instant/sorcery turns
     * Talrand into a 2/2 flying drake — so the deck is ~30 spells +
     * 15 bodies rather than the typical ~30 creatures. Avoids blue's
     * AI-hostile counter-magic identity by leaning on cantrips,
     * single-mode bounce/removal, and big finishers.
     */
    public DeckCardLists buildBlue() {
        CardInfo island = requireBasic("Island");
        CardInfo commander = pickCommander("blue",
                "Talrand, Sky Summoner",
                "Patron of the Moon",
                "Tetsuko Umezawa, Fugitive",
                "Empress Galina");
        DeckCardLists deck = newDeck("AI Commander Deck (Blue)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Island", island, 36);
        // Ramp (8) — all colorless artifacts (legal under any commander).
        addAll(cards, island, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Sky Diamond",
                "Wayfarer's Bauble", "Sapphire Medallion", "Worn Powerstone",
                "Thran Dynamo");
        // Spells (30) — every one becomes a Drake under Talrand.
        // Cantrips & draw spells.
        addAll(cards, island, 1,
                "Ponder", "Preordain", "Telling Time", "Divination",
                "Compulsive Research", "Tidings", "Concentrate", "Foresee",
                "Opportunity", "Counsel of the Soratami", "Inspiration",
                "See Beyond", "Treasure Cruise", "Slip Through Space");
        // Removal / bounce / wipes — single-mode only.
        addAll(cards, island, 1,
                "Pongify", "Rapid Hybridization", "Reality Shift",
                "Boomerang", "Echoing Truth", "Unsummon", "Vapor Snag",
                "Cyclonic Rift", "Devastation Tide", "Engulf the Shore",
                "Whelming Wave", "Time Ebb", "Aether Tradewinds", "Sleep",
                "Talrand's Invocation", "Repulse");
        // Creatures (15) — flyers + ETB-draw bodies + leviathan finishers.
        addAll(cards, island, 1,
                "Snapcaster Mage", "Augur of Bolas", "Mulldrifter",
                "Sea Gate Oracle", "Cloudkin Seer", "Murmuring Mystic",
                "Aether Adept", "Frost Lynx", "Phantom Monster",
                "Aven Wind Mage", "Thieving Magpie", "Frost Titan",
                "Pearl Lake Ancient", "Inkwell Leviathan",
                "Stormtide Leviathan");
        // Utility (10) — draw enchantments + pump for the drake army.
        // Merfolk Looter (mono-blue) replaces the original "Looter il-Kor"
        // pick — that card has hybrid {U/B} cost so its color identity
        // is U+B, illegal under a mono-blue commander.
        addAll(cards, island, 1,
                "Wonder", "Merfolk Looter", "Phantasmal Bear",
                "Murder of Crows", "Curiosity", "Mystic Remora",
                "Mind's Eye", "Bident of Thassa", "Coastal Piracy",
                "Sword of the Animist");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-black vampire-aggro deck. Drana pumps the attacking team —
     * tribal anthem-on-attack maps cleanly to MAD's combat eval.
     */
    public DeckCardLists buildBlack() {
        CardInfo swamp = requireBasic("Swamp");
        CardInfo commander = pickCommander("black",
                "Drana, Liberator of Malakir",
                "Mikaeus, the Unhallowed",
                "Ayara, First of Locthwain",
                "Skithiryx, the Blight Dragon");
        DeckCardLists deck = newDeck("AI Commander Deck (Black)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Swamp", swamp, 36);
        // Ramp (8) — rocks + creature ramp.
        addAll(cards, swamp, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Charcoal Diamond",
                "Wayfarer's Bauble", "Jet Medallion", "Worn Powerstone",
                "Burnished Hart");
        // Card draw (6) — Phyrexian Arena + life-payment draw.
        addAll(cards, swamp, 1,
                "Phyrexian Arena", "Mind's Eye", "Skullclamp",
                "Endless Atlas", "Read the Bones", "Sign in Blood");
        // Creatures (30) — vampires across the curve.
        addAll(cards, swamp, 1,
                "Vampire Lacerator", "Pulse Tracker",
                "Vampire of the Dire Moon", "Bloodghast",
                "Knight of the Ebon Legion", "Knight of Infamy",
                "Vampire Cutthroat", "Vampire Hexmage",
                "Bloodsoaked Champion", "Carnophage", "Vicious Conquistador",
                "Indulgent Aristocrat", "Vampire Aristocrat",
                "Gifted Aetherborn", "Vampire Nighthawk", "Bloodline Keeper",
                "Captivating Vampire", "Vampire Nocturnus",
                "Bloodlord of Vaasgoth", "Anowon, the Ruin Sage",
                "Patron of the Vein", "Sengir Vampire", "Bloodgift Demon",
                "Necropolis Regent", "Bloodthrone Vampire",
                "Massacre Wurm", "Reaper from the Abyss",
                "Sheoldred, Whispering One", "Ascendant Evincar",
                "Drana, Kalastria Bloodchief");
        // Removal (8) — single-mode kill spells + wipes.
        addAll(cards, swamp, 1,
                "Doom Blade", "Go for the Throat", "Hero's Downfall",
                "Murder", "Damnation", "Languish", "Diabolic Edict",
                "Cast Down");
        // Utility (11) — anthems + recursion + lifegain payoffs.
        addAll(cards, swamp, 1,
                "Bad Moon", "Phyrexian Reclamation", "Whip of Erebos",
                "Sword of the Animist", "Sword of Vengeance",
                "Sanguine Bond", "Vito, Thorn of the Dusk Rose",
                "Twilight Prophet", "Kalitas, Traitor of Ghet",
                "Bontu's Monument", "Bloodtracker");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-red goblin-and-burn aggro. Commander candidates remain
     * goblin-tribal-friendly so Coat of Arms / Goblin Chieftain's
     * tribal payoffs still hit.
     */
    public DeckCardLists buildRed() {
        CardInfo mountain = requireBasic("Mountain");
        // Krenko, Tin Street Kingpin lives in this deck's mainboard
        // creature list, so it can't double as a fallback commander
        // candidate (singleton-validator failure). Squee, the Immortal
        // is the swap-in.
        CardInfo commander = pickCommander("red",
                "Krenko, Mob Boss",
                "Etali, Primal Storm",
                "Heartless Hidetsugu",
                "Squee, the Immortal");
        DeckCardLists deck = newDeck("AI Commander Deck (Red)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Mountain", mountain, 36);
        // Ramp (8) — rocks + Generator Servant.
        addAll(cards, mountain, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Fire Diamond",
                "Wayfarer's Bauble", "Ruby Medallion", "Worn Powerstone",
                "Generator Servant");
        // Card draw (6) — artifact draw + Outpost Siege.
        addAll(cards, mountain, 1,
                "Mind's Eye", "Endless Atlas", "Tome of Legends",
                "Skullclamp", "Outpost Siege", "Bag of Holding");
        // Creatures (30) — goblins + dragons.
        addAll(cards, mountain, 1,
                "Mogg Fanatic", "Goblin Guide", "Monastery Swiftspear",
                "Goblin Piledriver", "Goblin Warchief", "Frenzied Goblin",
                "Vexing Devil", "Hellspark Elemental", "Goblin Bushwhacker",
                "Mogg War Marshal", "Reckless Bushwhacker",
                "Goblin Wardriver", "Goblin Lookout", "Goblin Chieftain",
                "Beetleback Chief", "Hellrider", "Goblin Rabblemaster",
                "Goblin Chainwhirler", "Pyreheart Wolf", "Goblin Trashmaster",
                "Inferno Titan", "Krenko, Tin Street Kingpin",
                "Hanweir Garrison", "Siege-Gang Commander",
                "Tuktuk the Explorer", "Hellkite Charger", "Goldspan Dragon",
                "Drakuseth, Maw of Flames", "Stalking Vengeance",
                "Bogardan Hellkite");
        // Removal (10) — burn spells doubling as creature + face damage.
        addAll(cards, mountain, 1,
                "Lightning Bolt", "Shock", "Lightning Strike", "Magma Spray",
                "Lava Spike", "Searing Blaze", "Pyroclasm",
                "Anger of the Gods", "Magma Jet", "Volcanic Hammer");
        // Utility (9) — tribal anthems + ETB-damage payoffs.
        addAll(cards, mountain, 1,
                "Coat of Arms", "Goblin Bombardment", "Impact Tremors",
                "Purphoros, God of the Forge", "Krenko's Command",
                "Dragon Tempest", "Sword of the Animist", "Chaos Warp",
                "Hammer of Purphoros");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-green creature-and-ramp deck. Replaces the prior 60-Forest
     * mana-flood shape (~99 lands net of singletons) with a realistic
     * ~36-land curve.
     */
    public DeckCardLists buildGreen() {
        CardInfo forest = requireBasic("Forest");
        CardInfo commander = pickCommander("green",
                "Yeva, Nature's Herald",
                "Ezuri, Renegade Leader",
                "Omnath, Locus of Mana",
                "Ghalta, Primal Hunger");
        DeckCardLists deck = newDeck("AI Commander Deck (Green)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 36);
        // Ramp (10) — green's strength; mana dorks + basic-tutors.
        addAll(cards, forest, 1,
                "Sol Ring", "Arcane Signet", "Llanowar Elves",
                "Elvish Mystic", "Fyndhorn Elves", "Sakura-Tribe Elder",
                "Wood Elves", "Cultivate", "Kodama's Reach",
                "Rampant Growth");
        // Card draw (6) — creature-ETB triggers.
        addAll(cards, forest, 1,
                "Beast Whisperer", "Garruk's Packleader",
                "Soul of the Harvest", "Elemental Bond",
                "Lifecrafter's Bestiary", "Mind's Eye");
        // Creatures (30) — singleton elves + beats across the curve.
        addAll(cards, forest, 1,
                "Llanowar Visionary", "Elvish Visionary", "Wirewood Symbiote",
                "Werebear", "Reclamation Sage", "Yavimaya Elder",
                "Eternal Witness", "Wild Mongrel", "Centaur Courser",
                "Garruk's Companion", "Strangleroot Geist",
                "Steel Leaf Champion", "Briarhorn", "Karametra's Acolyte",
                "Thragtusk", "Acidic Slime", "Wickerbough Elder",
                "Plated Slagwurm", "Indrik Stomphowler", "Charging Rhino",
                "Spearbreaker Behemoth", "Engulfing Slagwurm",
                "Sentinel Spider", "Hornet Queen", "Wolfir Silverheart",
                "Craterhoof Behemoth", "Avenger of Zendikar", "Pelakka Wurm",
                "Terastodon", "Apex Devastator");
        // Removal (8) — naturalize + creature removal that fits green.
        addAll(cards, forest, 1,
                "Beast Within", "Naturalize", "Krosan Grip", "Plummet",
                "Bramblecrush", "Hunt the Hunter", "Lignify",
                "Song of the Dryads");
        // Utility (9) — global anthems + protection.
        addAll(cards, forest, 1,
                "Heroic Intervention", "Beastmaster Ascension", "Asceticism",
                "Garruk's Uprising", "Nylea, God of the Hunt", "Overrun",
                "Sword of the Animist", "Lurking Predators",
                "Veil of Summer");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }
}
