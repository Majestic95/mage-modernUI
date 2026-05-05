package mage.webapi.ai;

import mage.abilities.Ability;
import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.player.ai.ComputerPlayer;
import mage.player.ai.SimulationNode2;
import org.apache.log4j.Logger;

import java.util.LinkedList;
import java.util.UUID;

/**
 * Intermediate class in the AI subclass chain that owns the AI-9
 * {@code addActions} + {@code calculateActions} overrides. Sits
 * between {@link CommanderSimulatePriorityOverride} (which owns the
 * companion {@code simulatePriority} override) and
 * {@link CommanderComputerPlayer7} (decision-point heuristics).
 *
 * <p>Extracted from CommanderComputerPlayer7 in slice AI-9 because
 * the addActions body-copy pushed that file past CLAUDE.md's 400-LOC
 * soft cap. Splitting here keeps each layer focused: this class
 * handles the recursive minimax leaf wrap; the parent class handles
 * the action-ranking step; CommanderComputerPlayer7 handles
 * per-decision-point heuristics (chooseTarget, act, selectAttackers).
 *
 * <h2>What this overrides</h2>
 *
 * <ul>
 *   <li>{@code addActions} (from ComputerPlayer6) — verbatim copy of
 *       upstream body with all 6 calls to
 *       {@code GameStateEvaluator2.evaluate(...).getTotalScore()}
 *       replaced by {@link MultiOpponentEvaluator#evaluate(UUID, Game)}.</li>
 *   <li>{@code calculateActions} (from ComputerPlayer7) — companion
 *       override so {@code currentScore} is seeded by the multi-opp
 *       evaluator (matching the comparison scale used inside
 *       {@code addActions}'s step-finished branch).</li>
 * </ul>
 *
 * <h2>Why body-copy, not wrap-super?</h2>
 *
 * Upstream's six in-method calls to the static evaluator are inside
 * scattered conditional branches — there's no chokepoint to
 * intercept. A "wrap super, add bias on top" approach would
 * double-count the bias at every recursion level. Body-copy is the
 * least-bad option. Mitigations:
 *
 * <ul>
 *   <li>{@link MultiOpponentEvaluatorPinTest} pins the upstream
 *       {@code addActions} method <i>signature</i> + the protected
 *       fields the body-copy reads ({@code currentScore},
 *       {@code maxNodes}, {@code actions}, {@code combat},
 *       {@code root}, {@code actionCache}, {@code maxDepth}). This
 *       does NOT pin the upstream method <i>body</i> — a 7th
 *       evaluate() call added inside addActions on rebase would
 *       compile cleanly and silently bypass our wrapper. Auditors
 *       MUST diff the upstream method against our body-copy on
 *       every rebase. (A bytecode-hash pin is queued as AI-9.1
 *       follow-up.)</li>
 *   <li>Source line annotations point at the upstream baseline so
 *       future-rebase auditors can diff mechanically.</li>
 *   <li>The behavior delta is narrow — only the leaf evaluator
 *       changes; the search structure, alpha-beta logic, and node
 *       lifecycle are byte-equivalent to upstream.</li>
 * </ul>
 *
 * <h2>Why this class is not abstract</h2>
 *
 * It can be instantiated standalone for unit tests of the search-
 * tree behavior in isolation from the decision-point heuristics.
 * Production registration goes via {@link CommanderComputerPlayer7}
 * which extends this class and adds the Tier 1 hooks on top.
 */
public class CommanderSearchTreeOverride extends CommanderSimulatePriorityOverride {

    private static final Logger log = Logger.getLogger(CommanderSearchTreeOverride.class);

    /**
     * Pinned copy of upstream
     * {@code ComputerPlayer6#MAX_SIMULATED_NODES_PER_ERROR} (private
     * static final). The reflection-pin test asserts upstream still
     * declares this value so a silent drift on rebase fails CI rather
     * than skewing simulation termination.
     */
    static final int MAX_SIMULATED_NODES_PER_ERROR_PIN = 5100;

    public CommanderSearchTreeOverride(String name, RangeOfInfluence range, int skill) {
        super(name, range, skill);
    }

    public CommanderSearchTreeOverride(final CommanderSearchTreeOverride player) {
        super(player);
    }

    @Override
    public CommanderSearchTreeOverride copy() {
        return new CommanderSearchTreeOverride(this);
    }

