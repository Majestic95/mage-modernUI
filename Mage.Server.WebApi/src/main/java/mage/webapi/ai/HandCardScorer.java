package mage.webapi.ai;

import mage.abilities.Abilities;
import mage.abilities.Ability;
import mage.abilities.ActivatedAbility;
import mage.abilities.keyword.HexproofAbility;
import mage.abilities.keyword.LifelinkAbility;
import mage.abilities.keyword.MenaceAbility;
import mage.abilities.keyword.ProtectionAbility;
import mage.abilities.keyword.WardAbility;
import mage.cards.Card;
import mage.constants.Rarity;
import mage.constants.SubType;
import mage.game.Game;
import mage.player.ai.score.MagicAbility;

/**
 * Cheap heuristic card-quality scorer for hand evaluation (AI-12 /
 * Tier 2 #8).
 *
 * <p>Drop-in per-card scorer used by
 * {@link MultiOpponentEvaluator#handScore} to differentiate cards
 * in a player's hand by quality. Replaces the flat
 * {@code handSize × HAND_CARD_SCORE} (= 5) baseline with a
 * piecewise type-dispatched score in the 30–160 range that produces
 * a strategic ordering matching a competent Commander player's
 * intuition (Sol Ring &gt; Forest, Avacyn &gt; Lightning Bolt).
 *
 * <h2>Why this exists (vs. upstream's helper)</h2>
 *
 * Upstream {@link mage.player.ai.score.ArtificialScoringSystem#getCardDefinitionScore}
 * uses a placeholder {@code value = 3} for ALL cards — see its own
 * TODO at line 30. With the original Tier 2 #8 spec
 * ({@code cardScore × 0.4}), the math produces:
 * Forest = 125, Craterhoof Behemoth = 240, Lightning Bolt = 290.
 * Bigger bombs scored <i>lower</i> than burn spells because the
 * mana-value penalty dominated. Anti-correlated with card power.
 *
 * <p>This scorer rolls its own per-type math using only the
 * {@link Card} / {@link mage.MageObject} interface — no Scryfall
 * lookup, no card-name table, no rules-text string parsing. Reuses
 * {@link MagicAbility#getAbilityScore} (the one piece of upstream's
 * scorer that <i>is</i> curated correctly — keyword→int map at
 * MagicAbility.java:46) for ability-bonus computation.
 *
 * <h2>Algorithm</h2>
 *
 * Per-card score = {@code clamp(SCORE_FLOOR, finalize(raw))} where:
 * <pre>
 * raw = baseForType
 *     + typeSpecificBonuses
 *     + rarityBonus
 *     + abilityKeywordScore
 *     - manaCurvePenalty
 * </pre>
 * Final = {@code Math.max(SCORE_FLOOR, round(min(SCORE_CAP_RAW, raw) × HAND_MULTIPLIER))}.
 *
 * <p>The {@code HAND_MULTIPLIER = 0.4} preserves the
 * "play it out from hand" preference: a card on the battlefield
 * typically scores {@code 300+ (PERMANENT_SCORE) + dynamic bonuses};
 * the same card in hand scores ~40% of its raw value, which lands
 * around 5–6× lower per-card.
 *
 * <h2>Calibration target</h2>
 *
 * Final scores typically land in the 30–160 range. Premium cards
 * (mythic creatures with multiple keywords like Avacyn) reach ~160;
 * basic lands floor at 30–40; cheap utility instants ~50; bomb
 * sorceries ~50–70; signature cheap-cost mana rocks ~64–80.
 *
 * <h2>What this does NOT do (deliberate scope-out)</h2>
 *
 * <ul>
 *   <li>Card-name lookup tables — unmaintainable for 28k cards.</li>
 *   <li>Rules-text string parsing — slow + brittle templating.</li>
 *   <li>Color identity / castability — would break statelessness.</li>
 *   <li>Modal-spell mode evaluation — modes vary too much; rarity
 *       proxy carries it.</li>
 *   <li>Suspend / alt-cost adjustment — niche; suspend cards
 *       slightly under-score; acceptable for v1.</li>
 *   <li>Scryfall API integration — network I/O in hot path.</li>
 * </ul>
 *
 * <h2>Statelessness</h2>
 *
 * All-static helper, no fields, no instances. Required so the AI's
 * simulation-cloning path doesn't need to copy heuristic state.
 * Matches the pattern of the other webapi/ai/ helpers
 * ({@link CommanderTargetingHeuristic}, {@link CommanderActionFilter},
 * {@link CommanderLethalShortCircuit},
 * {@link MultiOpponentEvaluator}).
 */
