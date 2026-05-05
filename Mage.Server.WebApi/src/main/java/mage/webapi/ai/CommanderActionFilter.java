package mage.webapi.ai;

import mage.abilities.Ability;
import mage.abilities.SpellAbility;
import mage.abilities.effects.Effect;
import mage.cards.Card;
import mage.constants.CommanderCardType;
import mage.constants.Zone;
import mage.filter.StaticFilters;
import mage.game.Game;
import mage.game.permanent.Permanent;
import mage.players.Player;
import mage.watchers.common.CommanderPlaysCountWatcher;
import org.apache.log4j.Logger;

import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Stateless helper extracted from {@code CommanderComputerPlayer7}
 * for the AI-8.3 action-queue filter logic. Drops queued spell
 * abilities matching unsafe patterns BEFORE the parent's
 * {@code act()} drains the queue.
 *
 * <h2>Filter rules</h2>
 *
 * <ol>
 *   <li><b>High-tax commander recast</b> — when commander tax ≥ 8
 *       (= died 4+ times). Prevents the suicide loop where a
 *       repeatedly-killed commander gets re-queued every turn.</li>
 *   <li><b>Counterproductive board wipe</b> — when the spell's
 *       effect class name contains {@code DestroyAll} /
 *       {@code DamageAll} / {@code ExileAll} AND we'd lose ≥ as
 *       many creatures as the most affected opponent AND we have
 *       ≥ 2 creatures.</li>
 * </ol>
 *
 * Both deliberately conservative — false negatives (let a
 * borderline case through) preferable to false positives (refuse
 * a legitimate finisher).
 */
final class CommanderActionFilter {

    private static final Logger log = Logger.getLogger(CommanderActionFilter.class);

    /**
     * Commander tax above which recasting is presumed unwise.
     * Tax = 2 × (prior cast count), so threshold 8 = died 4+
     * times. Each prior recast cost +2 generic, so a 4th recast
     * at base CMC 4 would cost 4+8=12 mana — almost always wrong.
     * Lower thresholds catch more cases but over-restrict
     * legitimate finisher recasts.
     */
    static final int COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD = 8;

    /**
     * Minimum number of our creatures before the board-wipe filter
     * cares about self-impact. With 0 or 1 creatures the wipe
     * either doesn't hurt us or only loses one body.
     */
    static final int BOARD_WIPE_OWN_CREATURE_FLOOR = 2;

    private CommanderActionFilter() {
        // helper-only; do not instantiate
    }

    /**
     * Walk the action queue and drop entries matching unsafe
     * patterns. Mutates {@code actions} in place via iterator-remove
     * (supported on LinkedList).
     */
    static void filterUnsafeActions(LinkedList<Ability> actions, UUID playerId,
                                     String aiName, Game game) {
        if (actions == null || actions.isEmpty()) {
            return;
        }
        Iterator<Ability> iter = actions.iterator();
        while (iter.hasNext()) {
            Ability ability = iter.next();
            if (isUnsafeCommanderRecast(ability, playerId, game)) {
                log.info(String.format(
                        "AI '%s' refusing commander recast — tax too high (threshold %d).",
                        aiName, COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD));
                iter.remove();
            } else if (isCounterproductiveBoardWipe(ability, playerId, game)) {
                log.info(String.format(
                        "AI '%s' refusing board wipe — would hurt us as much as any opponent.",
                        aiName));
                iter.remove();
            }
        }
    }

