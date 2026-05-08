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
 * Bracket 2-3 Commander pool — the production default after Slice C
 * (2026-05-07). Built from the spec at
 * {@code docs/decisions/ai-commander-rebalance-2026-05.md}.
 *
 * <p>Per the spec, each deck keeps the same shape as Hard (~36 lands /
 * ~8 ramp / ~6 draw / ~30 creatures / ~8 removal / ~9 utility) but
 * thins the synergy density: one global anthem max (Green excepted —
 * 2 anthems documented), no exponential snowball engines (Coat of
 * Arms / Cathars' Crusade / Anointed Procession / Necropolis Regent),
 * no board-locking finishers (Avacyn / Sheoldred / Stormtide /
 * Asceticism), no Bracket 4 game-enders (Craterhoof / Hellkite Charger
 * / Apex Devastator / Cyclonic Rift), no heavy draw engines (Mind's
 * Eye in 4-of-5 / Mystic Remora / double draw-on-attack), no free /
 * on-cast amplifiers (Purphoros / Hellrider / Lurking Predators).
 *
 * <p>AI-friendliness filter unchanged: no counterspells, no X-cost
 * spells, no modal "choose one", no tutors, no hybrid mana, no extra-
 * turn effects.
 *
 * <p>Sol Ring kept across all 5 decks — it's a precon staple and
 * explicitly excluded from the WotC Game Changers list.
 */
public final class CommanderDecksMedium implements CommanderDeckPool {

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
     * Mono-white humans/angels — Hard minus Hero of Bladehold + Avacyn,
     * minus 6 stacked anthems (Honor of the Pure, Spear of Heliod,
     * True Conviction, Marshal's Anthem, Cathars' Crusade, Anointed
     * Procession). Replacements skew vanilla-rate humans + flyers.
     * Net shape: 36 + 8 + 6 + 36 + 8 + 5 = 99.
     */
    public DeckCardLists buildWhite() {
        CardInfo plains = requireBasic("Plains");
        CardInfo commander = pickCommander("white",
                "Adeline, Resplendent Cathar",
                "Linden, the Steadfast Queen",
                "Sephara, Sky's Blade",
                "Heliod, God of the Sun");
        DeckCardLists deck = newDeck("AI Commander Deck (White, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Plains", plains, 36);
        // Ramp (8) — unchanged from Hard.
        addAll(cards, plains, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Marble Diamond",
                "Wayfarer's Bauble", "Burnished Hart", "Solemn Simulacrum",
                "Land Tax");
        // Card draw (6) — unchanged from Hard.
        addAll(cards, plains, 1,
                "Mentor of the Meek", "Mind's Eye", "Skullclamp",
                "Endless Atlas", "Tome of Legends", "Esper Sentinel");
        // Creatures (36) — Hard's 30 minus Hero of Bladehold + Avacyn,
        // plus 8 vanilla-rate adds.
        addAll(cards, plains, 1,
                "Soldier of the Pantheon", "Champion of the Parish",
                "Thalia's Lieutenant", "Mardu Woe-Reaper",
                "Imposing Sovereign", "Selfless Spirit", "Doomed Traveler",
                "Knight of the White Orchid", "Knight of Glory",
                "Adanto Vanguard", "Tithe Taker", "Thraben Inspector",
                "Mother of Runes", "Dauntless Bodyguard",
                "Brimaz, King of Oreskos",
                "Captain of the Watch", "Angel of Invention",
                "Restoration Angel", "Reveillark", "Banisher Priest",
                "Fiend Hunter", "Stoneforge Mystic", "Mirran Crusader",
                "Serra Angel", "Recruiter of the Guard",
                "Reya Dawnbringer",
                "Akroma, Angel of Wrath", "Sun Titan",
                "Dragon Hunter", "Trueheart Duelist",
                "Veteran Armorsmith", "Veteran Swordsmith",
                "Crusader of Odric", "Cloudgoat Ranger",
                "Serra Avenger", "Angel of Sanctions");
        // Removal (8) — unchanged from Hard.
        addAll(cards, plains, 1,
                "Path to Exile", "Swords to Plowshares", "Oblivion Ring",
                "Banishing Light", "Wrath of God", "Day of Judgment",
                "Disenchant", "Generous Gift");
        // Utility (5) — Hard's 11 minus 6 stacked-anthem cuts. Single
        // anthem (Glorious Anthem) preserved.
        addAll(cards, plains, 1,
                "Glorious Anthem", "Mobilization",
                "Sword of the Animist", "Heliod, Sun-Crowned",
                "Faith's Reward");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-blue Talrand spell-aggro — Hard minus Cyclonic Rift,
     * Treasure Cruise, Mind's Eye, Coastal Piracy, Mystic Remora,
     * Stormtide Leviathan, Inkwell Leviathan. Adds: Brainstorm, Snap,
     * Lay Claim, Mahamoti Djinn, Spire Owl, Air Elemental, Sphinx of
     * Magosi. Net shape: 36 + 8 + 15 + 16 + 17 + 7 = 99.
     */
    public DeckCardLists buildBlue() {
        CardInfo island = requireBasic("Island");
        CardInfo commander = pickCommander("blue",
                "Talrand, Sky Summoner",
                "Patron of the Moon",
                "Tetsuko Umezawa, Fugitive",
                "Empress Galina");
        DeckCardLists deck = newDeck("AI Commander Deck (Blue, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Island", island, 36);
        // Ramp (8) — unchanged.
        addAll(cards, island, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Sky Diamond",
                "Wayfarer's Bauble", "Sapphire Medallion", "Worn Powerstone",
                "Thran Dynamo");
        // Cantrips & draw (15) — Hard's 14 minus Treasure Cruise, plus
        // Brainstorm + Snap.
        addAll(cards, island, 1,
                "Ponder", "Preordain", "Telling Time", "Divination",
                "Compulsive Research", "Tidings", "Concentrate", "Foresee",
                "Opportunity", "Counsel of the Soratami", "Inspiration",
                "See Beyond", "Slip Through Space",
                "Brainstorm", "Snap");
        // Removal / bounce / wipes (16) — Hard's 16 minus Cyclonic Rift,
        // plus Lay Claim.
        addAll(cards, island, 1,
                "Pongify", "Rapid Hybridization", "Reality Shift",
                "Boomerang", "Echoing Truth", "Unsummon", "Vapor Snag",
                "Devastation Tide", "Engulf the Shore",
                "Whelming Wave", "Time Ebb", "Aether Tradewinds", "Sleep",
                "Talrand's Invocation", "Repulse",
                "Lay Claim");
        // Creatures (17) — Hard's 15 minus Stormtide + Inkwell, plus
        // Mahamoti Djinn, Spire Owl, Air Elemental, Sphinx of Magosi.
        addAll(cards, island, 1,
                "Snapcaster Mage", "Augur of Bolas", "Mulldrifter",
                "Sea Gate Oracle", "Cloudkin Seer", "Murmuring Mystic",
                "Aether Adept", "Frost Lynx", "Phantom Monster",
                "Aven Wind Mage", "Thieving Magpie", "Frost Titan",
                "Pearl Lake Ancient",
                "Mahamoti Djinn", "Spire Owl", "Air Elemental",
                "Sphinx of Magosi");
        // Utility (7) — Hard's 10 minus Mind's Eye, Mystic Remora,
        // Coastal Piracy.
        addAll(cards, island, 1,
                "Wonder", "Merfolk Looter", "Phantasmal Bear",
                "Murder of Crows", "Curiosity",
                "Bident of Thassa", "Sword of the Animist");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-black vampires — Hard minus Whip of Erebos, Sanguine Bond,
     * Vito, Necropolis Regent, Sheoldred, Captivating Vampire, Reaper.
     * Adds: 7 vanilla-rate vampire bodies. Net shape: 36 + 8 + 6 + 33
     * + 8 + 8 = 99.
     */
    public DeckCardLists buildBlack() {
        CardInfo swamp = requireBasic("Swamp");
        CardInfo commander = pickCommander("black",
                "Drana, Liberator of Malakir",
                "Mikaeus, the Unhallowed",
                "Ayara, First of Locthwain",
                "Skithiryx, the Blight Dragon");
        DeckCardLists deck = newDeck("AI Commander Deck (Black, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Swamp", swamp, 36);
        // Ramp (8) — unchanged.
        addAll(cards, swamp, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Charcoal Diamond",
                "Wayfarer's Bauble", "Jet Medallion", "Worn Powerstone",
                "Burnished Hart");
        // Card draw (6) — unchanged.
        addAll(cards, swamp, 1,
                "Phyrexian Arena", "Mind's Eye", "Skullclamp",
                "Endless Atlas", "Read the Bones", "Sign in Blood");
        // Creatures (33) — Hard's 30 minus Captivating Vampire,
        // Necropolis Regent, Reaper, Sheoldred, plus 7 vanilla vamps.
        addAll(cards, swamp, 1,
                "Vampire Lacerator", "Pulse Tracker",
                "Vampire of the Dire Moon", "Bloodghast",
                "Knight of the Ebon Legion", "Knight of Infamy",
                "Vampire Cutthroat", "Vampire Hexmage",
                "Bloodsoaked Champion", "Carnophage", "Vicious Conquistador",
                "Indulgent Aristocrat", "Vampire Aristocrat",
                "Gifted Aetherborn", "Vampire Nighthawk", "Bloodline Keeper",
                "Vampire Nocturnus",
                "Bloodlord of Vaasgoth", "Anowon, the Ruin Sage",
                "Patron of the Vein", "Sengir Vampire", "Bloodgift Demon",
                "Bloodthrone Vampire",
                "Massacre Wurm",
                "Ascendant Evincar",
                "Drana, Kalastria Bloodchief",
                "Markov Patrician", "Falkenrath Noble",
                "Bloodhunter Bat", "Vampire Outcasts",
                "Phyrexian Rager", "Dusk Legion Zealot",
                "Bloodrite Invoker");
        // Removal (8) — unchanged.
        addAll(cards, swamp, 1,
                "Doom Blade", "Go for the Throat", "Hero's Downfall",
                "Murder", "Damnation", "Languish", "Diabolic Edict",
                "Cast Down");
        // Utility (8) — Hard's 11 minus Whip / Sanguine Bond / Vito.
        // Single anthem (Bad Moon) preserved.
        addAll(cards, swamp, 1,
                "Bad Moon", "Phyrexian Reclamation",
                "Sword of the Animist", "Sword of Vengeance",
                "Twilight Prophet", "Kalitas, Traitor of Ghet",
                "Bontu's Monument", "Bloodtracker");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-red Krenko goblins/dragons — Hard minus Coat of Arms,
     * Purphoros, Hellrider, Hellkite Charger, Goblin Bombardment,
     * Hanweir Garrison, Krenko's Command, Goldspan Dragon, Outpost
     * Siege. Adds: Browbeat (draw replacement) + 8 vanilla goblins +
     * dragons. Net shape: 36 + 8 + 6 + 34 + 10 + 5 = 99 (slight
     * creature-heavy shift from Hard's 30+9 → 34+5).
     */
    public DeckCardLists buildRed() {
        CardInfo mountain = requireBasic("Mountain");
        CardInfo commander = pickCommander("red",
                "Krenko, Mob Boss",
                "Etali, Primal Storm",
                "Heartless Hidetsugu",
                "Squee, the Immortal");
        DeckCardLists deck = newDeck("AI Commander Deck (Red, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Mountain", mountain, 36);
        // Ramp (8) — unchanged.
        addAll(cards, mountain, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Fire Diamond",
                "Wayfarer's Bauble", "Ruby Medallion", "Worn Powerstone",
                "Generator Servant");
        // Card draw (6) — Hard's 6 minus Outpost Siege, plus Browbeat.
        addAll(cards, mountain, 1,
                "Mind's Eye", "Endless Atlas", "Tome of Legends",
                "Skullclamp", "Bag of Holding",
                "Browbeat");
        // Creatures (34) — Hard's 30 minus Hellrider, Hellkite Charger,
        // Hanweir Garrison, Goldspan Dragon, plus 8 vanilla bodies.
        addAll(cards, mountain, 1,
                "Mogg Fanatic", "Goblin Guide", "Monastery Swiftspear",
                "Goblin Piledriver", "Goblin Warchief", "Frenzied Goblin",
                "Vexing Devil", "Hellspark Elemental", "Goblin Bushwhacker",
                "Mogg War Marshal", "Reckless Bushwhacker",
                "Goblin Wardriver", "Goblin Lookout", "Goblin Chieftain",
                "Beetleback Chief",
                "Goblin Rabblemaster",
                "Goblin Chainwhirler", "Pyreheart Wolf", "Goblin Trashmaster",
                "Inferno Titan", "Krenko, Tin Street Kingpin",
                "Siege-Gang Commander",
                "Tuktuk the Explorer",
                "Drakuseth, Maw of Flames", "Stalking Vengeance",
                "Bogardan Hellkite",
                "Goblin Cohort", "Goblin Heelcutter",
                "Mogg Maniac", "Cinder Pyromancer",
                "Volcanic Dragon", "Shivan Dragon",
                "Furnace Whelp", "Inferno Hellion");
        // Removal (10) — unchanged from Hard.
        addAll(cards, mountain, 1,
                "Lightning Bolt", "Shock", "Lightning Strike", "Magma Spray",
                "Lava Spike", "Searing Blaze", "Pyroclasm",
                "Anger of the Gods", "Magma Jet", "Volcanic Hammer");
        // Utility (5) — Hard's 9 minus Coat of Arms, Goblin
        // Bombardment, Purphoros, Krenko's Command. Single anthem
        // (Goblin Chieftain in creatures) preserved.
        addAll(cards, mountain, 1,
                "Impact Tremors", "Dragon Tempest",
                "Sword of the Animist", "Chaos Warp",
                "Hammer of Purphoros");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    /**
     * Mono-green Yeva creature beats — Hard minus Craterhoof, Avenger
     * of Zendikar, Apex Devastator, Asceticism, Lurking Predators,
     * Overrun, Beastmaster Ascension, Hornet Queen, Terastodon. Adds:
     * 9 vanilla-rate creatures. Net shape: 36 + 10 + 6 + 34 + 8 + 5 =
     * 99. Two anthems retained (Garruk's Uprising + Nylea, God of the
     * Hunt) — Green's documented exception per spec.
     */
    public DeckCardLists buildGreen() {
        CardInfo forest = requireBasic("Forest");
        CardInfo commander = pickCommander("green",
                "Yeva, Nature's Herald",
                "Ezuri, Renegade Leader",
                "Omnath, Locus of Mana",
                "Ghalta, Primal Hunger");
        DeckCardLists deck = newDeck("AI Commander Deck (Green, Medium)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 36);
        // Ramp (10) — unchanged.
        addAll(cards, forest, 1,
                "Sol Ring", "Arcane Signet", "Llanowar Elves",
                "Elvish Mystic", "Fyndhorn Elves", "Sakura-Tribe Elder",
                "Wood Elves", "Cultivate", "Kodama's Reach",
                "Rampant Growth");
        // Card draw (6) — unchanged.
        addAll(cards, forest, 1,
                "Beast Whisperer", "Garruk's Packleader",
                "Soul of the Harvest", "Elemental Bond",
                "Lifecrafter's Bestiary", "Mind's Eye");
        // Creatures (34) — Hard's 30 minus Hornet Queen, Craterhoof,
        // Avenger of Zendikar, Terastodon, Apex Devastator, plus 9
        // vanilla-rate adds.
        addAll(cards, forest, 1,
                "Llanowar Visionary", "Elvish Visionary", "Wirewood Symbiote",
                "Werebear", "Reclamation Sage", "Yavimaya Elder",
                "Eternal Witness", "Wild Mongrel", "Centaur Courser",
                "Garruk's Companion", "Strangleroot Geist",
                "Steel Leaf Champion", "Briarhorn", "Karametra's Acolyte",
                "Thragtusk", "Acidic Slime", "Wickerbough Elder",
                "Plated Slagwurm", "Indrik Stomphowler", "Charging Rhino",
                "Spearbreaker Behemoth", "Engulfing Slagwurm",
                "Sentinel Spider",
                "Wolfir Silverheart",
                "Pelakka Wurm",
                "Yavimaya Wurm", "Vorapede", "Phantom Centaur",
                "Giant Spider", "Ravenous Baloth",
                "Stingerfling Spider", "Loaming Shaman",
                "Heart Warden", "Quirion Sentinel");
        // Removal (8) — unchanged.
        addAll(cards, forest, 1,
                "Beast Within", "Naturalize", "Krosan Grip", "Plummet",
                "Bramblecrush", "Hunt the Hunter", "Lignify",
                "Song of the Dryads");
        // Utility (5) — Hard's 9 minus Beastmaster Ascension,
        // Asceticism, Overrun, Lurking Predators. Two anthems retained
        // (Garruk's Uprising + Nylea, God of the Hunt — Green's
        // documented exception).
        addAll(cards, forest, 1,
                "Heroic Intervention",
                "Garruk's Uprising", "Nylea, God of the Hunt",
                "Sword of the Animist",
                "Veil of Summer");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }
}
