package mage.webapi.ai;

import mage.abilities.Ability;
import mage.abilities.SpellAbility;
import mage.abilities.effects.Effect;
import mage.cards.Card;
import mage.constants.CommanderCardType;
import mage.constants.Outcome;
import mage.constants.RangeOfInfluence;
import mage.constants.Zone;
import mage.filter.StaticFilters;
import mage.game.Game;
import mage.game.combat.Combat;
import mage.game.permanent.Permanent;
import mage.player.ai.ComputerPlayerControllableProxy;
import mage.player.ai.util.CombatUtil;
import mage.players.Player;
import mage.target.Target;
import mage.watchers.common.CommanderInfoWatcher;
import mage.watchers.common.CommanderPlaysCountWatcher;
import org.apache.log4j.Logger;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
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
 *       i.e., whoever is closest to losing by EITHER clock.</li>
 *   <li><b>Empty-tree-bug telemetry</b> (AI-8.2). Counts priority
 *       handoffs vs. actions executed per turn. Logs a WARN when
 *       a turn elapses with N consecutive passes and 0 actions —
 *       the structural signature of the upstream empty-tree bug
 *       at {@code ComputerPlayer7.java:119}. Pure observability;
 *       no behavior change.</li>
 *   <li><b>Don't recast commander into tax hell</b> (AI-8.3). When
 *       the queued action is "cast my commander from the command
 *       zone" AND commander tax ≥ 8 (= died 4+ times), drop the
 *       action before invocation. Prevents the suicide loop where
 *       a high-tax commander gets re-killed every turn for no
 *       value.</li>
 *   <li><b>Don't wipe own board</b> (AI-8.3). When the queued
 *       action is a board-wipe spell (effect class contains
 *       {@code DestroyAll} / {@code DamageAll} / {@code ExileAll})
 *       AND we have ≥ 2 creatures AND our creature count ≥ each
 *       opponent's max, drop the action. Prevents the "AI cast
 *       Wrath when its only creature was a Craterhoof Behemoth"
 *       failure mode.</li>
 *   <li><b>Lethal short-circuit</b> (AI-8.4). At the
 *       {@code selectAttackers} hook, run
 *       {@link CombatUtil#canKillOpponent} per opponent before
 *       the parent's expensive simulation. If lethal exists,
 *       declare those attackers and return early — saves the
 *       AI's 12-second think time on obvious closes AND fixes
 *       the multiplayer-attack bug (parent only iterates the
 *       first opponent; we check all of them). Multi-opponent
 *       awareness as a side effect.</li>
 * </ul>
 *
 * Tier 1 of {@code docs/design/ai-upgrades.md} complete with
 * AI-8.4. Tier 2 (multi-opponent evaluator, hand quality, removal
 * conservation, smarter mulligans) and Tier 3 are queued.
 */
public class CommanderComputerPlayer7 extends ComputerPlayerControllableProxy {

    private static final Logger log = Logger.getLogger(CommanderComputerPlayer7.class);

    /**
     * 21 combat damage from a single commander loses the game per
     * CR 903.14a. The targeting heuristic uses this to score how
     * close an opponent is to a Commander-damage loss vs. a normal
     * life-loss kill — whichever is closer wins.
     */
    private static final int COMMANDER_DAMAGE_LETHAL = 21;

    /**
     * AI-8.2 telemetry — pass count above which we suspect the
     * upstream empty-tree bug ({@code ComputerPlayer7.java:119}) is
     * firing rather than legitimate "I have nothing to do" passes.
     * Tuned high enough that normal turn cycles (untap/upkeep/draw/
     * combat-step passes) don't trigger it. Conservative — better
     * to under-fire and miss some occurrences than to spam logs on
     * legitimate idle turns.
     */
    private static final int EMPTY_TREE_WARN_THRESHOLD = 20;

    /**
     * AI-8.3 — commander tax above which recasting is presumed
     * unwise. Tax = 2 × (cast count - 1), so threshold 8 = died
     * 4+ times. Each prior recast cost +2 generic, so a 4th
     * recast at base CMC 4 would cost 4+8=12 mana — almost
     * always wrong unless we're closing out the game. Lower
     * thresholds (6, ~3rd recast) catch more cases but also
     * over-restrict legitimate finisher recasts.
     */
    private static final int COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD = 8;

    /**
     * AI-8.3 — minimum number of our creatures before the board-wipe
     * filter cares about self-impact. With 0 or 1 creatures the wipe
     * either doesn't hurt us or only loses one body — likely a fair
     * trade. With 2+ creatures we're investing in a board state and
     * would rather not flatten it ourselves.
     */
    private static final int BOARD_WIPE_OWN_CREATURE_FLOOR = 2;

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
    /**
     * Telemetry for the upstream empty-tree bug
     * ({@code ComputerPlayer7.java:119}). Counts priority handoffs
     * vs. actions executed within a single (turn, active player)
     * tuple. When the count of consecutive empty-action invocations
     * crosses {@link #EMPTY_TREE_WARN_THRESHOLD} within one turn,
     * logs a WARN naming the player + turn so the operator can
     * cross-reference the game log.
     *
     * <p>Skips counting in simulation contexts (`game.isSimulation()`)
     * — the AI's own internal sim-tree calls {@code act} repeatedly
     * to evaluate hypothetical branches; counting those would flood
     * with false positives.
     *
     * <p>Pure observability — does not change AI behavior. Defers
     * to super for the actual action invocation either way.
     */
    @Override
    protected void act(Game game) {
        if (game.isSimulation()) {
            super.act(game);
            return;
        }
        long currentTurnHash = computeTurnHash(game);
        if (currentTurnHash != lastObservedTurnHash) {
            // Turn boundary — emit the prior turn's WARN if it
            // matches the empty-tree signature (lots of passes, no
            // actions), then reset counters.
            maybeWarnEmptyTree(game);
            lastObservedTurnHash = currentTurnHash;
            passesThisTurn = 0;
            actionsThisTurn = 0;
        }
        // AI-8.3 — filter the action queue BEFORE the parent invokes
        // each ability. Drops entries that match unsafe patterns
        // (high-tax commander recast, self-harming board wipe). The
        // filter never runs in simulation contexts so the AI's own
        // search-tree planning sees the unfiltered behavior — we only
        // override at real-game execution time.
        filterUnsafeActions(game);
        int actionsBefore = actions == null ? 0 : actions.size();
        super.act(game);
        int actionsAfter = actions == null ? 0 : actions.size();
        if (actionsBefore == 0 && actionsAfter == 0) {
            passesThisTurn++;
        } else {
            // The action queue drained means actual plays happened.
            // Any positive delta is "actions consumed."
            actionsThisTurn += Math.max(0, actionsBefore - actionsAfter);
        }
    }

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

    /**
     * AI-8.3 — drop queued abilities matching unsafe patterns
     * before {@code super.act()} drains them. Two filters:
     * <ol>
     *   <li>High-tax commander recast — when commander tax ≥ 8,
     *       refuse the recast. Prevents the suicide loop where a
     *       repeatedly-killed commander gets re-queued every turn.</li>
     *   <li>Counterproductive board wipe — when the spell's effect
     *       is a {@code DestroyAll}/{@code DamageAll}/{@code ExileAll}
     *       AND we'd lose at least as many creatures as the most
     *       affected opponent AND we have ≥ 2 creatures, refuse.
     *       Catches "AI cast Wrath when its only creature was a
     *       Craterhoof Behemoth" failures.</li>
     * </ol>
     *
     * <p>Both filters are deliberately conservative — false negatives
     * (let through a borderline case) are preferable to false
     * positives (refuse a legitimate finisher). Aggressive thresholds
     * are documented as constants ({@link #COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD},
     * {@link #BOARD_WIPE_OWN_CREATURE_FLOOR}) so tuning is one edit.
     */
    private void filterUnsafeActions(Game game) {
        if (actions == null || actions.isEmpty()) {
            return;
        }
        Iterator<Ability> iter = actions.iterator();
        while (iter.hasNext()) {
            Ability ability = iter.next();
            if (isUnsafeCommanderRecast(ability, game)) {
                log.info(String.format(
                        "AI '%s' refusing commander recast — tax too high (threshold %d).",
                        getName(), COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD));
                iter.remove();
            } else if (isCounterproductiveBoardWipe(ability, game)) {
                log.info(String.format(
                        "AI '%s' refusing board wipe — would hurt us as much as any opponent.",
                        getName()));
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
     *
     * <p>Defensive — every lookup is null-checked; returns false on
     * any unexpected state.
     */
    boolean isUnsafeCommanderRecast(Ability ability, Game game) {
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
        // means it's a flicker/return-from-graveyard etc., which
        // doesn't carry tax.
        if (game.getState().getZone(sourceId) != Zone.COMMAND) {
            return false;
        }
        CommanderPlaysCountWatcher watcher = game.getState()
                .getWatcher(CommanderPlaysCountWatcher.class);
        if (watcher == null) {
            return false;
        }
        int playsCount = watcher.getPlaysCount(sourceCard.getMainCard().getId());
        // Tax = 2 × prior casts (CR 903.8). The Nth cast pays
        // 2 × (N-1) extra generic.
        int tax = 2 * playsCount;
        return tax >= COMMANDER_RECAST_TAX_REFUSAL_THRESHOLD;
    }

    /**
     * Detects "I'm about to cast a board wipe that hurts me as
     * much as it hurts each opponent." Looks for spell abilities
     * whose effects' simple class names contain {@code DestroyAll},
     * {@code DamageAll}, or {@code ExileAll} — covers the staple
     * Commander wipes (Wrath of God, Damnation, Pyroclasm, Anger
     * of the Gods, etc.). Falls through (returns false) if our
     * creature count is below {@link #BOARD_WIPE_OWN_CREATURE_FLOOR}
     * or if some opponent has more creatures than us (in which case
     * the wipe is correct play).
     */
    boolean isCounterproductiveBoardWipe(Ability ability, Game game) {
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
        int maxOppCreatures = 0;
        for (UUID oppId : opponents) {
            int n = countCreaturesControlledBy(oppId, game);
            if (n > maxOppCreatures) {
                maxOppCreatures = n;
            }
        }
        // Refuse only when we'd lose AT LEAST as many as the most
        // affected opponent. Strict-greater-than would let us wipe
        // a tie, which is also bad in 4-player (we trade 1-for-1
        // with one opponent while two others sit at parity).
        return ourCreatures >= maxOppCreatures;
    }

    private boolean hasBoardWipeEffect(Ability ability) {
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

    private int countCreaturesControlledBy(UUID controllerId, Game game) {
        List<Permanent> creatures = game.getBattlefield().getActivePermanents(
                StaticFilters.FILTER_PERMANENT_CREATURE, controllerId, game);
        return creatures == null ? 0 : creatures.size();
    }

    /**
     * AI-8.4 — lethal short-circuit. Before delegating to the
     * parent's full minimax simulation, check each opponent for an
     * available lethal attack via {@link CombatUtil#canKillOpponent}.
     * If lethal is found, declare that attacker set against that
     * opponent and return — skipping the 12-second simulation
     * entirely.
     *
     * <p>This is a strict superset of the parent's behavior on
     * the lethal case (faster + correct) and a strict no-op
     * everywhere else (defers to super). It also fixes the
     * multiplayer-attack bug from {@code SimulatedPlayer2.java:240}
     * as a side effect — the parent enumerates only
     * {@code getOpponents().iterator().next()}, but our
     * iteration walks all opponents looking for a lethal target.
     *
     * <p>Defensive: any failure during attacker registration
     * (declareAttacker returning false partway through) defers to
     * super so we never ship a half-declared attack.
     */
    @Override
    public void selectAttackers(Game game, UUID attackingPlayerId) {
        if (!game.isSimulation()
                && playerId.equals(attackingPlayerId)
                && tryLethalShortCircuit(game)) {
            return;
        }
        super.selectAttackers(game, attackingPlayerId);
    }

    /**
     * Returns true iff a lethal attack was found AND successfully
     * declared. Iterates each opponent (not just the iterator-first
     * one), gathers attackers + blockers, runs upstream
     * {@link CombatUtil#canKillOpponent}. On the first lethal hit:
     * declares each attacker via
     * {@link Combat#declareAttacker(UUID, UUID, UUID, Game)} and
     * returns true. On any per-attacker registration failure:
     * returns false (caller falls through to super, which runs the
     * normal simulation).
     */
    boolean tryLethalShortCircuit(Game game) {
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
        for (UUID oppId : opponents) {
            Player opp = game.getPlayer(oppId);
            if (opp == null || !opp.isInGame()) {
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
            List<Permanent> lethalSet = CombatUtil.canKillOpponent(
                    game, attackersForThisOpp, blockers, opp);
            if (lethalSet == null || lethalSet.isEmpty()) {
                continue;
            }
            // Lethal exists — declare each attacker.
            boolean allOk = true;
            for (Permanent attacker : lethalSet) {
                if (!combat.declareAttacker(attacker.getId(), oppId, playerId, game)) {
                    allOk = false;
                    break;
                }
            }
            if (allOk) {
                log.info(String.format(
                        "AI '%s' lethal short-circuit: attacking %s with %d creatures (skipped simulation).",
                        getName(), opp.getName(), lethalSet.size()));
                return true;
            }
            // declareAttacker failed mid-way — caller defers to
            // super. Combat may have a partial declaration; super's
            // simulation will overlay or correct.
            return false;
        }
        return false;
    }

    private List<Permanent> filterAttackersAgainst(List<Permanent> all, UUID defenderId, Game game) {
        List<Permanent> out = new ArrayList<>(all.size());
        for (Permanent p : all) {
            if (p.canAttack(defenderId, game)) {
                out.add(p);
            }
        }
        return out;
    }

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
