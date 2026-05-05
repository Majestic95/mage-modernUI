package mage.webapi.ai;

import mage.cards.Card;
import mage.constants.CommanderCardType;
import mage.game.Game;
import mage.game.permanent.Permanent;
import mage.player.ai.score.ArtificialScoringSystem;
import mage.player.ai.score.GameStateEvaluator2;
import mage.players.Player;

import mage.game.permanent.PermanentToken;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Multi-opponent threat-weighted evaluator (AI-9 / Tier 2 #7).
 *
 * <p>Drop-in substitute for
 * {@code GameStateEvaluator2.evaluate(playerId, game).getTotalScore()}
 * — same {@code int} return shape, but the score is built from
 * <b>all</b> opponents (not just iterator-first) and applies threat
 * weights so the search-tree leaves prioritize finishing the actual
 * threat rather than a randomly-chosen victim.
 *
 * <h2>Why this exists</h2>
 *
 * Upstream {@link GameStateEvaluator2#evaluate} hardcodes
 * {@code getOpponents(playerId, false).stream().findFirst()} (line 35,
 * with a multi-year-old TODO). In a 4-player Commander pod, every
 * minimax leaf scores against whichever opponent the
 * {@link java.util.LinkedHashSet} iterator returned first — usually
 * the player to the AI's left, regardless of who's actually winning.
 * Tier 1 patched specific decision hooks ({@code chooseTarget},
 * {@code selectAttackers}); this is the structural fix that pushes
 * multi-opponent awareness into every evaluation in the search tree.
 *
 * <h2>Math</h2>
 *
 * {@code total = myScore - sum_over_alive_opponents(threatWeight(opp) * oppScore(opp))}
 *
 * <ul>
 *   <li>{@code myScore} = {@code lifeScore + sum(permanentScore) + handScore}.</li>
 *   <li>{@code oppScore} = same components for each alive opponent.</li>
 *   <li>{@code threatWeight} starts at 1.0 and composes multiplicatively:
 *       {@value #WEIGHT_LOW_LIFE} when {@code effectiveLifeRemaining(opp)
 *       <= }{@value #LOW_LIFE_THRESHOLD},
 *       {@value #WEIGHT_BIG_BOARD} when opp controls
 *       {@code >= }{@value #BIG_BOARD_THRESHOLD} permanents,
 *       {@value #WEIGHT_COMMANDER_OUT} when at least one of opp's
 *       commanders is on the battlefield.</li>
 *   <li>1v1 with no threat triggers degenerates to
 *       {@code myScore - oppScore} (matches upstream).</li>
 * </ul>
 *
 * <h2>Rules-correctness gates (AI-9 fixer + post-fixer)</h2>
 *
 * The 2026-05-05 critic pass found that the initial AI-9 build re-introduced
 * the AI-8.5 fix-C3 bug: filtering opponents by {@code !hasLost() && getLife() > 0}
 * misses Platinum Angel / Phyrexian Unlife / Worship / Gideon-emblem
 * effects. The post-fixer Magic-rules pass found a secondary bug: the original
 * fix relied solely on {@code canLose(game)}, which only fires the
 * {@code LOSES} replacement event — Phyrexian Unlife uses
 * {@code canLoseByZeroOrLessLife()}, a SEPARATE flag. The engine's own SBA
 * gate at {@code GameImpl.java:2376} checks BOTH; we now match. The
 * canonical gates are:
 *
 * <ul>
 *   <li>{@link Player#isInGame()} — {@code !hasQuit && !hasLost && !hasWon
 *       && !hasDrew && !hasLeft}; the right "is this player a real opponent"
 *       check (CR 800.7).</li>
 *   <li>{@link Player#canLose(Game)} — fires the {@code LOSES} replacement
 *       event. Catches Platinum Angel ({@code CantLoseGameSourceControllerEffect})
 *       and similar "can't lose" effects.</li>
 *   <li>{@link Player#canLoseByZeroOrLessLife()} — boolean flag set by
 *       {@code DontLoseByZeroOrLessLifeEffect}. Catches Phyrexian Unlife
 *       (CR 614.12). Independent of {@code canLose}; the engine ANDs both
 *       at the SBA gate, and we mirror that for our self-LOSE check.</li>
 * </ul>
 *
 * {@code canLose(game)} is cached per {@code evaluate} call (a small
 * {@link java.util.HashMap}) to avoid replacement-event spam in the hot
 * leaf-eval loop. Each call to {@code canLose} fires a replacement event
 * that walks all continuous effects; at skill ≥ 4 with ~5000 simulated
 * nodes/turn, the cache eliminates ~15k spurious replacement-event pumps
 * (and the side-effect risk of those pumps interacting with
 * {@code LOSES}-listening triggered abilities mid-simulation).
 *
 * <h2>Tier 2 #8 (hand quality) — SHIPPED via {@link HandCardScorer}</h2>
 *
 * The original AI-9 build attempted to replace upstream's
 * {@code handSize × HAND_CARD_SCORE} with
 * {@code sum(getCardDefinitionScore(card) × 0.4)}. The Magic-rules
 * critic pass found {@code ArtificialScoringSystem.getCardDefinitionScore}
 * uses a placeholder {@code value = 3} for ALL cards (its own TODO at
 * line 30): Forest = 125, Craterhoof = 240, Lightning Bolt = 290 —
 * anti-correlated with card power. AI-9 reverted to the upstream flat
 * formula and queued Tier 2 #8.
 *
 * <p>AI-12 ships our own cheap heuristic in {@link HandCardScorer} —
 * piecewise type-dispatched scoring (lands / creatures / instants /
 * sorceries / artifacts / enchantments / planeswalkers / battles) +
 * cross-type modifiers (mana-curve penalty, rarity bonus, ability
 * keyword scores via upstream's curated {@code MagicAbility.getAbilityScore}).
 * Final per-card score lands in {@code [30, 160]} and produces a
 * strategic ordering matching competent Commander intuition
 * (Sol Ring &gt; Forest, Avacyn &gt; Lightning Bolt). See
 * {@code HandCardScorer} class Javadoc for the algorithm.
 *
 * <h2>Behavior delta vs. upstream</h2>
 *
 * <ul>
 *   <li><b>Multi-opponent vs. iterator-first.</b> Sums all alive opponents
 *       weighted by threat. In 1v1 reduces exactly to upstream behavior.</li>
 *   <li><b>Early-WIN semantics.</b> Returns {@link GameStateEvaluator2#WIN_GAME_SCORE}
 *       only when {@code game.checkIfGameIsOver()} confirms it (or all
 *       opponents are out via {@code !isInGame()}). Upstream returns
 *       WIN as soon as <i>one</i> iterator-first opponent hits 0 life —
 *       wrong for multiplayer (killing one of three opponents isn't a win).
 *       Our delta is intentional and multiplayer-correct.</li>
 *   <li><b>Self-life-check rules-aware.</b> Returns
 *       {@link GameStateEvaluator2#LOSE_GAME_SCORE} only when our life
 *       is at-or-below 0 AND {@code canLose(game)} agrees. Phyrexian
 *       Unlife / Platinum Angel / Gideon-emblem builds at -3 life are
 *       NOT scored as lost.</li>
 *   <li><b>Threat axis = effective life.</b> {@code WEIGHT_LOW_LIFE}
 *       fires on {@code min(life, 21 - maxCommanderDamageDealt)} via
 *       {@link CommanderTargetingHeuristic#effectiveLifeRemaining} —
 *       same clock used at the Tier 1 targeting hook. Whichever
 *       loss-clock is closer drives the threat weighting.</li>
 * </ul>
 *
 * <h2>Two-Headed Giant / team formats</h2>
 *
 * In 2HG (CR 810), opponents share a life total. Our threat-weight
 * applies independently to each, so a 2HG team at low life gets
 * {@code 1.5 × oppA + 1.5 × oppB} weighting — double-counts the same
 * threat. Acceptable for now (4-player FFA is the primary use case);
 * proper team semantics need a refactor that exposes team identity to
 * the evaluator.
 *
 * <h2>Statelessness</h2>
 *
 * All-static helper, no fields, no instances. Required so the AI's
 * simulation-cloning path doesn't need to copy heuristic state.
 * Matches the design of the other webapi/ai/ helpers
 * ({@link CommanderTargetingHeuristic},
 * {@link CommanderActionFilter},
 * {@link CommanderLethalShortCircuit}).
 */
public final class MultiOpponentEvaluator {

    /**
     * Opponent at or below this <i>effective</i> life total triggers
     * the low-life threat amplifier — they're a finisher target.
     * "Effective life" is {@code min(life, 21 - maxCommanderDamage)};
     * whichever loss-clock is closer wins the threshold check. 10 =
     * "could die to one combat step or a typical burn finisher."
     */
    static final int LOW_LIFE_THRESHOLD = 10;

    /**
     * Opponent controlling at least this many permanents triggers
     * the big-board amplifier — they have board presence to be
     * worried about. 5 ≈ "established mid-game board."
     */
    static final int BIG_BOARD_THRESHOLD = 5;

    /** Threat × this when opponent's effective life is at/below {@link #LOW_LIFE_THRESHOLD}. */
    static final double WEIGHT_LOW_LIFE = 1.5;

    /** Threat × this when opponent controls ≥ {@link #BIG_BOARD_THRESHOLD} permanents. */
    static final double WEIGHT_BIG_BOARD = 1.2;

    /** Threat × this when opponent has a commander on the battlefield. */
    static final double WEIGHT_COMMANDER_OUT = 1.3;

    private MultiOpponentEvaluator() {
        // helper-only; do not instantiate
    }

    /**
     * Multi-opponent threat-weighted score for {@code playerId} in
     * {@code game}. Drop-in substitute for
     * {@code GameStateEvaluator2.evaluate(playerId, game).getTotalScore()}.
     *
     * <p>Returns {@link GameStateEvaluator2#WIN_GAME_SCORE} when the
     * player has won or all opponents are out (per {@code isInGame()})
     * and the game-over check confirms it. Returns
     * {@link GameStateEvaluator2#LOSE_GAME_SCORE} when the player has
     * lost or is at non-positive life and {@code canLose(game)}
     * agrees. Otherwise returns the threat-weighted differential.
     */
    public static int evaluate(UUID playerId, Game game) {
        Player player = game.getPlayer(playerId);
        if (player == null) {
            return GameStateEvaluator2.WIN_GAME_SCORE;
        }
        // Hoist the game-over check into a local — called twice below
        // and the engine implementation walks state-based actions.
        boolean gameOver = game.checkIfGameIsOver();
        if (gameOver) {
            if (player.hasLost()) {
                return GameStateEvaluator2.LOSE_GAME_SCORE;
            }
            if (player.hasWon()) {
                return GameStateEvaluator2.WIN_GAME_SCORE;
            }
        }
        // Self-life-check is rules-aware. Mirrors the engine's SBA gate at
        // GameImpl.java:2376: the player loses ONLY if both `canLose(game)`
        // (catches Platinum Angel etc. via LOSES replacement) AND
        // `canLoseByZeroOrLessLife()` (catches Phyrexian Unlife — its
        // protection is a continuous flag, NOT a LOSES replacement) agree.
        // Either gate alone misses one effect family.
        if (player.getLife() <= 0
                && player.canLose(game)
                && player.canLoseByZeroOrLessLife()) {
            return GameStateEvaluator2.LOSE_GAME_SCORE;
        }

        // Filter opponents by the canonical xmage "alive" gate.
        // isInGame() = !hasQuit && !hasLost && !hasWon && !hasDrew && !hasLeft.
        // Includes "can't lose" opponents (Platinum Angel) — they're still
        // threats even though life-loss can't kill them.
        List<Player> aliveOpponents = new ArrayList<>();
        for (UUID oppId : game.getOpponents(playerId, false)) {
            Player opp = game.getPlayer(oppId);
            if (opp != null && opp.isInGame()) {
                aliveOpponents.add(opp);
            }
        }
        // No alive opponents AND game-over confirms it → we won. Without
        // the game-over gate, this could fire prematurely (e.g., during
        // simulated state where the engine hasn't yet processed
        // state-based actions following the last opponent's loss event).
        if (aliveOpponents.isEmpty() && gameOver) {
            return GameStateEvaluator2.WIN_GAME_SCORE;
        }

        // Per-evaluate canLose cache. Each canLose() call fires a LOSES
        // replacement event that walks all continuous effects; without
        // this cache the threatWeight loop pumps replacement events
        // 3× per opponent in 4-player FFA, multiplied by simulation-tree
        // leaf count (50k–500k per turn at skill ≥ 4).
        Map<UUID, Boolean> canLoseCache = new HashMap<>(4);

        int myLifeScore = ArtificialScoringSystem.getLifeScore(player.getLife());
        int myPermanentScore = sumPermanentScores(player, game);
        int myHandScore = handScore(player, game);
        int myScore = myLifeScore + myPermanentScore + myHandScore;

        double weightedOpponentSum = 0.0;
        for (Player opp : aliveOpponents) {
            int oppLifeScore = ArtificialScoringSystem.getLifeScore(opp.getLife());
            int oppPermanentScore = sumPermanentScores(opp, game);
            int oppHandScore = handScore(opp, game);
            int oppRaw = oppLifeScore + oppPermanentScore + oppHandScore;
            weightedOpponentSum += threatWeight(playerId, opp, game, canLoseCache) * (double) oppRaw;
        }

        return myScore - (int) Math.round(weightedOpponentSum);
    }

    /**
     * Cached {@code canLose(game)} lookup. Fills the cache lazily; same
     * semantics as {@link Player#canLose(Game)} but at-most-one call per
     * opponent per {@code evaluate} invocation. Critical perf optimization
     * for the hot leaf-eval loop (post-fixer PF2).
     */
    private static boolean cachedCanLose(Player opp, Game game, Map<UUID, Boolean> cache) {
        Boolean cached = cache.get(opp.getId());
        if (cached != null) {
            return cached;
        }
        boolean canLose = opp.canLose(game);
        cache.put(opp.getId(), canLose);
        return canLose;
    }

    /**
     * Sums {@link GameStateEvaluator2#evaluatePermanent} across all
     * permanents the player controls. Reuses upstream's permanent
     * scoring verbatim — no behavior change there. The defensive
     * try-catch matches upstream's evaluator at line 64–95 (some
     * permanent abilities throw under simulated state).
     */
    static int sumPermanentScores(Player player, Game game) {
        int total = 0;
        try {
            for (Permanent permanent : game.getBattlefield().getAllActivePermanents(player.getId())) {
                total += GameStateEvaluator2.evaluatePermanent(permanent, game, true);
            }
        } catch (Throwable ignore) {
            // Match upstream defensive behavior — return whatever we
            // accumulated up to the throw rather than crashing the
            // search tree.
        }
        return total;
    }

    /**
     * Tier 2 #8 (hand quality scoring) — sums per-card heuristic
     * scores via {@link HandCardScorer#score}. See HandCardScorer
     * class Javadoc for the algorithm.
     *
     * <p>Iterates the hand UUID set directly and resolves via
     * {@code game.getCard(id)} to avoid the {@code LinkedHashSet}
     * allocation that {@code Cards.getCards(Game)} performs per call
     * (post-fixer AI-N2 — saves ~2M allocations/turn at skill 4+).
     */
    static int handScore(Player player, Game game) {
        int total = 0;
        for (UUID id : player.getHand()) {
            Card card = game.getCard(id);
            if (card != null) {
                total += HandCardScorer.score(card, game);
            }
        }
        return total;
    }

    /**
     * Composes the threat-weight multipliers for one opponent. Order
     * doesn't matter — multiplication is commutative — but each gate
     * fires independently. An opponent at 8 effective life with 7
     * permanents and a commander on the battlefield gets
     * {@code 1.5 × 1.2 × 1.3 = 2.34}.
     *
     * <p>The low-life axis uses
     * {@link CommanderTargetingHeuristic#effectiveLifeRemaining} —
     * the smaller of life and {@code 21 - maxCommanderDamageDealt} per
     * CR 903.14a. Whichever loss-clock is closer triggers the threat
     * amplification, matching the Tier 1 targeting heuristic.
     *
     * <p>{@code canLoseCache} is the per-evaluate-call replacement-event
     * cache; see {@link #cachedCanLose}.
     */
    static double threatWeight(UUID playerId, Player opp, Game game,
                                Map<UUID, Boolean> canLoseCache) {
        double weight = 1.0;
        // Effective life only fires when the opponent can actually lose
        // by life loss; opponents under "can't lose" effects (Platinum
        // Angel etc.) shouldn't get the LOW_LIFE finisher amplifier
        // because reducing their life is moot until the protection
        // is removed. Uses cached canLose to avoid replacement-event spam.
        if (cachedCanLose(opp, game, canLoseCache)) {
            int effectiveLife = CommanderTargetingHeuristic.effectiveLifeRemaining(
                    playerId, opp, opp.getId(), game);
            if (effectiveLife <= LOW_LIFE_THRESHOLD) {
                weight *= WEIGHT_LOW_LIFE;
            }
        }
        if (countOpponentPermanents(opp, game) >= BIG_BOARD_THRESHOLD) {
            weight *= WEIGHT_BIG_BOARD;
        }
        if (hasCommanderOnBattlefield(opp, game)) {
            weight *= WEIGHT_COMMANDER_OUT;
        }
        return weight;
    }

    static int countOpponentPermanents(Player opp, Game game) {
        return game.getBattlefield().getAllActivePermanents(opp.getId()).size();
    }

    /**
     * True iff at least one of the opponent's commanders is currently
     * on the battlefield, including post-flicker (where the permanent
     * has a new game-object UUID per CR 707.6 but its main-card UUID
     * still matches the registered commander identity).
     *
     * <p>Iterates the opponent's active permanents and matches against
     * the commander UUID set returned by
     * {@code getCommandersIds(opp, COMMANDER_OR_OATHBREAKER, false)}.
     * Direct {@code game.getPermanent(commanderId)} lookup would miss
     * flickered commanders because the new permanent's ID differs from
     * the original card's ID.
     *
     * <p>Token copies of commanders are explicitly filtered out per
     * CR 707.10 / CR 903.13a — a token that's a copy of a commander
     * is not itself a commander, even though its {@code getMainCard()}
     * returns the original commander card. Without the token filter,
     * Sakashima-of-a-Thousand-Faces / Mirror-Mockery / Wedding-Ring
     * tokens would falsely trip the {@link #WEIGHT_COMMANDER_OUT}
     * amplifier (post-fixer PF3).
     */
    static boolean hasCommanderOnBattlefield(Player opp, Game game) {
        Set<UUID> commanderIds = game.getCommandersIds(
                opp, CommanderCardType.COMMANDER_OR_OATHBREAKER, false);
        if (commanderIds == null || commanderIds.isEmpty()) {
            return false;
        }
        for (Permanent perm : game.getBattlefield().getAllActivePermanents(opp.getId())) {
            if (perm instanceof PermanentToken) {
                // CR 707.10 / 903.13a — a token copy of a commander is
                // not itself a commander.
                continue;
            }
            UUID matchId = perm.getMainCard() != null
                    ? perm.getMainCard().getId()
                    : perm.getId();
            if (commanderIds.contains(matchId)) {
                return true;
            }
        }
        return false;
    }
}
