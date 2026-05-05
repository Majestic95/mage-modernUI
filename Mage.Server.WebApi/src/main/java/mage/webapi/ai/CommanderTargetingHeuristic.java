package mage.webapi.ai;

import mage.abilities.Ability;
import mage.constants.CommanderCardType;
import mage.constants.Outcome;
import mage.game.Game;
import mage.players.Player;
import mage.target.Target;
import mage.watchers.common.CommanderInfoWatcher;

import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

/**
 * Stateless helper extracted from {@code CommanderComputerPlayer7}
 * for the AI-8.0 / AI-8.1 chooseTarget bias logic. Picks the most
 * threatening opponent for harmful single-target effects.
 *
 * <p>Score = lowest {@code min(life, 21 - maxCommanderDamageDealt)}
 * — the smaller of the regular-life-loss clock and the Commander
 * 21-damage clock per CR 903.14a. Whichever is closer to lethal
 * wins the targeting decision.
 *
 * <p><b>AI-8.5 fix C1:</b> commander damage is now {@code max} across
 * our commanders, not {@code sum}. CR 903.14a is per-commander —
 * a partner pair where Commander A dealt 10 and Commander B dealt 12
 * has zero risk of a 21-damage loss; previous summing logic
 * incorrectly reported 22 damage and treated the opponent as
 * effectively dead.
 *
 * <p><b>AI-8.5 fix C5:</b> caller is responsible for verifying
 * {@code target.canTarget(playerId, picked, source, game)} before
 * adding to the target list — see
 * {@code CommanderComputerPlayer7.chooseTarget}.
 */
final class CommanderTargetingHeuristic {

    /** CR 903.14a — 21 combat damage from a single commander loses the game. */
    static final int COMMANDER_DAMAGE_LETHAL = 21;

    /**
     * AI-8.6 H4 — the heuristic only fires when the spell's
     * {@link Outcome} is unambiguously bad for the targeted player.
     * Previously we used {@code !outcome.isGood()}, which includes
     * {@link Outcome#Detriment} — a catch-all "bad-for-target" tag
     * that some cards mis-apply to opponent-benefit effects (e.g.,
     * "target opponent draws three cards"). The whitelist below
     * captures the outcomes where every printed card we know of
     * harms the targeted player; anything else falls through to
     * super (upstream's iterator-first pick), strictly no worse than
     * pre-AI-8.0 behavior.
     */
    private static final Set<Outcome> OPPONENT_HARMING_OUTCOMES = EnumSet.of(
            Outcome.Damage,
            Outcome.LoseLife,
            Outcome.Discard,
            Outcome.Sacrifice
    );

    private CommanderTargetingHeuristic() {
        // helper-only; do not instantiate
    }

    /**
     * Returns the most threatening opponent's UUID iff this target
     * matches the "harmful, single-opponent, opponent-only-candidates"
     * shape; otherwise returns null (caller falls through to super).
     */
    static UUID pickThreatTarget(UUID playerId, Outcome outcome, Target target,
                                  Ability source, Game game) {
        if (outcome == null || !OPPONENT_HARMING_OUTCOMES.contains(outcome)) {
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
            int effectiveLife = effectiveLifeRemaining(playerId, p, candidate, game);
            if (effectiveLife < bestEffectiveLife) {
                bestEffectiveLife = effectiveLife;
                best = candidate;
            }
        }
        return best;
    }

    /**
     * The "damage to losing the game" score: smaller of (regular
     * life loss) and (21 minus max commander damage from any one of
     * our commanders to this opponent).
     */
    static int effectiveLifeRemaining(UUID playerId, Player opponent,
                                       UUID opponentId, Game game) {
        int life = opponent.getLife();
        int dealt = maxCommanderDamageDealtBy(playerId, opponentId, game);
        int commanderClockRemaining = COMMANDER_DAMAGE_LETHAL - dealt;
        if (commanderClockRemaining < 0) {
            commanderClockRemaining = 0;
        }
        return Math.min(life, commanderClockRemaining);
    }

    /**
     * Maximum combat damage a single one of our commanders has dealt
     * to {@code opponentId}. CR 903.14a is per-commander, so the
     * relevant number is the highest single-commander tally — not
     * the sum across partners.
     *
     * <p>Reads from the per-commander {@link CommanderInfoWatcher}
     * registered by {@code GameCommanderImpl.initCommanderWatcher}.
     *
     * <p>Defensive against:
     * <ul>
     *   <li>Non-Commander game shape — {@code getCommandersIds}
     *       returns empty set, max = 0, falls back to lowest-life.</li>
     *   <li>Watcher missing for a given commander — null-checked,
     *       skipped.</li>
     *   <li>Damage map missing the opponent key — treated as 0.</li>
     * </ul>
     */
    static int maxCommanderDamageDealtBy(UUID playerId, UUID opponentId, Game game) {
        Player me = game.getPlayer(playerId);
        if (me == null) {
            return 0;
        }
        Set<UUID> myCommanders = game.getCommandersIds(
                me, CommanderCardType.COMMANDER_OR_OATHBREAKER, false);
        if (myCommanders == null || myCommanders.isEmpty()) {
            return 0;
        }
        int max = 0;
        for (UUID commanderId : myCommanders) {
            CommanderInfoWatcher watcher = game.getState()
                    .getWatcher(CommanderInfoWatcher.class, commanderId);
            if (watcher == null) {
                continue;
            }
            Integer dmg = watcher.getDamageToPlayer().get(opponentId);
            if (dmg != null && dmg > max) {
                max = dmg;
            }
        }
        return max;
    }
}