    /**
     * AI-9 — replaces upstream's six in-method calls to
     * {@code GameStateEvaluator2.evaluate(playerId, game).getTotalScore()}
     * with {@link MultiOpponentEvaluator#evaluate(UUID, Game)}. Body
     * is otherwise a verbatim copy of
     * {@code ComputerPlayer6.addActions} (commit 744fd1f4 baseline,
     * source line {@code ComputerPlayer6.java:206}).
     */
    @Override
    protected int addActions(SimulationNode2 node, int depth, int alpha, int beta) {
        boolean stepFinished = false;
        int val;
        if (log.isTraceEnabled()
                && node != null
                && node.getAbilities() != null
                && !node.getAbilities().toString().equals("[Pass]")) {
            log.trace("Add Action [" + depth + "] " + node.getAbilities().toString()
                    + "  a: " + alpha + " b: " + beta);
        }
        Game game = node.getGame();
        if (!ComputerPlayer.COMPUTER_DISABLE_TIMEOUT_IN_GAME_SIMULATIONS
                && Thread.currentThread().isInterrupted()) {
            log.debug("AI game sim interrupted by timeout");
            return MultiOpponentEvaluator.evaluate(playerId, game);
        }
        if (SimulationNode2.getCount() > MAX_SIMULATED_NODES_PER_ERROR_PIN) {
            throw new IllegalStateException("AI ERROR: too much nodes (possible actions)");
        }
        if (depth <= 0
                || SimulationNode2.getCount() > maxNodes
                || game.checkIfGameIsOver()) {
            val = MultiOpponentEvaluator.evaluate(playerId, game);
            if (log.isTraceEnabled()) {
                StringBuilder sb = new StringBuilder("Add Actions -- reached end state  <").append(val).append('>');
                SimulationNode2 logNode = node;
                do {
                    sb.append(new StringBuilder(" <- [" + logNode.getDepth() + ']'
                            + (logNode.getAbilities() != null ? logNode.getAbilities().toString() : "[empty]")));
                    logNode = logNode.getParent();
                } while ((logNode.getParent() != null));
                log.trace(sb);
            }
        } else if (!node.getChildren().isEmpty()) {
            if (log.isDebugEnabled()) {
                StringBuilder sb = new StringBuilder("Add Action [").append(depth)
                        .append("] -- something added children ")
                        .append(node.getAbilities() != null ? node.getAbilities().toString() : "null")
                        .append(" added children: ").append(node.getChildren().size()).append(" (");
                for (SimulationNode2 logNode : node.getChildren()) {
                    sb.append(logNode.getAbilities() != null ? logNode.getAbilities().toString() : "null").append(", ");
                }
                sb.append(')');
                log.debug(sb);
            }
            val = minimaxAB(node, depth - 1, alpha, beta);
        } else {
            log.trace("Add Action -- alpha: " + alpha + " beta: " + beta + " depth:" + depth
                    + " step:" + game.getTurnStepType()
                    + " for player:" + game.getPlayer(game.getActivePlayerId()).getName());
            if (allPassed(game)) {
                if (!game.getStack().isEmpty()) {
                    resolve(node, depth, game);
                } else {
                    stepFinished = true;
                }
            }

            if (game.checkIfGameIsOver()) {
                val = MultiOpponentEvaluator.evaluate(playerId, game);
            } else if (stepFinished) {
                log.debug("Step finished");
                int testScore = MultiOpponentEvaluator.evaluate(playerId, game);
                if (game.isActivePlayer(playerId)) {
                    if (testScore < currentScore) {
                        // if score at end of step is worse than original score don't check further
                        val = testScore;
                    } else {
                        val = MultiOpponentEvaluator.evaluate(playerId, game);
                    }
                } else {
                    val = MultiOpponentEvaluator.evaluate(playerId, game);
                }
            } else if (!node.getChildren().isEmpty()) {
                if (log.isDebugEnabled()) {
                    StringBuilder sb = new StringBuilder("Add Action [").append(depth)
                            .append("] -- trigger ")
                            .append(node.getAbilities() != null ? node.getAbilities().toString() : "null")
                            .append(" added children: ").append(node.getChildren().size()).append(" (");
                    for (SimulationNode2 logNode : node.getChildren()) {
                        sb.append(logNode.getAbilities() != null ? logNode.getAbilities().toString() : "null").append(", ");
                    }
                    sb.append(')');
                    log.debug(sb);
                }
                val = minimaxAB(node, depth - 1, alpha, beta);
            } else {
                val = simulatePriority(node, game, depth, alpha, beta);
            }
        }
        node.setScore(val);
        log.trace("returning -- score: " + val + " depth:" + depth + " step:" + game.getTurnStepType()
                + " for player:" + game.getPlayer(node.getPlayerId()).getName());
        return val;
    }

    /**
     * AI-9 — companion override to {@link #addActions}. Upstream's
     * {@code calculateActions} (ComputerPlayer7.java:113) seeds the
     * {@code currentScore} field via the single-opponent evaluator;
     * the {@code stepFinished} branch in our overridden addActions
     * compares against {@code currentScore}, so the two scoring
     * scales must match. We seed {@code currentScore} from
     * {@link MultiOpponentEvaluator} too.
     *
     * <p>Body is a near-verbatim copy of upstream
     * {@code ComputerPlayer7.calculateActions} — only the
     * {@code currentScore = ...} line is changed. {@code addActionsTimed()}
     * (protected, inherited) recurses into our overridden
     * {@code addActions}.
     */
    @Override
    protected void calculateActions(Game game) {
        if (!getNextAction(game)) {
            currentScore = MultiOpponentEvaluator.evaluate(playerId, game);
            Game sim = createSimulation(game);
            SimulationNode2.resetCount();
            root = new SimulationNode2(null, sim, maxDepth, playerId);
            addActionsTimed();
            if (root != null && root.getChildren() != null && !root.getChildren().isEmpty()) {
                log.trace("After add actions timed: root.children.size = " + root.getChildren().size());
                root = root.getChildren().get(0);

                // prevent repeating always the same action with no cost
                boolean doThis = true;
                java.util.List<Ability> rootAbilities = root.getAbilities();
                if (rootAbilities != null && rootAbilities.size() == 1) {
                    for (Ability ability : rootAbilities) {
                        if (ability.getManaCosts().manaValue() == 0
                                && ability.getCosts().isEmpty()) {
                            if (actionCache.contains(ability.getRule() + '_' + ability.getSourceId())) {
                                doThis = false; // don't do it again
                            }
                        }
                    }
                }

                if (doThis && rootAbilities != null) {
                    actions = new LinkedList<>(rootAbilities);
                    combat = root.getCombat();
                    for (Ability ability : actions) {
                        actionCache.add(ability.getRule() + '_' + ability.getSourceId());
                    }
                }
            } else {
                // nothing to choose or freeze/infinite game
                log.info("AI player can't find next action: " + getName());
            }
        } else {
            log.debug("Next Action exists!");
        }
    }
}
