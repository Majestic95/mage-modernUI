package mage.webapi.ai;

import mage.abilities.Ability;
import mage.constants.CommanderCardType;
import mage.constants.Outcome;
import mage.constants.RangeOfInfluence;
import mage.game.Game;
import mage.player.ai.ComputerPlayerControllableProxy;
import mage.players.Player;
import mage.target.Target;
import mage.watchers.common.CommanderInfoWatcher;

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
 *       rather than whichever opponent the iterator returned first.</li>
 *   <li><b>Commander damage finisher bias</b> (AI-8.1). Same
 *       targeting hook, but the score now considers the secondary
 *       Commander win condition: 21 commander damage from a single
 *       commander is lethal regardless of life total. The score
 *       function picks the opponent with the lowest
 *       {@code min(life, 21 - commanderDamageDealtFromOurCommander)} —
 *       i.e., whoever is closest to losing by EITHER clock. An
 *       opponent at 40 life who has taken 16 commander damage from
 *       us scores 5 (ahead of an opponent at 8 life who has taken
 *       0 commander damage, who scores 8). Pile on the closer kill.</li>
 * </ul>
 *
 * Future heuristics (recast-tax thresholds, board-wipe sanity,
 * lethal short-circuit, telemetry) land in subsequent slices — see
 * {@code docs/design/ai-upgrades.md} for the full upgrade menu.
 */
public class CommanderComputerPlayer7 extends ComputerPlayerControllableProxy {

    /**
     * 21 combat damage from a single commander loses the game per
     * CR 903.14a. The targeting heuristic uses this to score how
     * close an opponent is to a Commander-damage loss vs. a normal
     * life-loss kill — whichever is closer wins.
     */
    private static final int COMMANDER_DAMAGE_LETHAL = 21;

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
        UUID picked = pickThreatTargetIfApplicable(outcome, target, source, game);
        if (picked != null) {
            target.add(picked, game);
            return true;
        }
        return super.chooseTarget(outcome, target, source, game);
    }

    /**
     * Returns the most threatening opponent's UUID iff this target
     * matches the "harmful, single-opponent, opponent-only-candidates"
     * shape; otherwise returns null (caller falls through to super).
     *
     * <p>"Most threatening" = lowest {@link #effectiveLifeRemaining}
     * — the smaller of (real life total) and (21 minus commander
     * damage we've dealt to them). Picks whoever is closest to
     * losing by either the regular life-loss clock or the Commander
     * 21-damage clock.
     *
     * <p>Package-private for unit-testability without exposing the
     * predicate to production callers.
     */
    UUID pickThreatTargetIfApplicable(Outcome outcome, Target target,
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
        UUID best = null;
        int bestEffectiveLife = Integer.MAX_VALUE;
        for (UUID candidate : candidates) {
            Player p = game.getPlayer(candidate);
            if (p == null || !p.isInGame()) {
                continue;
            }
            int effectiveLife = effectiveLifeRemaining(p, candidate, game);
            if (effectiveLife < bestEffectiveLife) {
                bestEffectiveLife = effectiveLife;
                best = candidate;
            }
        }
        return best;
    }

    /**
     * The "damage to losing the game" score. The smaller of the two
     * clocks an opponent can lose to:
     * <ul>
     *   <li>Regular life loss: their current life total.</li>
     *   <li>Commander damage: 21 minus the combat damage our
     *       commander(s) have already dealt them
     *       (CR 903.14a).</li>
     * </ul>
     *
     * <p>For early-game state with no commander damage dealt, this
     * collapses to the AI-8.0 lowest-life behavior (40-life
     * opponents all score 21, then real life total once it drops
     * below 21). As we connect commander hits, the commander-damage
     * clock for that specific opponent becomes the dominant score
     * and the AI focuses fire to close out the kill.
     */
    private int effectiveLifeRemaining(Player opponent, UUID opponentId, Game game) {
        int life = opponent.getLife();
        int dealt = commanderDamageDealtTo(opponentId, game);
        int commanderClockRemaining = COMMANDER_DAMAGE_LETHAL - dealt;
        if (commanderClockRemaining < 0) {
            commanderClockRemaining = 0;
        }
        return Math.min(life, commanderClockRemaining);
    }

    /**
     * Combat damage our commander(s) have dealt to {@code opponentId}.
     * Reads from the per-commander {@link CommanderInfoWatcher} that
     * upstream registers in {@code GameCommanderImpl.initCommanderWatcher}.
     * Sums across all our commanders so partner pairs share the
     * damage clock correctly.
     *
     * <p>Defensive against:
     * <ul>
     *   <li>Non-Commander game shape — {@code getCommandersIds}
     *       returns empty set, total = 0, falls back to lowest-life
     *       behavior.</li>
     *   <li>Watcher missing for a given commander — null-checked,
     *       skipped silently.</li>
     *   <li>Damage map missing the opponent key — getOrDefault 0.</li>
     * </ul>
     *
     * <p>Package-private for unit-testability.
     */
    int commanderDamageDealtTo(UUID opponentId, Game game) {
        Player me = game.getPlayer(playerId);
        if (me == null) {
            return 0;
        }
        Set<UUID> myCommanders = game.getCommandersIds(
                me, CommanderCardType.COMMANDER_OR_OATHBREAKER, false);
        if (myCommanders == null || myCommanders.isEmpty()) {
            return 0;
        }
        int total = 0;
        for (UUID commanderId : myCommanders) {
            CommanderInfoWatcher watcher = game.getState()
                    .getWatcher(CommanderInfoWatcher.class, commanderId);
            if (watcher == null) {
                continue;
            }
            Integer dmg = watcher.getDamageToPlayer().get(opponentId);
            if (dmg != null) {
                total += dmg;
            }
        }
        return total;
    }
}
