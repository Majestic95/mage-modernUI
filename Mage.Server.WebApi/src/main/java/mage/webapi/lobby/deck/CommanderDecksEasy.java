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
 * Bracket 1 Commander pool — battlecruiser EDH. The weakest tier.
 * Each deck is a vanilla creature beatdown pile with no global anthems,
 * no triggered-on-cast engines, no recursion loops, no equipment with
 * activated abilities, and no tutors. Sol Ring kept for simplicity (it's
 * a precon staple even at Bracket 1; the user accepted "optionally drop"
 * and the simpler answer is to keep it). Mind's Eye / Skullclamp /
 * Esper Sentinel / Bident / Sword-of-* all CUT compared to Medium.
 *
 * <p>Authored 2026-05-07 as Slice C2 of the AI difficulty work.
 * Inline spec (no separate doc — small enough): start from Medium pool,
 * cut every remaining anthem (Glorious Anthem, Bad Moon, Goblin
 * Chieftain, Garruk's Uprising, Nylea God of the Hunt) and every
 * remaining engine card (Skullclamp, Mind's Eye, Esper Sentinel, Sword
 * of the Animist, Sword of Vengeance, Bident of Thassa, Hammer of
 * Purphoros, Whip of Erebos*, etc.), replace with vanilla creature
 * bodies and single-target removal auras (Pacifism / Faith's Fetters /
 * Lignify / etc.). Same 99-mainboard + 1-commander shape preserved.
 *
 * <p>(* — these were already cut in Medium but listed for completeness)
 *
 * <p>AI-friendliness filter unchanged: no counterspells, no X-cost
 * spells, no modal "choose one", no tutors, no hybrid mana, no extra-
 * turn effects. (Strictest tier — also no triggered-engine cards.)
 *
 * <p>Net result: 5 decks that play out as "creatures attack each other
 * for 30 turns" with no snowball lines. The user can still lose to a
 * 4-AI lobby of these decks if their own deck is bad — but it should
 * never feel oppressive.
 */
public final class CommanderDecksEasy implements CommanderDeckPool {

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

    public DeckCardLists buildWhite() {
        CardInfo plains = requireBasic("Plains");
        CardInfo commander = pickCommander("white",
                "Adeline, Resplendent Cathar",
                "Linden, the Steadfast Queen",
                "Sephara, Sky's Blade",
                "Heliod, God of the Sun");
        DeckCardLists deck = newDeck("AI Commander Deck (White, Easy)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Plains", plains, 36);
        // Ramp (8) — same as Hard/Medium.
        addAll(cards, plains, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Marble Diamond",
                "Wayfarer's Bauble", "Burnished Hart", "Solemn Simulacrum",
                "Land Tax");
        // Card draw (4) — slow vanilla artifacts only. No
        // Skullclamp / Mind's Eye / Mentor / Esper Sentinel.
        addAll(cards, plains, 1,
                "Endless Atlas", "Tome of Legends", "Howling Mine",
                "Bag of Holding");
        // Creatures (38) — vanilla soldiers + angels. No Mother of
        // Runes / Stoneforge / Recruiter / Reveillark / Sun Titan /
        // Reya / Brimaz / Captain of the Watch (anthem) / Angel of
        // Invention (modal) / Veteran Armor/Swordsmith (tribal anthem)
        // / Crusader of Odric (X/X scaling) / Champion of Parish
        // (counter engine) / Thalia's Lieutenant (counter engine) /
        // Selfless Spirit / Knight of the White Orchid (basic tutor).
        addAll(cards, plains, 1,
                "Soldier of the Pantheon", "Mardu Woe-Reaper",
                "Imposing Sovereign", "Doomed Traveler",
                "Knight of Glory", "Adanto Vanguard", "Tithe Taker",
                "Thraben Inspector", "Dauntless Bodyguard",
                "Banisher Priest", "Fiend Hunter", "Restoration Angel",
                "Mirran Crusader", "Serra Angel", "Akroma, Angel of Wrath",
                "Dragon Hunter", "Trueheart Duelist",
                "Cloudgoat Ranger", "Serra Avenger", "Angel of Sanctions",
                "Suntail Hawk", "Squire", "Daring Skyjek",
                "Charging Paladin", "Stalwart Aven", "Wall of Reverence",
                "Pearled Unicorn", "Veteran Cavalier", "Aven Cloudchaser",
                "Soltari Foot Soldier", "Aerial Responder", "Felidar Cub",
                "Ghostly Sentinel", "Steadfast Cathar", "Eager Cadet",
                "Loyal Sentry", "Armored Pegasus", "Soulcatcher");
        // Removal (8) — same as Medium.
        addAll(cards, plains, 1,
                "Path to Exile", "Swords to Plowshares", "Oblivion Ring",
                "Banishing Light", "Wrath of God", "Day of Judgment",
                "Disenchant", "Generous Gift");
        // Utility (5) — vanilla single-target auras (no anthems, no
        // engines). Pacifism + Faith's Fetters + Arrest + Bonds of
        // Faith + Ghostly Prison.
        addAll(cards, plains, 1,
                "Pacifism", "Faith's Fetters", "Arrest",
                "Bonds of Faith", "Ghostly Prison");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    public DeckCardLists buildBlue() {
        CardInfo island = requireBasic("Island");
        CardInfo commander = pickCommander("blue",
                "Talrand, Sky Summoner",
                "Patron of the Moon",
                "Tetsuko Umezawa, Fugitive",
                "Empress Galina");
        DeckCardLists deck = newDeck("AI Commander Deck (Blue, Easy)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Island", island, 36);
        // Ramp (8) — same as Hard/Medium.
        addAll(cards, island, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Sky Diamond",
                "Wayfarer's Bauble", "Sapphire Medallion", "Worn Powerstone",
                "Thran Dynamo");
        // Cantrips & draw (10) — fewer than Medium (15). No Snap (free
        // drake fuel — too efficient), no Brainstorm, no Slip Through
        // Space. Just slow card-draw spells.
        addAll(cards, island, 1,
                "Divination", "Compulsive Research", "Tidings",
                "Concentrate", "Foresee", "Opportunity",
                "Counsel of the Soratami", "Inspiration", "See Beyond",
                "Telling Time");
        // Removal / bounce (12) — fewer than Medium (16). No Cyclonic
        // Rift / Lay Claim / Talrand's Invocation (token engine).
        addAll(cards, island, 1,
                "Pongify", "Rapid Hybridization", "Reality Shift",
                "Boomerang", "Echoing Truth", "Unsummon", "Vapor Snag",
                "Devastation Tide", "Engulf the Shore",
                "Time Ebb", "Aether Tradewinds", "Repulse");
        // Creatures (23) — vanilla flyers. No Snapcaster, no Mulldrifter
        // (engine), no Murmuring Mystic (token engine), no Pearl Lake
        // Ancient (uncounterable lock). Augur of Bolas (single ETB
        // top-3 filter) acceptable for Easy.
        addAll(cards, island, 1,
                "Phantom Monster", "Aven Wind Mage",
                "Cloudkin Seer", "Sea Gate Oracle", "Aether Adept",
                "Frost Lynx", "Frost Titan", "Mahamoti Djinn",
                "Spire Owl", "Air Elemental", "Sphinx of Magosi",
                "Welkin Tern", "Wind Drake", "Cloud Elemental",
                "Phantom Warrior",
                "Storm Crow", "Coral Eel", "Sage Owl",
                "Snapping Drake", "Wind Spirit", "Cloud Sprite",
                "Phantasmal Dragon", "Augur of Bolas");
        // Utility (10) — vanilla auras + slow draw enchantments + walls.
        // No Wonder (engine), no Merfolk Looter (engine), no Mystic
        // Remora (overdraw), no Bident (draw engine), no Coastal
        // Piracy (draw engine), no Sword of the Animist (ramp engine).
        addAll(cards, island, 1,
                "Claustrophobia", "Flight of Fancy", "Spectral Flight",
                "Encrust", "Curiosity", "Phantasmal Bear",
                "Wall of Air", "Ice Cage",
                "Imprisoned in the Moon", "Dehydration");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    public DeckCardLists buildBlack() {
        CardInfo swamp = requireBasic("Swamp");
        CardInfo commander = pickCommander("black",
                "Drana, Liberator of Malakir",
                "Mikaeus, the Unhallowed",
                "Ayara, First of Locthwain",
                "Skithiryx, the Blight Dragon");
        DeckCardLists deck = newDeck("AI Commander Deck (Black, Easy)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Swamp", swamp, 36);
        // Ramp (8) — same as Hard/Medium.
        addAll(cards, swamp, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Charcoal Diamond",
                "Wayfarer's Bauble", "Jet Medallion", "Worn Powerstone",
                "Burnished Hart");
        // Card draw (4) — no Phyrexian Arena (engine), no Skullclamp
        // (engine), no Mind's Eye. Slow vanilla draw only.
        addAll(cards, swamp, 1,
                "Read the Bones", "Sign in Blood",
                "Endless Atlas", "Howling Mine");
        // Creatures (38) — vanilla vampires. No Bloodline Keeper
        // (token engine), no Vampire Nocturnus (top-deck anthem), no
        // Bloodthrone Vampire (sac engine), no Twilight Prophet (drain
        // engine), no Bloodgift Demon (draw engine).
        addAll(cards, swamp, 1,
                "Vampire Lacerator", "Pulse Tracker",
                "Vampire of the Dire Moon", "Bloodghast",
                "Knight of the Ebon Legion", "Knight of Infamy",
                "Vampire Cutthroat", "Vampire Hexmage",
                "Bloodsoaked Champion", "Carnophage", "Vicious Conquistador",
                "Indulgent Aristocrat", "Vampire Aristocrat",
                "Gifted Aetherborn", "Vampire Nighthawk",
                "Bloodlord of Vaasgoth", "Anowon, the Ruin Sage",
                "Patron of the Vein", "Sengir Vampire",
                "Massacre Wurm", "Ascendant Evincar",
                "Drana, Kalastria Bloodchief",
                "Markov Patrician", "Falkenrath Noble",
                "Bloodhunter Bat", "Vampire Outcasts",
                "Phyrexian Rager", "Dusk Legion Zealot",
                "Bloodrite Invoker",
                "Drainpipe Vermin", "Skinrender",
                "Vampire Interloper", "Walking Corpse",
                "Bog Wraith", "Drudge Skeletons",
                "Carrier Thrall", "Highborn Ghoul", "Erg Raiders");
        // Removal (8) — same as Medium.
        addAll(cards, swamp, 1,
                "Doom Blade", "Go for the Throat", "Hero's Downfall",
                "Murder", "Damnation", "Languish", "Diabolic Edict",
                "Cast Down");
        // Utility (5) — no Bad Moon (anthem), no Phyrexian Reclamation
        // (recursion engine), no Sword of Vengeance (engine), no
        // Kalitas (engine), no Bontu's Monument (cost-reduction engine),
        // no Bloodtracker (engine).
        addAll(cards, swamp, 1,
                "Stab Wound", "Weakness", "Dead Weight",
                "Quag Vampires", "Unhallowed Pact");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    public DeckCardLists buildRed() {
        CardInfo mountain = requireBasic("Mountain");
        CardInfo commander = pickCommander("red",
                "Krenko, Mob Boss",
                "Etali, Primal Storm",
                "Heartless Hidetsugu",
                "Squee, the Immortal");
        DeckCardLists deck = newDeck("AI Commander Deck (Red, Easy)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Mountain", mountain, 36);
        // Ramp (8) — same as Hard/Medium.
        addAll(cards, mountain, 1,
                "Sol Ring", "Arcane Signet", "Mind Stone", "Fire Diamond",
                "Wayfarer's Bauble", "Ruby Medallion", "Worn Powerstone",
                "Generator Servant");
        // Card draw (4) — no Skullclamp / Mind's Eye / Tome of Legends.
        // Just vanilla artifact draw.
        addAll(cards, mountain, 1,
                "Endless Atlas", "Howling Mine", "Bag of Holding",
                "Browbeat");
        // Creatures (38) — vanilla goblins + dragons. No Krenko Tin
        // Street (2nd engine), no Goblin Chieftain (anthem), no
        // Goblin Warchief (cost-reduction anthem), no Goblin
        // Rabblemaster (token engine), no Goblin Chainwhirler (1-tough
        // wipe), no Siege-Gang (3-token engine + sac), no Goblin
        // Trashmaster (token engine + sac).
        addAll(cards, mountain, 1,
                "Mogg Fanatic", "Goblin Guide", "Monastery Swiftspear",
                "Goblin Piledriver", "Frenzied Goblin",
                "Vexing Devil", "Hellspark Elemental", "Goblin Bushwhacker",
                "Mogg War Marshal", "Reckless Bushwhacker",
                "Goblin Wardriver", "Goblin Lookout",
                "Beetleback Chief",
                "Pyreheart Wolf",
                "Inferno Titan",
                "Tuktuk the Explorer",
                "Drakuseth, Maw of Flames", "Stalking Vengeance",
                "Bogardan Hellkite",
                "Goblin Cohort", "Goblin Heelcutter",
                "Mogg Maniac", "Cinder Pyromancer",
                "Volcanic Dragon", "Shivan Dragon",
                "Furnace Whelp", "Inferno Hellion",
                "Mons's Goblin Raiders", "Raging Goblin",
                "Goblin Roughrider", "Goblin Brigand",
                "Earth Elemental", "Hill Giant",
                "Mountain Yeti", "Stone Giant",
                "Anaba Bodyguard", "Two-Headed Giant of Foriys",
                "Avalanche Riders",
                "Goblin Sky Raider");
        // Removal (11) — Medium's 10 plus Lava Axe (5R sorcery, 5
        // damage to player — vanilla burn finisher, fits Easy).
        addAll(cards, mountain, 1,
                "Lightning Bolt", "Shock", "Lightning Strike", "Magma Spray",
                "Lava Spike", "Searing Blaze", "Pyroclasm",
                "Anger of the Gods", "Magma Jet", "Volcanic Hammer",
                "Lava Axe");
        // Utility (1) — no Impact Tremors (engine), no Dragon Tempest
        // (engine), no Sword of the Animist (engine), no Hammer of
        // Purphoros (token engine + haste anthem). Just Chaos Warp as
        // catch-all removal.
        addAll(cards, mountain, 1,
                "Chaos Warp");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }

    public DeckCardLists buildGreen() {
        CardInfo forest = requireBasic("Forest");
        CardInfo commander = pickCommander("green",
                "Yeva, Nature's Herald",
                "Ezuri, Renegade Leader",
                "Omnath, Locus of Mana",
                "Ghalta, Primal Hunger");
        DeckCardLists deck = newDeck("AI Commander Deck (Green, Easy)");
        List<DeckCardInfo> cards = new ArrayList<>();
        addEntry(cards, "Forest", forest, 36);
        // Ramp (10) — same as Hard/Medium.
        addAll(cards, forest, 1,
                "Sol Ring", "Arcane Signet", "Llanowar Elves",
                "Elvish Mystic", "Fyndhorn Elves", "Sakura-Tribe Elder",
                "Wood Elves", "Cultivate", "Kodama's Reach",
                "Rampant Growth");
        // Card draw (4) — no Beast Whisperer / Garruk's Packleader /
        // Soul of the Harvest / Elemental Bond / Lifecrafter's
        // Bestiary / Mind's Eye (all engine-flavored creature-ETB-draw
        // sources).
        addAll(cards, forest, 1,
                "Endless Atlas", "Howling Mine", "Bag of Holding",
                "Hunter's Insight");
        // Creatures (32) — vanilla beats. No Llanowar Visionary (ETB
        // engine), no Reclamation Sage (engine — sac for enchant
        // removal), no Eternal Witness (recursion engine), no Werebear
        // (threshold engine), no Wirewood Symbiote (untap engine), no
        // Yavimaya Elder (sac engine), no Karametra's Acolyte
        // (devotion-X mana engine).
        addAll(cards, forest, 1,
                "Elvish Visionary",
                "Wild Mongrel", "Centaur Courser",
                "Garruk's Companion", "Strangleroot Geist",
                "Steel Leaf Champion", "Briarhorn",
                "Thragtusk", "Acidic Slime",
                "Plated Slagwurm", "Indrik Stomphowler", "Charging Rhino",
                "Spearbreaker Behemoth", "Engulfing Slagwurm",
                "Sentinel Spider",
                "Wolfir Silverheart",
                "Pelakka Wurm",
                "Yavimaya Wurm", "Vorapede", "Phantom Centaur",
                "Giant Spider", "Ravenous Baloth",
                "Stingerfling Spider", "Loaming Shaman",
                "Heart Warden", "Quirion Sentinel",
                "Grizzly Bears", "Trained Armodon",
                "Spined Wurm", "Craw Wurm", "Kalonian Tusker",
                "Penumbra Spider",
                "Druid of the Cowl", "Civic Wayfinder",
                "Ironroot Treefolk", "Yavimaya Ants",
                "Elvish Warrior", "Silverback Ape",
                "Skarrgan Pit-Skulk", "Gnarlid Pack");
        // Removal (8) — same as Medium.
        addAll(cards, forest, 1,
                "Beast Within", "Naturalize", "Krosan Grip", "Plummet",
                "Bramblecrush", "Hunt the Hunter", "Lignify",
                "Song of the Dryads");
        // Utility (1) — no Heroic Intervention (mass protection — even
        // if single-cast it's a "protect entire board" effect), no
        // Garruk's Uprising / Nylea (anthems), no Sword of the Animist
        // (engine), no Veil of Summer (counter-counter — too narrow).
        // Just Wickerbough Elder as a vanilla destroy-artifact body.
        addAll(cards, forest, 1,
                "Wickerbough Elder");
        deck.setCards(cards);
        attachCommander(deck, commander);
        return deck;
    }
}
