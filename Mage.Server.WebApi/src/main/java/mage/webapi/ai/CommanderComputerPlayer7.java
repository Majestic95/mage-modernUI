package mage.webapi.ai;

import mage.abilities.Ability;
import mage.constants.Outcome;
import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.target.Target;
import org.apache.log4j.Logger;

import java.util.UUID;

/**
 * Commander-format-aware AI player. Subclasses
 * {@link CommanderSearchTreeOverride} (our intermediate class that
 * owns the AI-9 search-tree leaf evaluator wrap), which in turn
 * subclasses upstream {@code ComputerPlayerControllableProxy} (which
 * extends {@code ComputerPlayer7}, the MAD minimax bot). This class
 * adds the per-decision-point heuristics on top.
 *
 * <p>Registered at {@code EmbeddedServer.boot()} time as the
 * {@code "Computer - mad"} handler — overrides the default
 * registration supplied by upstream's {@code config.xml}. Existing
 * flows that spawn AI seats via {@code COMPUTER_MAD} pick up this
 * subclass automatically.
 *
 * <h2>Why subclass, not patch upstream?</h2>
 *
 * Per CLAUDE.md hard constraint: upstream is read-only. Override via
 * subclass means our edits survive every upstream rebase as long as
 * the public method signatures we override don't drift.
 *
 * <h2>Architecture (post-AI-8.5 split)</h2>
 *
 * Heuristic logic lives in four sibling helper classes — this file
 * is the orchestrator that owns the override surface and the
 * telemetry state. Each helper is stateless / static-only so the
 * simulation cloning path doesn't need to copy heuristic state.
 *
 * <ul>
 *   <li>{@link CommanderTargetingHeuristic} — chooseTarget bias
 *       (lowest-life + commander-damage clock).</li>
 *   <li>{@link CommanderActionFilter} — act() filter (don't recast
 *       into tax hell; don't wipe own board).</li>
 *   <li>{@link CommanderLethalShortCircuit} — selectAttackers
 *       lethal pre-check (life + commander-damage paths).</li>
 *   <li>{@link MultiOpponentEvaluator} — multi-opponent
 *       threat-weighted leaf evaluator (AI-9 / Tier 2 #7 + #8).</li>
 * </ul>
 *
 * <h2>Behavior delta vs. upstream MAD</h2>
 *
 * <ul>
 *   <li><b>Lowest-life targeting</b> (AI-8.0). For harmful single-
 *       opponent effects, pick the player at lowest life rather than
 *       the iterator-first opponent.</li>
 *   <li><b>Commander damage finisher bias</b> (AI-8.1; AI-8.5 fix).
 *       Score = lowest {@code min(life, 21 - maxCommanderDamageDealt)}.
 *       Per-commander max (CR 903.14a), not summed across partners.</li>
 *   <li><b>Empty-tree-bug telemetry</b> (AI-8.2). Counts priority
 *       handoffs vs. actions per turn; logs WARN on the empty-tree
 *       bug signature ({@code ComputerPlayer7.java:119}).</li>
 *   <li><b>Don't recast commander into tax hell</b> (AI-8.3). Drops
 *       command-zone spell-abilities at tax ≥ 8.</li>
 *   <li><b>Don't wipe own board</b> (AI-8.3; AI-8.6 H3 fix). Drops
 *       {@code DestroyAll}/{@code DamageAll}/{@code ExileAll} when
 *       we'd lose strictly more than the sum of the rest of the
 *       table's losses.</li>
 *   <li><b>Lethal short-circuit</b> (AI-8.4; AI-8.5 fix). Walks
 *       all opponents, checks both life-loss lethal AND commander-
 *       damage lethal, skips opponents under "can't lose" effects.</li>
 *   <li><b>Multi-opponent threat-weighted leaf scoring</b> (AI-9 /
 *       Tier 2 #7). Every minimax search-tree leaf scores against
 *       <i>all</i> opponents weighted by threat (low life × 1.5, big
 *       board × 1.2, has commander out × 1.3) — replaces upstream's
 *       iterator-first single-opponent evaluator at every leaf the
 *       overridden {@code addActions} reaches. Plus per-card hand
 *       quality scoring (Tier 2 #8) — drawing a Craterhoof no
 *       longer scores the same as drawing a Forest.</li>
 * </ul>
 *
 * <h2>Defensive guards baked in (AI-8.5 fix C4)</h2>
 *
 * Every override checks {@link #isGameUnderControl()} and defers to
 * super when a human has taken control of this AI seat via the
 * proxy mechanism. Without this guard, our lethal short-circuit
 * could declare attackers on a human's behalf without asking them.
 *
 * <p>See {@code docs/design/ai-upgrades.md} for the full upgrade
 * roadmap and {@code docs/decisions/critic-pass-log.md} for the
 * AI-8.5 critic findings that drove the post-Tier-1 fixes.
 */
public class CommanderComputerPlayer7 extends CommanderSearchTreeOverride {

    private static final Logger log = Logger.getLogger(CommanderComputerPlayer7.class);

    /**
     * AI-8.2 telemetry — pass count above which we suspect the
     * upstream empty-tree bug ({@code ComputerPlayer7.java:119}) is
     * firing rather than legitimate "I have nothing to do" passes.
     * Tuned high enough that normal turn cycles (untap/upkeep/draw/
     * combat-step passes) don't trigger it.
     */
    private static final int EMPTY_TREE_WARN_THRESHOLD = 20;