    /**
     * Detects "I'm about to cast my own commander from the command
     * zone at unsafe tax." Returns true iff the ability is a
     * {@link SpellAbility} whose source card is one of our
     * commanders, currently in {@link Zone#COMMAND}, AND the
     * commander tax (2 × prior cast count) meets or exceeds
     * {@link #COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD}.
     */
    static boolean isUnsafeCommanderRecast(Ability ability, UUID playerId, Game game) {
        if (!(ability instanceof SpellAbility)) {
            return false;
        }
        UUID sourceId = ability.getSourceId();
        if (sourceId == null) {
            return false;
        }
        Card sourceCard = game.getCard(sourceId);
        if (sourceCard == null) {
            return false;
        }
        Player me = game.getPlayer(playerId);
        if (me == null) {
            return false;
        }
        Set<UUID> myCommanders = game.getCommandersIds(
                me, CommanderCardType.COMMANDER_OR_OATHBREAKER, false);
        if (myCommanders == null
                || !myCommanders.contains(sourceCard.getMainCard().getId())) {
            return false;
        }
        // Must currently be in the command zone — non-COMMAND zone
        // means flicker/return-from-graveyard, no tax.
        if (game.getState().getZone(sourceId) != Zone.COMMAND) {
            return false;
        }
        CommanderPlaysCountWatcher watcher = game.getState()
                .getWatcher(CommanderPlaysCountWatcher.class);
        if (watcher == null) {
            return false;
        }
        // AI-8.6 H1 — verified upstream:
        // CommanderPlaysCountWatcher.watch() increments on SPELL_CAST
        // events whose origin Zone == COMMAND. The increment fires
        // when the prior cast went on the stack — so at the time we
        // inspect the action queue for the NEXT cast, getPlaysCount
        // reflects RESOLVED prior casts ONLY. Tax for this pending
        // cast = 2 × prior-casts (CR 903.8). With threshold 8 we
        // refuse on the 5th cast attempt (after 4 resolved casts;
        // = died 4+ times since the commander returns to command zone
        // each death and pays the +2-per-prior-cast tax on every recast).
        int playsCount = watcher.getPlaysCount(sourceCard.getMainCard().getId());
        int tax = 2 * playsCount;
        return tax >= COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD;
    }

    /**
     * Detects "I'm about to cast a board wipe that costs us more
     * tempo than the rest of the table combined." Looks for spell
     * abilities whose effect class names match the board-wipe pattern
     * AND our creature count satisfies the self-harm gate.
     *
     * <p><b>AI-8.6 H3 fix:</b> compare against the SUM of opponents'
     * creatures, not the MAX. Previously, an asymmetric pod (us=4,
     * opps=[4,2,0]) refused the wipe (max=4, 4 ≥ 4) even though we'd
     * lose 4 and the table loses 6 — a clearly-positive trade for us.
     * New rule: refuse only when we'd lose STRICTLY MORE than the
     * table-wide sum (we destroy more of our own board than the rest
     * of the table combined).
     */
    static boolean isCounterproductiveBoardWipe(Ability ability, UUID playerId, Game game) {
        if (!(ability instanceof SpellAbility)) {
            return false;
        }
        if (!hasBoardWipeEffect(ability)) {
            return false;
        }
        int ourCreatures = countCreaturesControlledBy(playerId, game);
        if (ourCreatures < BOARD_WIPE_OWN_CREATURE_FLOOR) {
            return false;
        }
        Set<UUID> opponents = game.getOpponents(playerId);
        if (opponents == null || opponents.isEmpty()) {
            return false;
        }
        int sumOppCreatures = 0;
        for (UUID oppId : opponents) {
            sumOppCreatures += countCreaturesControlledBy(oppId, game);
        }
        // Refuse only when our loss is strictly bigger than the rest
        // of the table's combined loss. Ties go to "wipe" — clearing
        // the table is tempo-positive for us at parity.
        return ourCreatures > sumOppCreatures;
    }

    private static boolean hasBoardWipeEffect(Ability ability) {
        for (Effect effect : ability.getEffects()) {
            String className = effect.getClass().getSimpleName();
            if (className.contains("DestroyAll")
                    || className.contains("DamageAll")
                    || className.contains("ExileAll")) {
                return true;
            }
        }
        return false;
    }

    private static int countCreaturesControlledBy(UUID controllerId, Game game) {
        List<Permanent> creatures = game.getBattlefield().getActivePermanents(
                StaticFilters.FILTER_PERMANENT_CREATURE, controllerId, game);
        return creatures == null ? 0 : creatures.size();
    }
}
