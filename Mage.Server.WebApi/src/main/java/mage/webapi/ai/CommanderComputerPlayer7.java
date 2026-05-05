package mage.webapi.ai;

import mage.abilities.Ability;
import mage.constants.Outcome;
import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.player.ai.ComputerPlayerControllableProxy;
import mage.target.Target;
import org.apache.log4j.Logger;

import java.util.UUID;

/**
 * Commander-format-aware AI player. Subclasses upstream
 * {@link ComputerPlayerControllableProxy} (which extends
 * {@code ComputerPlayer7}, the MAD minimax bot) and injects
 * heuristics that the upstream evaluator gets wrong in 4-player
 * free-for-all.
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
 * Heuristic logic lives in three sibling helper classes — this file
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
 *   <li><b>Don't wipe own board</b> (AI-8.3). Drops
 *       {@code DestroyAll}/{@code DamageAll}/{@code ExileAll} when
 *       we'd lose ≥ each opponent's max.</li>
 *   <li><b>Lethal short-circuit</b> (AI-8.4; AI-8.5 fix). Walks
 *       all opponents, checks both life-loss lethal AND commander-
 *       damage lethal, skips opponents under "can't lose" effects.</li>
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
public class CommanderComputerPlayer7 extends ComputerPlayerControllableProxy {

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
    private int passesThisTurn = 0;
    private int actionsThisTurn = 0;

    public CommanderComputerPlayer7(String name, RangeOfInfluence range, int skill) {
        super(name, range, skill);
    }

    public CommanderComputerPlayer7(final CommanderComputerPlayer7 player) {
        super(player);
        this.lastObservedTurnHash = player.lastObservedTurnHash;
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
            maybeWarnEmptyTree(game);
            lastObservedTurnHash = currentTurnHash;
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

    private void maybeWarnEmptyTree(Game game) {
        if (passesThisTurn >= EMPTY_TREE_WARN_THRESHOLD && actionsThisTurn == 0) {
            log.warn(String.format(
                    "AI '%s' passed priority %d times across the prior turn without "
                            + "producing any action — possible empty-tree bug "
                            + "(ComputerPlayer7.java:119). Current turn: %d.",
                    getName(), passesThisTurn, game.getState().getTurnNum()));
        }
    }
}
