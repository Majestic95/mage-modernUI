package mage.webapi.ai;

import mage.constants.CommanderCardType;
import mage.filter.StaticFilters;
import mage.game.Game;
import mage.game.combat.Combat;
import mage.game.permanent.Permanent;
import mage.player.ai.util.CombatUtil;
import mage.players.Player;
import org.apache.log4j.Logger;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Stateless helper extracted from {@code CommanderComputerPlayer7}
 * for the AI-8.4 selectAttackers lethal pre-check.
 *
 * <p>Iterates each opponent (NOT just iterator-first — fixes the
 * upstream multi-player attack-target bug at
 * {@code SimulatedPlayer2.java:240}). For each, runs upstream
 * {@link CombatUtil#canKillOpponent} for life-loss lethal AND a
 * commander-damage check (CR 903.14a — 21 unblockable commander
 * damage from a single commander wins regardless of life). On
 * first lethal hit: declares those attackers and returns true.
 *
 * <h2>AI-8.5 fixes baked in</h2>
 *
 * <ul>
 *   <li><b>C2:</b> commander-damage lethal path. AI-8.1 tracks
 *       commander damage but AI-8.4 didn't query it for lethal.
 *       Now: opp at 25 life with 16 commander damage taken + a
 *       5-power unblockable commander attack = lethal (16+5=21).</li>
 *   <li><b>C3:</b> {@code opp.canLose(game)} pre-check skips
 *       opponents under "can't lose the game" effects (Platinum
 *       Angel, Phyrexian Unlife with no poison, Worship — though
 *       Worship's "can't take fatal damage" is more complex and
 *       canLose may not capture it perfectly).</li>
 * </ul>
 */
final class CommanderLethalShortCircuit {

    private static final Logger log = Logger.getLogger(CommanderLethalShortCircuit.class);

    /** CR 903.14a — same constant as {@link CommanderTargetingHeuristic}. */
    private static final int COMMANDER_DAMAGE_LETHAL = 21;

    private CommanderLethalShortCircuit() {
        // helper-only; do not instantiate
    }

    /**
     * Returns true iff a lethal attack was found AND successfully
     * declared. On any per-attacker {@code declareAttacker} failure:
     * returns false (caller defers to super).
     */
    static boolean tryLethalShortCircuit(UUID playerId, String aiName, Game game) {
        Combat combat = game.getCombat();
        if (combat == null) {
            return false;
        }
        Set<UUID> opponents = game.getOpponents(playerId);
        if (opponents == null || opponents.isEmpty()) {
            return false;
        }
        List<Permanent> myCreatures = game.getBattlefield().getActivePermanents(
                StaticFilters.FILTER_PERMANENT_CREATURE, playerId, game);
        if (myCreatures == null || myCreatures.isEmpty()) {
            return false;
        }
        Set<UUID> myCommanderIds = commanderIdsOf(playerId, game);
        for (UUID oppId : opponents) {
            Player opp = game.getPlayer(oppId);
            if (opp == null || !opp.isInGame()) {
                continue;
            }
            // C3: skip opponents under "can't lose" effects so the
            // AI doesn't commit its whole board against a Platinum
            // Angel only to lose tempo to the next sweeper.
            if (!opp.canLose(game)) {
                continue;
            }
            List<Permanent> attackersForThisOpp = filterAttackersAgainst(myCreatures, oppId, game);
            if (attackersForThisOpp.isEmpty()) {
                continue;
            }
            List<Permanent> blockers = game.getBattlefield().getActivePermanents(
                    StaticFilters.FILTER_PERMANENT_CREATURE, oppId, game);
            if (blockers == null) {
                blockers = Collections.emptyList();
            }

            // Path 1 — life-loss lethal via upstream helper.
            List<Permanent> lethalSet = CombatUtil.canKillOpponent(
                    game, attackersForThisOpp, blockers, opp);
            if (lethalSet != null && !lethalSet.isEmpty()) {
                if (declareAll(combat, lethalSet, oppId, playerId, game)) {
                    log.info(String.format(
                            "AI '%s' lethal short-circuit (life): attacking %s with %d creatures.",
                            aiName, opp.getName(), lethalSet.size()));
                    return true;
                }
                return false;
            }

            // Path 2 — commander-damage lethal (CR 903.14a). For
            // each of our commanders that can attack THIS opponent
            // unblockably, check whether one swing pushes the
            // running commander-damage tally to 21+.
            Permanent killingCommander = findCommanderDamageLethal(
                    playerId, oppId, attackersForThisOpp, blockers, myCommanderIds, game);
            if (killingCommander != null) {
                if (combat.declareAttacker(killingCommander.getId(), oppId, playerId, game)) {
                    log.info(String.format(
                            "AI '%s' lethal short-circuit (commander damage): attacking %s with %s.",
                            aiName, opp.getName(), killingCommander.getName()));
                    return true;
                }
                return false;
            }
        }
        return false;
    }

    private static List<Permanent> filterAttackersAgainst(List<Permanent> all,
                                                           UUID defenderId, Game game) {
        List<Permanent> out = new ArrayList<>(all.size());
        for (Permanent p : all) {
            if (p.canAttack(defenderId, game)) {
                out.add(p);
            }
        }
        return out;
    }

    /**
     * Declares every attacker in {@code attackers} against the same
     * {@code defenderId}. On any per-attacker failure: rolls back the
     * already-declared attackers via
     * {@link Combat#removeAttacker(UUID, Game)} so the parent's
     * {@code super.selectAttackers} call sees a clean combat state
     * rather than a half-committed lethal swing.
     *
     * <p><b>AI-8.6 H2 fix:</b> previously we returned false on
     * mid-loop failure but left the partially-declared attackers in
     * combat. The caller would then defer to super, which would
     * re-enumerate attackers on top of our dirty partial state.
     */
    private static boolean declareAll(Combat combat, List<Permanent> attackers,
                                       UUID defenderId, UUID playerId, Game game) {
        List<UUID> declared = new ArrayList<>(attackers.size());
        for (Permanent attacker : attackers) {
            if (!combat.declareAttacker(attacker.getId(), defenderId, playerId, game)) {
                for (UUID priorId : declared) {
                    combat.removeAttacker(priorId, game);
                }
                return false;
            }
            declared.add(attacker.getId());
        }
        return true;
    }

    private static Set<UUID> commanderIdsOf(UUID playerId, Game game) {
        Player me = game.getPlayer(playerId);
        if (me == null) {
            return Collections.emptySet();
        }
        Set<UUID> ids = game.getCommandersIds(
                me, CommanderCardType.COMMANDER_OR_OATHBREAKER, false);
        return ids == null ? Collections.emptySet() : ids;
    }

    /**
     * Finds an unblockable commander attack that pushes
     * commander-damage from this commander to 21+. Returns the
     * lethal commander or null. Conservative — only counts if the
     * attacker is unblockable (no opponent creature can block it),
     * since blocked combat damage to the player is 0.
     */
    private static Permanent findCommanderDamageLethal(UUID playerId, UUID oppId,
                                                        List<Permanent> attackers,
                                                        List<Permanent> blockers,
                                                        Set<UUID> myCommanderIds,
                                                        Game game) {
        if (myCommanderIds.isEmpty()) {
            return null;
        }
        for (Permanent attacker : attackers) {
            UUID mainCardId = attacker.getMainCard() == null
                    ? attacker.getId()
                    : attacker.getMainCard().getId();
            if (!myCommanderIds.contains(mainCardId)) {
                continue;
            }
            if (CombatUtil.canBeBlocked(game, attacker, blockers)) {
                continue;
            }
            int alreadyDealt = CommanderTargetingHeuristic
                    .maxCommanderDamageDealtBy(playerId, oppId, game);
            if (alreadyDealt + attacker.getPower().getValue() >= COMMANDER_DAMAGE_LETHAL) {
                return attacker;
            }
        }
        return null;
    }
}
