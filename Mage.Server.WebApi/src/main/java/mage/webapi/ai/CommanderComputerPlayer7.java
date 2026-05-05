package mage.webapi.ai;

import mage.abilities.Ability;
import mage.constants.Outcome;
import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.player.ai.ComputerPlayerControllableProxy;
import mage.players.Player;
import mage.target.Target;

import java.util.Set;
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
 * <h2>Behavior delta vs. upstream MAD</h2>
 *
 * <ul>
 *   <li><b>Lowest-life targeting</b> (AI-8.0). When the AI must
 *       choose a single opponent for a harmful effect (burn,
 *       destroy, discard, etc.), pick the player at lowest life
 *       rather than whichever opponent the iterator returned first.
 *       Roughly mirrors the human heuristic of "go after the bully"
 *       / "finish the player closest to dead." The upstream
 *       evaluator literally only models one opponent (see
 *       {@code GameStateEvaluator2.java:35}'s {@code findFirst()})
 *       so the iterator's pick is essentially random in 4-player
 *       Commander.</li>
 * </ul>
 *
 * Future heuristics (commander damage tracking, recast-tax
 * thresholds, board-wipe sanity, lethal short-circuit, telemetry)
 * land in subsequent slices — see
 * {@code docs/design/ai-upgrades.md} for the full upgrade menu.
 */
public class CommanderComputerPlayer7 extends ComputerPlayerControllableProxy {

    public CommanderComputerPlayer7(String name, RangeOfInfluence range, int skill) {
        super(name, range, skill);
    }

    public CommanderComputerPlayer7(final CommanderComputerPlayer7 player) {
        super(player);
    }

    @Override
    public CommanderComputerPlayer7 copy() {
        return new CommanderComputerPlayer7(this);
    }

    /**
     * Pre-empt the parent's target-picker with a Commander-aware
     * heuristic: when the effect is harmful AND constrained to a
     * single opponent, pick the lowest-life opponent. Defers to
     * super for every other case (multi-target, beneficial,
     * non-player, mixed-candidate sets, etc.) so the existing
     * minimax-driven decisions are preserved everywhere this
     * heuristic doesn't apply.
     *
     * <p>Defensive — any unexpected state (null candidates, no
     * opponent matches, etc.) falls through to super.
     */
    @Override
    public boolean chooseTarget(Outcome outcome, Target target, Ability source, Game game) {
        UUID picked = pickLowestLifeOpponentIfApplicable(outcome, target, source, game);
        if (picked != null) {
            target.add(picked, game);
            return true;
        }
        return super.chooseTarget(outcome, target, source, game);
    }

    /**
     * Returns the lowest-life opponent's UUID iff this target matches
     * the "harmful, single-opponent, opponent-only-candidates" shape;
     * otherwise returns null (caller falls through to super).
     *
     * <p>Package-private for unit-testability without exposing the
     * predicate to production callers.
     */
    UUID pickLowestLifeOpponentIfApplicable(Outcome outcome, Target target,
                                             Ability source, Game game) {
        if (outcome == null || outcome.isGood()) {
            return null;
        }
        if (target.getMaxNumberOfTargets() != 1 || target.getMinNumberOfTargets() != 1) {
            return null;
        }
        Set<UUID> candidates = target.possibleTargets(playerId, source, game);
        if (candidates == null || candidates.isEmpty()) {
            return null;
        }
        Set<UUID> opponents = game.getOpponents(playerId);
        if (opponents == null || opponents.isEmpty()) {
            return null;
        }
        // Heuristic ONLY applies when EVERY candidate is an opponent.
        // Mixed-candidate effects (e.g., "any target" — could be a
        // creature) keep the upstream evaluator's per-target scoring.
        if (!opponents.containsAll(candidates)) {
            return null;
        }
        UUID lowest = null;
        int lowestLife = Integer.MAX_VALUE;
        for (UUID candidate : candidates) {
            Player p = game.getPlayer(candidate);
            if (p == null || !p.isInGame()) {
                continue;
            }
            int life = p.getLife();
            if (life < lowestLife) {
                lowestLife = life;
                lowest = candidate;
            }
        }
        return lowest;
    }
}