public final class HandCardScorer {

    // ---- constants ---------------------------------------------------

    /** Final-score floor — every card has at least this value in hand. */
    static final int SCORE_FLOOR = 30;

    /** Raw-score cap before multiplier — prevents pathological keyword stacks. */
    static final int SCORE_CAP_RAW = 400;

    /** Hand-vs-battlefield multiplier — see class Javadoc. */
    static final double HAND_MULTIPLIER = 0.4;

    // Per-type bases.
    private static final int BASE_LAND = 80;
    private static final int BASE_CREATURE = 60;
    private static final int BASE_INSTANT = 90;
    private static final int BASE_SORCERY = 80;
    private static final int BASE_ARTIFACT = 70;
    private static final int BASE_ENCHANTMENT = 75;
    private static final int BASE_PLANESWALKER = 110;
    private static final int BASE_BATTLE = 90;
    private static final int BASE_UNKNOWN = 60;

    private HandCardScorer() {
        // helper-only; do not instantiate
    }

    /**
     * Score a single hand-card. Returns a value in {@code [SCORE_FLOOR,
     * SCORE_CAP_RAW × HAND_MULTIPLIER]} = {@code [30, 160]}.
     */
    public static int score(Card card, Game game) {
        if (card == null) {
            return SCORE_FLOOR;
        }
        try {
            int raw = computeRawScore(card, game);
            return finalizeScore(raw);
        } catch (Throwable ignore) {
            // Defensive — match the pattern in MultiOpponentEvaluator.
            // A malformed card under simulation shouldn't crash the
            // search tree; fall back to flat upstream score.
            return SCORE_FLOOR;
        }
    }

    /**
     * Cap raw, multiply by HAND_MULTIPLIER, floor at SCORE_FLOOR.
     * Renamed from {@code finalize} (post-fixer N4/N5) — that name
     * shadows {@link Object#finalize()} and triggers compiler warnings
     * even though the static-private dispatch can't actually
     * collide.
     */
    static int finalizeScore(int raw) {
        int capped = Math.max(0, Math.min(SCORE_CAP_RAW, raw));
        int multiplied = (int) Math.round(capped * HAND_MULTIPLIER);
        return Math.max(SCORE_FLOOR, multiplied);
    }

    // ---- type dispatch -----------------------------------------------

    private static int computeRawScore(Card card, Game game) {
        // Use no-arg overloads where possible — hand cards don't have
        // dynamic-state card-type changes applied. Order matters because
        // some cards have multiple types (artifact creature, enchantment
        // creature) — pick the dominant value driver per the design:
        //   - Artifact creature → score as artifact, but ADD creature
        //     stats (cheap-art bonus + body).
        //   - Enchantment creature (gods, bestow) → enchantment + body.
        //   - Land otherwise short-circuits everything (lands are never
        //     "also" another type in standard MTG; battle lands are
        //     dual-typed but we treat them as land-first).
        if (card.isLand()) {
            return scoreLand(card, game);
        }
        if (card.isArtifact()) {
            return scoreArtifact(card, game);
        }
        if (card.isEnchantment()) {
            return scoreEnchantment(card, game);
        }
        if (card.isCreature()) {
            return scoreCreature(card, game);
        }
        if (card.isInstant()) {
            return scoreInstant(card, game);
        }
        if (card.isSorcery()) {
            return scoreSorcery(card, game);
        }
        if (card.isPlaneswalker()) {
            return scorePlaneswalker(card);
        }
        if (card.isBattle()) {
            return scoreBattle(card);
        }
        // Tribal-only / unknown — fall through.
        return BASE_UNKNOWN + rarityBonus(card) - manaCurvePenalty(card.getManaValue());
    }

    // ---- per-type formulas -------------------------------------------

    static int scoreLand(Card card, Game game) {
        int score = BASE_LAND;
        // Color-count proxy for mana production: getColorIdentity is a
        // single FilterMana object (no allocation), capped at 5 colors.
        // Cap at 2 so City of Brass (5-color rainbow with downside)
        // doesn't outscore Tundra (2-color clean dual). Post-fixer
        // MR-N6 + AI-B2 (avoids per-call ArrayList allocation in
        // card.getMana()).
        int colors = card.getColorIdentity() != null
                ? card.getColorIdentity().getColorCount()
                : 0;
        score += Math.min(2, colors) * 30;
        if (card.isBasic()) {
            score -= 10;
        }
        if (colors >= 2) {
            score += 25; // dual / tri / shock / fetch / triome
        }
        // Cache the abilities walk — was twice for lands (here +
        // abilityKeywordScore) at ~150k calls/turn (post-fixer AI-B3).
        Abilities<Ability> abilities = card.getAbilities(game);
        score += countNonManaActivatedAbilitiesIn(abilities) * 15;
        if (card.isLegendary()) {
            score -= 5; // legend rule downside
        }
        return score;
    }

