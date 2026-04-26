package mage.webapi.dto.stream;

import java.util.List;
import java.util.Map;

/**
 * Top-level game-state snapshot. Carried as the {@code data} payload of
 * {@code gameInit} / {@code gameUpdate} frames, and embedded inside
 * {@link WebGameClientMessage} for {@code gameInform} / {@code gameOver}.
 *
 * <p>Slice 5 lands the {@code stack} and {@code combat} fields, the
 * last of the visible-state additions. Stack entries reuse
 * {@link WebCardView} because upstream's stack mixes spells (CardView)
 * and stack abilities (StackAbilityView extends CardView) — the rules
 * text is captured in either case via {@code WebCardView.rules}.
 *
 * <p>Still deferred: shared exile zones (top-level), revealed /
 * looked-at zones, transform / flip second-face data. Slice 6 covers
 * the dialog family which doesn't add to the snapshot itself but
 * wraps it via {@link WebGameClientMessage}.
 *
 * @param turn                 current turn number
 * @param phase                upstream {@code TurnPhase} enum name
 *     ({@code BEGINNING}, {@code PRECOMBAT_MAIN}, {@code COMBAT},
 *     {@code POSTCOMBAT_MAIN}, {@code ENDING}); empty if pre-game
 * @param step                 upstream {@code PhaseStep} enum name
 *     (e.g. {@code UPKEEP}, {@code DRAW}, {@code DECLARE_ATTACKERS});
 *     empty if pre-game
 * @param activePlayerName     name of the active-turn player; empty
 *     between turns
 * @param priorityPlayerName   name of the player with priority; empty
 *     when no one has priority
 * @param special              true if there are any "special actions"
 *     available to the priority player (e.g. activated abilities
 *     during mana payment)
 * @param rollbackTurnsAllowed true if the match config permits
 *     {@code ROLLBACK_TURNS} player-actions
 * @param totalErrorsCount     upstream debug counter
 * @param totalEffectsCount    upstream debug counter
 * @param gameCycle            applyEffects loop counter (state-based
 *     action passes); useful for cache invalidation client-side
 * @param myPlayerId           UUID of the player this snapshot was
 *     rendered for; empty for spectator views
 * @param myHand               cards in the controlling player's hand,
 *     keyed by card UUID. Empty for spectators (and for opponents'
 *     hands in any view).
 * @param stack                spells and abilities currently on the
 *     stack, keyed by stack-object UUID. Top of stack has the highest
 *     position in upstream-iteration order.
 * @param combat               attacker → defender groups for the
 *     current combat phase; empty outside combat
 * @param players              all players in the game, in seat order
 */
public record WebGameView(
        int turn,
        String phase,
        String step,
        String activePlayerName,
        String priorityPlayerName,
        boolean special,
        boolean rollbackTurnsAllowed,
        int totalErrorsCount,
        int totalEffectsCount,
        int gameCycle,
        String myPlayerId,
        Map<String, WebCardView> myHand,
        Map<String, WebCardView> stack,
        List<WebCombatGroupView> combat,
        List<WebPlayerView> players
) {
}