    private long lastObservedTurnHash = -1L;
    /**
     * AI-8.6 H5 — track the turn number we last observed separately
     * from the (turn,player)-hash so {@code maybeWarnEmptyTree} can
     * log the turn the bug fired ON, not the turn we just transitioned
     * INTO. Defaults to -1 so the first-ever transition is recognized
     * as a boundary.
     */
    private int lastObservedTurnNum = -1;
    private int passesThisTurn = 0;
    private int actionsThisTurn = 0;

    public CommanderComputerPlayer7(String name, RangeOfInfluence range, int skill) {
        super(name, range, skill);
    }

    public CommanderComputerPlayer7(final CommanderComputerPlayer7 player) {
        super(player);
        this.lastObservedTurnHash = player.lastObservedTurnHash;
        this.lastObservedTurnNum = player.lastObservedTurnNum;
        this.passesThisTurn = player.passesThisTurn;
        this.actionsThisTurn = player.actionsThisTurn;
    }

    @Override
    public CommanderComputerPlayer7 copy() {
        return new CommanderComputerPlayer7(this);
    }

    /**
     * Pre-empt the parent's target-picker with the
     * {@link CommanderTargetingHeuristic}. Fires only when:
     * <ul>
     *   <li>This AI seat is under AI control (not taken over by a
     *       human via the proxy — AI-8.5 fix C4).</li>
     *   <li>The heuristic returns a candidate.</li>
     *   <li>That candidate is currently a legal target via
     *       {@link Target#canTarget(UUID, UUID, Ability, Game)} —
     *       AI-8.5 fix C5. Without this validation, hexproof
     *       granted by an aura we missed could cause
     *       {@code target.add} to no-op while we still return true,
     *       fizzling the spell.</li>
     *   <li>{@code target.add} actually registered the candidate
     *       (post-add containment check — AI-8.5 fix C5).</li>
     * </ul>
     * Any failure falls through to super.
     */
    @Override
    public boolean chooseTarget(Outcome outcome, Target target, Ability source, Game game) {
        if (isGameUnderControl()) {
            UUID picked = CommanderTargetingHeuristic.pickThreatTarget(
                    playerId, outcome, target, source, game);
            if (picked != null
                    && target.canTarget(playerId, picked, source, game)) {
                target.add(picked, game);
                if (target.getTargets().contains(picked)) {
                    return true;
                }
                // target.add silently rejected — fall through to super.
            }
        }
        return super.chooseTarget(outcome, target, source, game);
    }

    /**
     * AI-8.2 telemetry + AI-8.3 filter. Skips both in simulation
     * contexts (AI's own search-tree calls would flood with false
     * positives) AND when a human has taken over this seat
     * (AI-8.5 fix C4).
     */
    @Override
    protected void act(Game game) {
        if (game.isSimulation() || !isGameUnderControl()) {
            super.act(game);
            return;
        }
        long currentTurnHash = computeTurnHash(game);
        if (currentTurnHash != lastObservedTurnHash) {
            // Turn boundary — emit the prior turn's WARN if it
            // matches the empty-tree signature, then reset counters.
            maybeWarnEmptyTree(lastObservedTurnNum);
            lastObservedTurnHash = currentTurnHash;
            lastObservedTurnNum = game.getState().getTurnNum();
            passesThisTurn = 0;
            actionsThisTurn = 0;
        }
        // AI-8.3 — filter the action queue BEFORE the parent invokes
        // each ability. Drops entries that match unsafe patterns.
        CommanderActionFilter.filterUnsafeActions(actions, playerId, getName(), game);
        int actionsBefore = actions == null ? 0 : actions.size();
        super.act(game);
        int actionsAfter = actions == null ? 0 : actions.size();
        if (actionsBefore == 0 && actionsAfter == 0) {
            passesThisTurn++;
        } else {
            actionsThisTurn += Math.max(0, actionsBefore - actionsAfter);
        }
    }

    /**
     * AI-8.4 lethal short-circuit. Skips both in simulation contexts
     * AND when a human has taken over this seat (AI-8.5 fix C4) —
     * declaring attackers without asking the human would be a
     * serious UX bug.
     */
    @Override
    public void selectAttackers(Game game, UUID attackingPlayerId) {
        if (!game.isSimulation()
                && isGameUnderControl()
                && playerId.equals(attackingPlayerId)
                && CommanderLethalShortCircuit.tryLethalShortCircuit(playerId, getName(), game)) {
            return;
        }
        super.selectAttackers(game, attackingPlayerId);
    }

    // ---- telemetry helpers -------------------------------------------

    private long computeTurnHash(Game game) {
        UUID activeId = game.getActivePlayerId();
        int turnNum = game.getState().getTurnNum();
        return ((long) turnNum) * 0x100000000L
                ^ (activeId == null ? 0L : activeId.hashCode());
    }

    /**
     * Emits a WARN when the prior turn matched the empty-tree-bug
     * signature (≥ {@link #EMPTY_TREE_WARN_THRESHOLD} priority handoffs
     * with zero actions taken). The {@code priorTurnNum} parameter is
     * the turn the bug fired on — captured BEFORE the boundary
     * transition so the message identifies the right turn rather than
     * the turn we just crossed into (AI-8.6 H5 fix). Skipped on the
     * first-ever observation when {@code priorTurnNum} is still -1.
     */
    private void maybeWarnEmptyTree(int priorTurnNum) {
        if (priorTurnNum < 0) {
            return;
        }
        if (passesThisTurn >= EMPTY_TREE_WARN_THRESHOLD && actionsThisTurn == 0) {
            log.warn(String.format(
                    "AI '%s' passed priority %d times during turn %d without "
                            + "producing any action — possible empty-tree bug "
                            + "(ComputerPlayer7.java:119).",
                    getName(), passesThisTurn, priorTurnNum));
        }
    }
}