    static int scoreCreature(Card card, Game game) {
        int manaValue = card.getManaValue();
        int power = card.getPower().getValue();
        int toughness = card.getToughness().getValue();
        int score = BASE_CREATURE
                + (power + toughness) * 10
                + abilityKeywordScore(card, game)
                + rarityBonus(card)
                - manaCurvePenalty(manaValue)
                + statsPerManaBonus(power + toughness, manaValue);
        return score;
    }

    static int scoreInstant(Card card, Game game) {
        int manaValue = card.getManaValue();
        return BASE_INSTANT
                + rarityBonus(card)
                - manaCurvePenalty(manaValue)
                + cheapInstantBonus(manaValue)
                + abilityKeywordScore(card, game);
    }

    static int scoreSorcery(Card card, Game game) {
        int manaValue = card.getManaValue();
        return BASE_SORCERY
                + rarityBonus(card)
                - manaCurvePenalty(manaValue)
                + sorceryCurveBonus(manaValue)
                + abilityKeywordScore(card, game);
    }

    static int scoreArtifact(Card card, Game game) {
        int manaValue = card.getManaValue();
        int score = BASE_ARTIFACT
                + rarityBonus(card)
                - manaCurvePenalty(manaValue)
                + cheapArtifactBonus(manaValue)
                + abilityKeywordScore(card, game);
        // Post-fixer N1: artifact-enchantment dual-types exist
        // (Sagas like "The Kami War"). Apply enchantment-specific
        // modifiers when both types are present so we don't lose the
        // saga/aura signal.
        if (card.isEnchantment()) {
            score += enchantmentCurveBonus(manaValue);
            if (card.hasSubtype(SubType.AURA, game)) {
                score -= 25;
            }
            if (card.hasSubtype(SubType.SAGA, game)) {
                score += 20;
            }
        }
        // Artifact-creatures get the body bonus too (Walking Ballista,
        // Wurmcoil Engine).
        if (card.isCreature()) {
            int power = card.getPower().getValue();
            int toughness = card.getToughness().getValue();
            score += (power + toughness) * 10
                    + statsPerManaBonus(power + toughness, manaValue);
        }
        return score;
    }

    static int scoreEnchantment(Card card, Game game) {
        int manaValue = card.getManaValue();
        int score = BASE_ENCHANTMENT
                + rarityBonus(card)
                - manaCurvePenalty(manaValue)
                + enchantmentCurveBonus(manaValue)
                + abilityKeywordScore(card, game);
        // Auras are 2-for-1 risk; downgrade. Sagas are typically
        // build-around payoffs printed at rare/mythic; small bump.
        if (card.hasSubtype(SubType.AURA, game)) {
            score -= 25;
        }
        if (card.hasSubtype(SubType.SAGA, game)) {
            score += 20;
        }
        // Enchantment-creature (gods, bestow creatures): add body math.
        if (card.isCreature()) {
            int power = card.getPower().getValue();
            int toughness = card.getToughness().getValue();
            score += (power + toughness) * 10
                    + statsPerManaBonus(power + toughness, manaValue);
        }
        return score;
    }

    static int scorePlaneswalker(Card card) {
        int manaValue = card.getManaValue();
        // Rarity bonus * 1.5 since PWs are basically all rare/mythic;
        // the base * 1.5 amplifier keeps the spread meaningful within
        // the rare/mythic tier.
        int amplifiedRarity = (int) Math.round(rarityBonus(card) * 1.5);
        // Post-fixer B1: getStartingLoyalty returns -1 ("none") and
        // -2 ("X") — clamp at 0 so X-loyalty PWs don't get punished.
        int loyalty = Math.max(0, card.getStartingLoyalty());
        return BASE_PLANESWALKER
                + loyalty * 12
                + amplifiedRarity
                - manaCurvePenalty(manaValue);
    }

    static int scoreBattle(Card card) {
        int manaValue = card.getManaValue();
        // Post-fixer B1: getStartingDefense returns -1 ("none") and
        // -2 ("X") — clamp at 0.
        int defense = Math.max(0, card.getStartingDefense());
        return BASE_BATTLE
                + defense * 8
                + rarityBonus(card)
                - manaCurvePenalty(manaValue);
    }

