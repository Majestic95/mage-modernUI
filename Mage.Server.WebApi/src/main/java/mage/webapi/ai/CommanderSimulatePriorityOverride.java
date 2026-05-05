package mage.webapi.ai;

import mage.MageObject;
import mage.abilities.Ability;
import mage.abilities.ActivatedAbility;
import mage.abilities.SpellAbility;
import mage.abilities.StaticAbility;
import mage.abilities.common.PassAbility;
import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.player.ai.ComputerPlayer;
import mage.player.ai.ComputerPlayerControllableProxy;
import mage.player.ai.SimulatedPlayer2;
import mage.player.ai.SimulationNode2;
import mage.player.ai.score.GameStateEvaluator2;
import mage.players.Player;
import mage.util.RandomUtil;
import org.apache.log4j.Logger;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Intermediate class in the AI subclass chain that owns the AI-9
 * fixer's {@code simulatePriority} override. Sits between
 * {@link ComputerPlayerControllableProxy} (upstream) and
 * {@link CommanderSearchTreeOverride} (which adds {@code addActions}
 * + {@code calculateActions}) which in turn is extended by
 * {@link CommanderComputerPlayer7} (decision-point heuristics).
 *
 * <p>Extracted into its own file in the AI-9 fixer because the
 * {@code simulatePriority} body-copy adds ~180 LOC; combining with
 * the existing addActions + calculateActions overrides would push
 * {@code CommanderSearchTreeOverride} past CLAUDE.md's 400-LOC soft
 * cap.
 *
 * <h2>Why this override exists</h2>
 *
 * The initial AI-9 build only overrode {@code addActions}. The
 * agentic critic pass found that upstream {@code simulatePriority}
 * has 5 calls to {@code GameStateEvaluator2.evaluate} that bypass
 * our wrapper — 2 load-bearing (the timeout-interrupt fallback at
 * line 515 and the {@code PassAbility} terminal score at line 568)
 * and 3 log-only. Without overriding {@code simulatePriority}, the
 * minimax tree mixes single-opponent leaf scores (from upstream's
 * code path) with multi-opponent leaf scores (from
 * {@link CommanderSearchTreeOverride}'s code path) — alpha-beta
 * pruning compares incompatible scoring scales.
 *
 * <p>Additionally, {@code checkForRepeatedAction} (private upstream,
 * called from {@code simulatePriority:550}) compares pre-action vs.
 * post-action evaluations to detect repeated no-op cycles. Under
 * mixed-scale scoring, the comparison is wrong. Inlined here as
 * {@link #checkForRepeatedActionMultiOpp}.
 *
 * <h2>Body-copy vs. wrap-super</h2>
 *
 * Same rationale as {@link CommanderSearchTreeOverride}:
 * {@code simulatePriority}'s evaluator calls are scattered through
 * conditional branches; no chokepoint exists. Body-copy with the 5
 * substitutions is the least-bad option. Pin tests catch signature
 * drift on rebase; auditors must manually diff body changes.
 */
public class CommanderSimulatePriorityOverride extends ComputerPlayerControllableProxy {

    private static final Logger log = Logger.getLogger(CommanderSimulatePriorityOverride.class);
    private static final String BLANKS = "...............................................";

    public CommanderSimulatePriorityOverride(String name, RangeOfInfluence range, int skill) {
        super(name, range, skill);
    }

    public CommanderSimulatePriorityOverride(final CommanderSimulatePriorityOverride player) {
        super(player);
    }

    @Override
    public CommanderSimulatePriorityOverride copy() {
        return new CommanderSimulatePriorityOverride(this);
    }

    /**
     * AI-9 — verbatim body-copy of upstream
     * {@code ComputerPlayer6.simulatePriority} (source line
     * {@code ComputerPlayer6.java:512}, commit baseline 744fd1f4)
     * with the 5 calls to
     * {@code GameStateEvaluator2.evaluate(...).getTotalScore()}
     * replaced by {@link MultiOpponentEvaluator#evaluate(UUID, Game)}.
     * The {@code checkForRepeatedAction} call is replaced by our
     * inlined {@link #checkForRepeatedActionMultiOpp} so the
     * pre-vs-post comparison uses the same scoring scale.
     *
     * <p>Diff vs. upstream — substitutions only at the 5 evaluator
     * call sites (timeout-interrupt at L515, startedScore at L522,
     * PassAbility-terminal at L568, log-only at L611-612) and the
     * {@code checkForRepeatedAction} call at L550. Everything else
     * is byte-equivalent including the alpha-beta logic, randomized
     * tie-breaking, and node lifecycle.
     *
     * <p>Two unavoidable substitutions: (1) {@code node.children.X()}
     * direct-field access in upstream becomes {@code node.getChildren().X()}
     * via the public getter — {@code SimulationNode2.children} is
     * package-private to {@code mage.player.ai} and unreachable from
     * {@code mage.webapi.ai}; the getter returns the same backing list.
     * (2) {@code logger.X(...)} on the upstream private static logger
     * becomes {@code log.X(...)} on this class's own logger — output is
     * functionally identical, just labeled with this class name.
     */
    @Override
    protected int simulatePriority(SimulationNode2 node, Game game, int depth, int alpha, int beta) {
        if (!ComputerPlayer.COMPUTER_DISABLE_TIMEOUT_IN_GAME_SIMULATIONS
                && Thread.currentThread().isInterrupted()) {
            log.debug("AI game sim interrupted by timeout");
            return MultiOpponentEvaluator.evaluate(playerId, game);
        }
        node.setGameValue(game.getState().getValue(true).hashCode());
        SimulatedPlayer2 currentPlayer = (SimulatedPlayer2) game.getPlayer(game.getPlayerList().get());
        SimulationNode2 bestNode = null;
        List<Ability> allActions = currentPlayer.simulatePriority(game);
        optimize(game, allActions);
        int startedScore = MultiOpponentEvaluator.evaluate(this.getId(), node.getGame());
        if (log.isInfoEnabled()
                && !allActions.isEmpty()
                && depth == maxDepth) {
            log.info(String.format("POSSIBLE ACTION CHAINS for %s (%d, started score: %d)%s",
                    getName(),
                    allActions.size(),
                    startedScore,
                    (actions.isEmpty() ? "" : ":")
            ));
            for (int i = 0; i < allActions.size(); i++) {
                Ability possibleAbility = allActions.get(i);
                log.info(String.format("-> #%d (%s)", i + 1,
                        getAbilityAndSourceInfo(game, possibleAbility, true)));
            }
        }
        int actionNumber = 0;
        int bestValSubNodes = Integer.MIN_VALUE;
        for (Ability action : allActions) {
            actionNumber++;
            if (!ComputerPlayer.COMPUTER_DISABLE_TIMEOUT_IN_GAME_SIMULATIONS
                    && Thread.currentThread().isInterrupted()) {
                log.info("Sim Prio [" + depth + "] -- interrupted");
                break;
            }
            Game sim = game.createSimulationForAI();
            if (!(action instanceof StaticAbility)
                    && sim.getPlayer(currentPlayer.getId()).activateAbility((ActivatedAbility) action.copy(), sim)) {
                sim.applyEffects();
                if (checkForRepeatedActionMultiOpp(sim, node, action, currentPlayer.getId())) {
                    log.debug("Sim Prio [" + depth + "] -- repeated action: " + action);
                    continue;
                }
                if (!sim.checkIfGameIsOver()
                        && (action.isUsesStack() || action instanceof PassAbility)) {
                    UUID nextPlayerId = sim.getPlayerList().get();
                    do {
                        sim.getPlayer(nextPlayerId).pass(game);
                        nextPlayerId = sim.getPlayerList().getNext();
                    } while (!Objects.equals(nextPlayerId, this.getId()));
                }
                SimulationNode2 newNode = new SimulationNode2(node, sim, action, depth, currentPlayer.getId());
                sim.checkStateAndTriggered();
                int finalScore;
                if (action instanceof PassAbility && sim.getStack().isEmpty()) {
                    finalScore = MultiOpponentEvaluator.evaluate(this.getId(), sim);
                } else {
                    finalScore = addActions(newNode, depth - 1, alpha, beta);
                }
                log.debug("Sim Prio " + BLANKS.substring(0, 2 + (maxDepth - depth) * 3)
                        + '[' + depth + "]#" + actionNumber + " <" + finalScore + "> - (" + action + ") ");

                if (log.isInfoEnabled()
                        && depth >= maxDepth) {
                    List<SimulationNode2> fullChain = new ArrayList<>();
                    fullChain.add(newNode);
                    SimulationNode2 finalNode = newNode;
                    while (!finalNode.getChildren().isEmpty()) {
                        finalNode = finalNode.getChildren().get(0);
                        fullChain.add(finalNode);
                    }

                    log.info(String.format("Sim Prio [%d] #%d <total score diff %s (from %s to %s)>",
                            depth,
                            actionNumber,
                            printDiffScore(finalScore - startedScore),
                            printDiffScore(startedScore),
                            printDiffScore(finalScore)
                    ));

                    for (int chainIndex = 0; chainIndex < fullChain.size(); chainIndex++) {
                        SimulationNode2 currentNode = fullChain.get(chainIndex);
                        SimulationNode2 prevNode;
                        if (chainIndex == 0) {
                            prevNode = node;
                        } else {
                            prevNode = fullChain.get(chainIndex - 1);
                        }

                        int currentScoreLog = MultiOpponentEvaluator.evaluate(this.getId(), currentNode.getGame());
                        int prevScore = MultiOpponentEvaluator.evaluate(this.getId(), prevNode.getGame());

                        if (currentNode.getAbilities() != null) {
                            if (currentNode.getAbilities().size() != 1) {
                                throw new IllegalStateException("AI's simulated game must contains only one selected action, but found: "
                                        + currentNode.getAbilities());
                            }
                            if (!currentNode.getTargets().isEmpty() || !currentNode.getChoices().isEmpty()) {
                                throw new IllegalStateException("WTF, simulated abilities with targets/choices");
                            }
                            log.info(String.format("Sim Prio [%d] -> next action: [%d]<diff %s> (%s)",
                                    depth,
                                    currentNode.getDepth(),
                                    printDiffScore(currentScoreLog - prevScore),
                                    getAbilityAndSourceInfo(currentNode.getGame(),
                                            currentNode.getAbilities().get(0), true)
                            ));
                        } else if (!currentNode.getTargets().isEmpty()) {
                            String targetsInfo = currentNode.getTargets()
                                    .stream()
                                    .map(id -> {
                                        Player player = game.getPlayer(id);
                                        if (player != null) {
                                            return player.getName();
                                        }
                                        MageObject object = game.getObject(id);
                                        if (object != null) {
                                            return object.getIdName();
                                        }
                                        return "unknown";
                                    })
                                    .collect(Collectors.joining(", "));
                            log.info(String.format("Sim Prio [%d] -> with possible choices: [%d]<diff %s> (%s)",
                                    depth,
                                    currentNode.getDepth(),
                                    printDiffScore(currentScoreLog - prevScore),
                                    targetsInfo)
                            );
                        } else if (!currentNode.getChoices().isEmpty()) {
                            String choicesInfo = String.join(", ", currentNode.getChoices());
                            log.info(String.format("Sim Prio [%d] -> with possible choices (must not see that code): [%d]<diff %s> (%s)",
                                    depth,
                                    currentNode.getDepth(),
                                    printDiffScore(currentScoreLog - prevScore),
                                    choicesInfo)
                            );
                        } else {
                            log.info(String.format("Sim Prio [%d] -> with do nothing: [%d]<diff %s>",
                                    depth,
                                    currentNode.getDepth(),
                                    printDiffScore(currentScoreLog - prevScore))
                            );
                        }
                    }
                }

                if (currentPlayer.getId().equals(playerId)) {
                    if (finalScore > bestValSubNodes) {
                        bestValSubNodes = finalScore;
                    }
                    if (depth == maxDepth
                            && action instanceof PassAbility) {
                        finalScore = finalScore - ComputerPlayer.PASSIVITY_PENALTY;
                    }
                    if (finalScore > alpha
                            || (depth == maxDepth
                            && finalScore == alpha
                            && RandomUtil.nextBoolean())) {
                        alpha = finalScore;
                        bestNode = newNode;
                        bestNode.setScore(finalScore);
                        if (!newNode.getChildren().isEmpty()) {
                            bestNode.setCombat(newNode.getChildren().get(0).getCombat());
                        }

                        if (depth == maxDepth) {
                            log.info("Sim Prio [" + depth + "] -* BEST actions chain so far: <final score "
                                    + bestNode.getScore() + ">");
                            node.getChildren().clear();
                            node.getChildren().add(bestNode);
                            node.setScore(bestNode.getScore());
                        }
                    }

                    if (finalScore == GameStateEvaluator2.WIN_GAME_SCORE) {
                        log.debug("Sim Prio -- win - break");
                        break;
                    }
                } else {
                    if (finalScore < beta) {
                        beta = finalScore;
                        bestNode = newNode;
                        bestNode.setScore(finalScore);
                        if (!newNode.getChildren().isEmpty()) {
                            bestNode.setCombat(newNode.getChildren().get(0).getCombat());
                        }
                    }

                    if (finalScore == GameStateEvaluator2.LOSE_GAME_SCORE) {
                        log.debug("Sim Prio -- lose - break");
                        break;
                    }
                }
                if (alpha >= beta) {
                    break;
                }
                if (SimulationNode2.getCount() > CommanderSearchTreeOverride.MAX_SIMULATED_NODES_PER_ERROR_PIN) {
                    throw new IllegalStateException("AI ERROR: too many nodes (possible actions)");
                }
                if (SimulationNode2.getCount() > maxNodes) {
                    log.debug("Sim Prio -- reached end-state");
                    break;
                }
            }
        }

        if (depth == maxDepth) {
            log.info("Sim Prio [" + depth + "] ## Ended due max actions chain depth limit ("
                    + maxDepth + ") -- Nodes calculated: " + SimulationNode2.getCount());
        }
        if (bestNode != null) {
            node.getChildren().clear();
            node.getChildren().add(bestNode);
            node.setScore(bestNode.getScore());
            if (log.isTraceEnabled()
                    && !bestNode.getAbilities().toString().equals("[Pass]")) {
                log.trace(new StringBuilder("Sim Prio [").append(depth).append("] -- Set after (depth=")
                        .append(depth).append(")  <").append(bestNode.getScore()).append("> ")
                        .append(bestNode.getAbilities().toString()).toString());
            }
        }

        if (currentPlayer.getId().equals(playerId)) {
            return bestValSubNodes;
        } else {
            return beta;
        }
    }

    /**
     * AI-9 — inlined copy of upstream
     * {@code ComputerPlayer6.checkForRepeatedAction} (private at
     * source line {@code ComputerPlayer6.java:1217}) with the two
     * {@code GameStateEvaluator2.evaluate(...).getTotalScore()} calls
     * replaced by {@link MultiOpponentEvaluator#evaluate(UUID, Game)}.
     *
     * <p>Detects repeated no-op cycles (e.g., AI activating + then
     * passing on the same ability with no score change). Under
     * mixed-scale scoring the comparison would compare a multi-opp
     * post-score against a single-opp pre-score and incorrectly
     * report progress (or lack thereof). Same scale on both sides
     * keeps the cycle detector working.
     */
    private boolean checkForRepeatedActionMultiOpp(Game sim, SimulationNode2 node,
                                                    Ability action, UUID forPlayerId) {
        if (action instanceof PassAbility || action instanceof SpellAbility || action.isManaAbility()) {
            return false;
        }
        int newVal = MultiOpponentEvaluator.evaluate(forPlayerId, sim);
        SimulationNode2 test = node.getParent();
        while (test != null) {
            if (test.getPlayerId().equals(forPlayerId)) {
                if (test.getAbilities() != null && test.getAbilities().size() == 1) {
                    if (action.toString().equals(test.getAbilities().get(0).toString())) {
                        if (test.getParent() != null) {
                            Game prevGame = node.getGame();
                            if (prevGame != null) {
                                int oldVal = MultiOpponentEvaluator.evaluate(forPlayerId, prevGame);
                                if (oldVal >= newVal) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            test = test.getParent();
        }
        return false;
    }

    /**
     * AI-9 — locally-reimplemented copy of upstream's private
     * {@code printDiffScore} helper (ComputerPlayer6.java:803),
     * unreachable from our package. Used only by simulatePriority
     * log lines; behavior matches upstream's "+5" / "-3" / "0"
     * formatting.
     */
    private static String printDiffScore(int score) {
        // Match upstream's `score >= 0 → "+0"` semantics
        // (ComputerPlayer6.java:803-808).
        if (score >= 0) {
            return "+" + score;
        }
        return Integer.toString(score);
    }
}
