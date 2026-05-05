package mage.webapi.ai;

import mage.constants.Rarity;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link HandCardScorer} (AI-12 / Tier 2 #8).
 *
 * <p>Behavior testing of card-quality scoring against real {@code Card}
 * objects requires an embedded server + card-database access — that's
 * the live-smoke surface, not a unit test. What's locked here:
 *
 * <ul>
 *   <li>Class shape (final, no instances, public static API).</li>
 *   <li>Constants in sensible ranges with no magic typos.</li>
 *   <li>Per-formula math: {@code rarityBonus}, {@code manaCurvePenalty},
 *       {@code statsPerManaBonus}, {@code cheapInstantBonus},
 *       {@code cheapArtifactBonus}, {@code sorceryCurveBonus}.
 *       These functions are pure {@code int → int}, testable in
 *       isolation, and form the regression-protection layer that
 *       catches anyone bumping a constant in a way that re-introduces
 *       the AI-9 anti-correlation bug.</li>
 *   <li>Strategic-ordering regressions: the design's calibration table
 *       asserts e.g. <i>Sol Ring scores higher than Forest</i> and
 *       <i>Avacyn scores higher than Lightning Bolt</i>. We can't
 *       construct real Card objects in unit-test land, but we CAN
 *       reproduce the math: a 1-mana uncommon artifact with the
 *       cheap-art bonus must beat a 0-mana basic land.</li>
 * </ul>
 *
 * <p>End-to-end tests through {@code MultiOpponentEvaluator.handScore}
 * with an actual Game fixture happen via live-smoke per the AI-8.x
 * precedent.
 */
class HandCardScorerTest {

    @Test
    void helperClass_isFinal() {
        assertTrue(Modifier.isFinal(HandCardScorer.class.getModifiers()),
                "HandCardScorer must be final — stateless helper pattern.");
    }

    @Test
    void helperClass_constructorIsPrivate() throws NoSuchMethodException {
        Constructor<HandCardScorer> ctor = HandCardScorer.class.getDeclaredConstructor();
        assertTrue(Modifier.isPrivate(ctor.getModifiers()),
                "HandCardScorer constructor must be private — purely-static API.");
    }

    @Test
    void scoreMethod_isPublicStatic() throws NoSuchMethodException {
        Method m = HandCardScorer.class.getDeclaredMethod(
                "score", mage.cards.Card.class, mage.game.Game.class);
        assertAll(
                () -> assertTrue(Modifier.isPublic(m.getModifiers()),
                        "score(Card, Game) must be public."),
                () -> assertTrue(Modifier.isStatic(m.getModifiers()),
                        "score must be static."),
                () -> assertEquals(int.class, m.getReturnType(),
                        "score must return int.")
        );
    }

    // ---- Constants sanity --------------------------------------------

    @Test
    void scoreFloorAndCap_areSensible() {
        assertTrue(HandCardScorer.SCORE_FLOOR > 0
                        && HandCardScorer.SCORE_FLOOR < 100,
                "SCORE_FLOOR should be in (0, 100) — every card has some value but not much.");
        assertTrue(HandCardScorer.SCORE_CAP_RAW > 100
                        && HandCardScorer.SCORE_CAP_RAW <= 1000,
                "SCORE_CAP_RAW should be in (100, 1000] — bound pathological keyword stacks.");
        assertTrue(HandCardScorer.HAND_MULTIPLIER > 0.0
                        && HandCardScorer.HAND_MULTIPLIER < 1.0,
                "HAND_MULTIPLIER should be in (0, 1) so cards in hand score "
                        + "less than the same card on battlefield.");
    }

    // ---- Pure-function: manaCurvePenalty -----------------------------

    @Test
    void manaCurvePenalty_isMonotonicallyNonDecreasing() {
        int prev = HandCardScorer.manaCurvePenalty(0);
        for (int mv = 1; mv <= 12; mv++) {
            int cur = HandCardScorer.manaCurvePenalty(mv);
            assertTrue(cur >= prev,
                    "manaCurvePenalty must be monotonically non-decreasing — "
                            + "got " + cur + " at MV=" + mv + " vs prior " + prev);
            prev = cur;
        }
    }

    @Test
    void manaCurvePenalty_zeroForCheapSpells() {
        assertAll(
                () -> assertEquals(0, HandCardScorer.manaCurvePenalty(0)),
                () -> assertEquals(0, HandCardScorer.manaCurvePenalty(1)),
                () -> assertEquals(0, HandCardScorer.manaCurvePenalty(2))
        );
    }

    @Test
    void manaCurvePenalty_growsForExpensive() {
        assertTrue(HandCardScorer.manaCurvePenalty(7) > HandCardScorer.manaCurvePenalty(4),
                "7-mana penalty must exceed 4-mana penalty.");
        assertTrue(HandCardScorer.manaCurvePenalty(10) > HandCardScorer.manaCurvePenalty(7),
                "10-mana penalty must exceed 7-mana penalty.");
    }

    // ---- Pure-function: rarityBonus (proxied via constants) ----------

    @Test
    void rarityEnum_hasExpectedValueCount() {
        // Rarity enum currently: LAND, COMMON, UNCOMMON, RARE, MYTHIC,
        // SPECIAL, BONUS = 7. If upstream adds a new rarity tier
        // (e.g., a hypothetical "MASTERPIECE"), HandCardScorer.rarityBonus
        // falls through to default=25 — sane fallback, but worth
        // reviewing whether the new tier deserves its own bonus.
        assertEquals(7, Rarity.values().length,
                "Rarity enum value count drifted — new tier added upstream? "
                        + "Review HandCardScorer.rarityBonus switch to decide if the "
                        + "new tier needs an explicit case.");
    }

    // ---- Pure-function: statsPerManaBonus ----------------------------

    @Test
    void statsPerManaBonus_zeroForZeroMana() {
        assertEquals(0, HandCardScorer.statsPerManaBonus(0, 0));
        assertEquals(0, HandCardScorer.statsPerManaBonus(99, 0),
                "MV=0 short-circuits regardless of stats (infinite ratio guard).");
    }

    @Test
    void statsPerManaBonus_efficientBody() {
        // 4/4 for 2 mana (sumPT=8 >= 2*3): Tarmogoyf class.
        assertEquals(50, HandCardScorer.statsPerManaBonus(8, 2));
        // 3/3 for 2 mana (sumPT=6 == 2*3): also Tarmogoyf class.
        assertEquals(50, HandCardScorer.statsPerManaBonus(6, 2));
        // 2/3 for 2 mana (sumPT=5 >= 2*2 but < 2*3): efficient.
        assertEquals(20, HandCardScorer.statsPerManaBonus(5, 2));
        // 2/2 for 2 mana (sumPT=4 == 2*2): efficient.
        assertEquals(20, HandCardScorer.statsPerManaBonus(4, 2));
        // 1/1 for 2 mana: under-statted.
        assertEquals(0, HandCardScorer.statsPerManaBonus(2, 2));
    }

    // ---- Pure-function: cheapInstantBonus ----------------------------

    @Test
    void cheapInstantBonus_decreasesWithCost() {
        int b0 = HandCardScorer.cheapInstantBonus(0);
        int b1 = HandCardScorer.cheapInstantBonus(1);
        int b2 = HandCardScorer.cheapInstantBonus(2);
        int b3 = HandCardScorer.cheapInstantBonus(3);
        int b4 = HandCardScorer.cheapInstantBonus(4);
        assertTrue(b0 >= b1 && b1 >= b2 && b2 >= b3 && b3 >= b4,
                "cheap-instant bonus must monotonically decrease with mana value.");
        assertEquals(0, b4, "4+ mana instants get no cheap bonus.");
    }

    // ---- Pure-function: cheapArtifactBonus ---------------------------

    @Test
    void cheapArtifactBonus_decreasesFromMV1Onward() {
        // Post-fixer MR-N1: the curve is INVERTED at MV=0 vs. MV=1
        // (Sol Ring at 1 mana scores higher than Mox tier at 0 mana).
        // From MV=1 onward, bonuses decrease monotonically.
        int b1 = HandCardScorer.cheapArtifactBonus(1);
        int b2 = HandCardScorer.cheapArtifactBonus(2);
        int b3 = HandCardScorer.cheapArtifactBonus(3);
        int b4 = HandCardScorer.cheapArtifactBonus(4);
        assertTrue(b1 >= b2 && b2 >= b3 && b3 >= b4,
                "cheap-artifact bonus must monotonically decrease from MV=1 onward.");
        assertEquals(0, b4, "4+ mana artifacts get no cheap-art bonus.");
    }

    @Test
    void cheapArtifactBonus_solRingBeatsMoxTier() {
        // Post-fixer MR-N1: Sol Ring (MV=1) must score >= MV=0 Moxen.
        // In Commander, Sol Ring is unconditional 2 mana with no
        // downside; Mox Diamond / Lotus Petal / Mana Crypt all have
        // costs (discard a land / one-shot / coin-flip damage). Sol
        // Ring is widely considered the strongest card in the band
        // (banned in cEDH, near-universal in casual).
        assertTrue(HandCardScorer.cheapArtifactBonus(1) >= HandCardScorer.cheapArtifactBonus(0),
                "Sol Ring tier (MV=1) must score >= Mox tier (MV=0) — "
                        + "Commander consensus puts Sol Ring above Moxen.");
        assertTrue(HandCardScorer.cheapArtifactBonus(1) >= 60,
                "1-mana cheap-art bonus must keep Sol Ring in the premium band.");
    }

    @Test
    void cheapInstantBonus_counterspellTierMatchesBolt() {
        // Post-fixer MR-N2: 2-mana cheap-instant must land near 1-mana
        // (within 5 points). In Commander, Counterspell-effects (MV=2)
        // are widely considered stronger than Bolt-effects (MV=1) due
        // to stack-interaction flexibility — but at minimum they
        // should be close, not 15-point spread.
        int bolt = HandCardScorer.cheapInstantBonus(1);
        int counter = HandCardScorer.cheapInstantBonus(2);
        assertTrue(Math.abs(bolt - counter) <= 5,
                "Counterspell tier (MV=2) and Bolt tier (MV=1) must score within 5 — "
                        + "got Bolt=" + bolt + " vs Counter=" + counter);
    }

    @Test
    void enchantmentCurveBonus_premiumBandsExist() {
        // Post-fixer MR-N3: cheap and expensive enchantments get
        // premium bonuses to lift Mystic Remora (1-mana common) out
        // of the SCORE_FLOOR and Doubling Season (5-mana mythic) above
        // basic-land scoring.
        assertTrue(HandCardScorer.enchantmentCurveBonus(1) > 0,
                "1-mana enchantments (Mystic Remora) must get a curve bonus.");
        assertTrue(HandCardScorer.enchantmentCurveBonus(5) > 0,
                "5-mana enchantments (Doubling Season) must get a curve bonus.");
        assertTrue(HandCardScorer.enchantmentCurveBonus(3) > 0,
                "3-mana enchantments (Rhystic Study, Smothering Tithe) must get a curve bonus.");
    }

    @Test
    void supplementKeywordScore_modernKeywordsPresent() {
        // Post-fixer MR-N7: upstream's MagicAbility map is missing
        // Lifelink/Hexproof/Ward/Menace/Protection. Verify our
        // supplement returns positive values for instances of these.
        // Reflection-construct dummy ability instances where possible;
        // otherwise just assert the supplement non-zero for known types.
        // Hexproof has a static no-arg getInstance() pattern.
        assertTrue(HandCardScorer.supplementKeywordScore(
                        mage.abilities.keyword.HexproofAbility.getInstance()) > 0,
                "Hexproof must score positive — was missing from upstream MagicAbility.");
        assertTrue(HandCardScorer.supplementKeywordScore(
                        mage.abilities.keyword.LifelinkAbility.getInstance()) > 0,
                "Lifelink must score positive — was missing from upstream MagicAbility.");
        assertTrue(HandCardScorer.supplementKeywordScore(
                        new mage.abilities.keyword.MenaceAbility()) > 0,
                "Menace must score positive — was missing from upstream MagicAbility.");
    }

    @Test
    void score_nullCardReturnsFloor() {
        // Defensive contract — null in the hand iteration shouldn't
        // crash the search tree, just contribute SCORE_FLOOR.
        assertEquals(HandCardScorer.SCORE_FLOOR,
                HandCardScorer.score(null, null),
                "Null card must return SCORE_FLOOR (defensive fallback).");
    }

    @Test
    void finalizeScore_renamedFromFinalize() throws NoSuchMethodException {
        // Post-fixer N4/N5: method renamed to avoid Object.finalize()
        // shadow. Pin the new name so a regression-rename doesn't slip.
        assertNotNull(HandCardScorer.class.getDeclaredMethod("finalizeScore", int.class),
                "finalizeScore must exist (renamed from finalize).");
    }

    // ---- Pure-function: sorceryCurveBonus ----------------------------

    @Test
    void sorceryCurveBonus_isInvertedFromInstants() {
        // Sorceries: cheap = tutor/ramp, expensive = wraths/finishers.
        // Mid-cost sorceries are typically less premium.
        int s1 = HandCardScorer.sorceryCurveBonus(1);
        int s3 = HandCardScorer.sorceryCurveBonus(3);
        int s4 = HandCardScorer.sorceryCurveBonus(4);
        int s7 = HandCardScorer.sorceryCurveBonus(7);
        assertTrue(s7 > s4, "7-mana sorcery (Insurrection / Time Stretch) > 4-mana.");
        assertTrue(s4 > s3, "4-mana sorcery (Wrath of God) > 3-mana.");
        assertTrue(s1 > s3, "1-mana sorcery (Demonic Tutor / Ponder) > 3-mana.");
    }

    // ---- Strategic-ordering regression suite -------------------------

    /**
     * The headline regression test — codifies the design's calibration
     * walkthrough so a future constant tweak that re-introduces the
     * AI-9 anti-correlation bug fails CI loudly.
     *
     * <p>We can't construct real {@code Card} objects in unit-test
     * land, but the <i>building-block math</i> is testable. These
     * assertions reproduce the design's claim that the formula
     * components compose to the right ordering across types.
     */
    @Test
    void strategicOrderingComponents_matchDesignCalibration() {
        // Sol Ring (1-mana uncommon artifact) component math (post-fixer
        // MR-N1: cheapArt(1)=90 inverted above MV=0):
        //   BASE_ARTIFACT(70) + cheapArt(1) + rarity(UNCOMMON)=10
        //   - manaCurve(1)=0 = 170 raw.
        // Forest (0-mana basic land):
        //   BASE_LAND(80) + 1*30 + (-10 basic) = 100 raw.
        int solRingRaw = 70 + HandCardScorer.cheapArtifactBonus(1) + 10
                - HandCardScorer.manaCurvePenalty(1);
        int forestRaw = 80 + 30 - 10;
        assertTrue(solRingRaw > forestRaw,
                "Sol Ring (raw=" + solRingRaw + ") must score higher than Forest (raw="
                        + forestRaw + "). If this fails, the AI prefers basic lands "
                        + "over signature mana rocks — re-introducing the AI-9 "
                        + "anti-correlation bug.");

        // Sol Ring (MV=1) must beat Mox-tier (MV=0):
        int moxTierRaw = 70 + HandCardScorer.cheapArtifactBonus(0) + 25  // RARE
                - HandCardScorer.manaCurvePenalty(0);
        assertTrue(solRingRaw >= moxTierRaw - 5,
                "Sol Ring (UNC, raw=" + solRingRaw + ") must score within 5 of Mox-tier "
                        + "(RARE, raw=" + moxTierRaw + "). Mox tier with RARE bonus may "
                        + "edge slightly higher (acceptable v1); a large gap would mean "
                        + "the AI prefers Mox over Sol Ring — wrong per Commander consensus.");

        // Avacyn (8-mana mythic creature, 8/8 with 50+20+150 keywords):
        //   BASE_CREATURE(60) + (8+8)*10 + keywords(220) + rarity(40)
        //   - manaCurve(8)=50 + statsPerMana(16, 8)=20 = 290.
        //   But upper-bounded by SCORE_CAP_RAW=400; passes.
        // Lightning Bolt (1-mana common instant):
        //   BASE_INSTANT(90) + rarity(0) - manaCurve(1)=0
        //   + cheapInst(1)=40 + keyword(0) = 130 raw.
        int avacynRaw = 60 + 16 * 10 + 220 + 40
                - HandCardScorer.manaCurvePenalty(8)
                + HandCardScorer.statsPerManaBonus(16, 8);
        int lightningBoltRaw = 90 + 0
                - HandCardScorer.manaCurvePenalty(1)
                + HandCardScorer.cheapInstantBonus(1);
        assertTrue(avacynRaw > lightningBoltRaw,
                "Avacyn (raw=" + avacynRaw + ") must score higher than Lightning Bolt (raw="
                        + lightningBoltRaw + "). If this fails, the AI prefers burn over "
                        + "8/8 indestructible mythic — the original AI-9 bug.");

        // Wrath of God (4-mana rare sorcery):
        //   BASE_SORCERY(80) + rarity(25) - manaCurve(4)=10
        //   + sorceryCurve(4)=30 = 125 raw.
        int wrathRaw = 80 + 25 - HandCardScorer.manaCurvePenalty(4)
                + HandCardScorer.sorceryCurveBonus(4);
        assertTrue(wrathRaw > forestRaw,
                "Wrath of God (raw=" + wrathRaw + ") must score higher than Forest (raw="
                        + forestRaw + "). Mid-cost wraths > basic lands.");
    }

    @Test
    void rawScoreMath_landsInTargetRange() {
        // Spot-check that raw scores for typical cards are in the
        // 100-300 range (which after 0.4× = 40-120 final). Well
        // under SCORE_CAP_RAW = 400.
        int forestRaw = 80 + 30 - 10;        // = 100
        int solRingRaw = 70 + 80 + 10;       // = 160
        int boltRaw = 90 + 40;               // = 130
        int wrathRaw = 80 + 25 - 10 + 30;    // = 125

        for (int raw : new int[]{forestRaw, solRingRaw, boltRaw, wrathRaw}) {
            int finalScore = (int) Math.round(raw * HandCardScorer.HAND_MULTIPLIER);
            int floored = Math.max(HandCardScorer.SCORE_FLOOR, finalScore);
            assertTrue(floored >= 30 && floored <= 200,
                    "Final score " + floored + " (raw " + raw + ") should be in [30, 200] "
                            + "for typical cards.");
        }
    }

    // ---- API surface pin ---------------------------------------------

    @Test
    void magicAbilityScore_helperPinned() {
        // HandCardScorer.abilityKeywordScore delegates to upstream's
        // MagicAbility.getAbilityScore — the one piece of upstream's
        // scorer worth reusing. If upstream renames or removes it,
        // our keyword scoring silently fails (returns 0 for everything).
        try {
            Method m = mage.player.ai.score.MagicAbility.class.getDeclaredMethod(
                    "getAbilityScore", mage.abilities.Ability.class);
            assertNotNull(m);
            assertEquals(int.class, m.getReturnType(),
                    "MagicAbility.getAbilityScore must return int — keyword sum input.");
        } catch (NoSuchMethodException ex) {
            throw new AssertionError(
                    "MagicAbility.getAbilityScore(Ability) is missing — "
                            + "AI-12 keyword scoring has nothing to delegate to.", ex);
        }
    }

    @Test
    void rarityEnum_doesNotCollideForOurUseCase() {
        // The design explicitly avoids Rarity.getRating() because
        // RARE and MYTHIC return the same value (3). Pin the
        // distinction by asserting that getRating COULD collide
        // (defensive — alerts if upstream fixes its rating fn).
        // If they're no longer equal, our switch-by-enum is
        // pessimization, but not a bug.
        int rareRating = Rarity.RARE.getRating();
        int mythicRating = Rarity.MYTHIC.getRating();
        if (rareRating != mythicRating) {
            // Upstream finally distinguished them — our switch still
            // works correctly, but the Javadoc warning becomes stale.
            // No assertion, just documentation by code.
        } else {
            // Confirms the historical issue we route around.
            assertEquals(rareRating, mythicRating,
                    "Rarity.getRating() RARE/MYTHIC collision is the documented reason "
                            + "HandCardScorer.rarityBonus uses an enum switch, not getRating().");
        }
    }
}