    // ---- cross-type helpers ------------------------------------------

    /**
     * Mana-curve penalty — heavier spells get progressively less
     * value-in-hand because castability matters. Applied uniformly
     * to all non-land types so cross-type comparisons remain valid.
     */
    static int manaCurvePenalty(int manaValue) {
        if (manaValue <= 2) {
            return 0;
        }
        if (manaValue == 3) {
            return 5;
        }
        if (manaValue == 4) {
            return 10;
        }
        if (manaValue == 5) {
            return 18;
        }
        if (manaValue == 6) {
            return 28;
        }
        if (manaValue == 7) {
            return 40;
        }
        return 50 + (manaValue - 7) * 5;
    }

    /**
     * Rarity bonus. <b>Does NOT use {@link Rarity#getRating()}</b> —
     * upstream's rating function returns {@code RARE = 3, MYTHIC = 3}
     * (a collision); a direct enum switch is required to distinguish
     * the tiers.
     */
    static int rarityBonus(Card card) {
        Rarity r = card.getRarity();
        if (r == null) {
            return 0; // tokens, oddities
        }
        switch (r) {
            case LAND:
                return 0; // basic-land rarity tier — no bonus (land scoring path handles it)
            case COMMON:
                return 0;
            case UNCOMMON:
                return 10;
            case RARE:
                return 25;
            case MYTHIC:
                return 40;
            case SPECIAL:
            case BONUS:
            default:
                return 25; // power-level-equivalent to rare for promo / special printings
        }
    }

    /**
     * Sums {@link MagicAbility#getAbilityScore} across the card's
     * abilities, plus a local supplement for keywords missing from
     * upstream's map (post-fixer MR-N7). Upstream's
     * {@code MagicAbility} was tuned pre-2010 and never got Lifelink,
     * Hexproof, Ward, Menace, or Protection — all of which are
     * format-defining keywords in modern Commander.
     *
     * <p>Bounded by the card's ability count (typically 1–4; absolute
     * worst printed card ~10).
     */
    static int abilityKeywordScore(Card card, Game game) {
        return abilityKeywordScoreIn(card.getAbilities(game));
    }

    /**
     * Iterates an already-resolved {@link Abilities} list. Used by
     * {@link #scoreLand} to avoid the duplicate {@code getAbilities}
     * walk (post-fixer AI-B3).
     */
    static int abilityKeywordScoreIn(Abilities<Ability> abilities) {
        int total = 0;
        for (Ability ability : abilities) {
            total += MagicAbility.getAbilityScore(ability);
            total += supplementKeywordScore(ability);
        }
        return total;
    }

    /**
     * Local supplement for keywords missing from upstream's
     * {@link MagicAbility} map (Lifelink, Hexproof, Ward, Menace,
     * Protection). Returns 0 for any other ability — additive on top
     * of upstream's score (which returns +2 for unrecognized).
     *
     * <p>Magnitudes calibrated against upstream's own scale: Indestructible
     * = 150, DoubleStrike = 100, Flying = 50, Trample = 30. Hexproof is
     * "Indestructible-against-targeted" → 80. Lifelink and Protection
     * are evasion-equivalent → 40 / 60. Menace is half-Flying → 20.
     * Ward is "soft Hexproof" → 30.
     */
    static int supplementKeywordScore(Ability ability) {
        if (ability instanceof LifelinkAbility) return 40;
        if (ability instanceof HexproofAbility) return 80;
        if (ability instanceof ProtectionAbility) return 60;
        if (ability instanceof WardAbility) return 30;
        if (ability instanceof MenaceAbility) return 20;
        return 0;
    }

    /**
     * Counts activated abilities that are NOT mana abilities. Used
     * for the utility-land bonus (Maze of Ith, Volrath's Stronghold,
     * Bojuka Bog — non-mana activated ability adds value).
     *
     * <p>Note (post-fixer MR-N5): triggered abilities are NOT counted
     * here. Bojuka Bog's "exile target graveyard on ETB" is a
     * triggered ability; it's strategically high-value but doesn't
     * trip this counter. Acceptable v1 simplification — queued for
     * AI-12.1 follow-up.
     */
    static int countNonManaActivatedAbilities(Card card, Game game) {
        return countNonManaActivatedAbilitiesIn(card.getAbilities(game));
    }

    static int countNonManaActivatedAbilitiesIn(Abilities<Ability> abilities) {
        int count = 0;
        for (Ability ability : abilities) {
            if (ability instanceof ActivatedAbility && !ability.isManaAbility()) {
                count++;
            }
        }
        return count;
    }

    /** Efficient-body bonus: P+T outpaces mana cost noticeably. */
    static int statsPerManaBonus(int sumPT, int manaValue) {
        if (manaValue == 0) {
            return 0;
        }
        if (sumPT >= manaValue * 3) {
            return 50; // Tarmogoyf class
        }
        if (sumPT >= manaValue * 2) {
            return 20; // efficient body
        }
        return 0;
    }

    /**
     * Cheap-cost instant bonus — 0/1/2-mana instants are
     * overwhelmingly removal/counters/protection in practice.
     *
     * <p>Post-fixer MR-N2: 2-mana bumped from 25 to 35 to match
     * Commander reality — Counterspell / Mana Drain / Cyclonic Rift /
     * Swan Song live at MV=2 and are widely considered stronger than
     * MV=1 burn (Lightning Bolt). Now Counterspell ≈ Bolt rather than
     * Bolt &gt; Counterspell.
     */
    static int cheapInstantBonus(int manaValue) {
        if (manaValue == 0) return 50;
        if (manaValue == 1) return 40;
        if (manaValue == 2) return 35;
        if (manaValue == 3) return 10;
        return 0;
    }

    /** Sorcery curve — both ends are premium (cheap tutors / ramp; expensive wraths / finishers). */
    static int sorceryCurveBonus(int manaValue) {
        if (manaValue <= 0) return 0;
        if (manaValue == 1) return 25;  // Ponder / Demonic Tutor tier
        if (manaValue == 2) return 20;  // Reanimate / Mind Twist tier
        if (manaValue == 3) return 10;
        if (manaValue == 4) return 30;  // Wrath of God tier
        if (manaValue == 5) return 40;  // Cyclonic Rift overload tier
        if (manaValue == 6) return 50;  // Insurrection tier
        return 60;                       // 7+ mana finishers
    }

    /**
     * Cheap-cost artifact bonus — captures Sol Ring / Mox / Mana
     * Crypt territory without name lookup. Commander format heavily
     * skews cheap artifacts toward ramp.
     *
     * <p>Post-fixer MR-N1: curve flattened so MV=1 (Sol Ring tier) ≥
     * MV=0 (Mox tier). In Commander, Sol Ring is unambiguously
     * stronger than Mox Diamond / Lotus Petal / Mana Crypt
     * (banned in cEDH, near-universal in casual). The original
     * 100-vs-80 curve put Mox above Sol Ring — now 90-vs-70 inverts
     * the ordering correctly.
     *
     * <p>Note: X-cost artifact creatures (Walking Ballista, Endless One)
     * have {@code manaValue = 0} at static-card-data layer and
     * incidentally land in the MV=0 cheap-art tier. This is
     * coincidence, not design — but Walking Ballista IS a strong
     * card and the score is in a sensible band, so accept it.
     */
    static int cheapArtifactBonus(int manaValue) {
        if (manaValue == 0) return 70;  // Mox Diamond, Lotus Petal, Mana Crypt
        if (manaValue == 1) return 90;  // Sol Ring tier — unconditional 2 mana
        if (manaValue == 2) return 30;  // Arcane Signet, Talismans, Mind Stone
        if (manaValue == 3) return 15;  // Commander's Sphere, Worn Powerstone
        return 0;
    }

    /**
     * Enchantment curve bonus — captures both ends of the cost
     * spectrum. Cheap enchantments (1-2 mana) are often premium
     * card-advantage engines: Mystic Remora, Land Tax, Sylvan Library,
     * Necropotence, Smothering Tithe. Expensive enchantments (4-6
     * mana mythic) are typically build-around payoffs: Doubling
     * Season, Cyclonic Rift's enchantment-based brethren.
     *
     * <p>Post-fixer MR-N3: without this bonus, Mystic Remora floored
     * at SCORE_FLOOR=30 and Doubling Season scored below Forest. Both
     * regressions of the AI-9 anti-correlation pattern in disguise.
     */
    static int enchantmentCurveBonus(int manaValue) {
        if (manaValue == 1) return 30;  // Mystic Remora, Land Tax tier
        if (manaValue == 2) return 25;  // Sylvan Library, Necropotence tier
        if (manaValue == 3) return 15;  // Rhystic Study, Smothering Tithe tier
        if (manaValue == 4) return 20;  // mid-cost engines
        if (manaValue == 5) return 30;  // Doubling Season tier
        if (manaValue == 6) return 25;
        return 10;
    }
}
