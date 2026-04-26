package mage.webapi.dto.stream;

import java.util.List;

/**
 * Top-level game-state snapshot. Carried as the {@code data} payload of
 * {@code gameInit} / {@code gameUpdate} frames.
 *
 * <p>Slice 3 ships scalar state + per-player summaries only —
 * battlefield permanents, stack contents, exile / revealed / looked-at
 * zones, combat groups, and "my hand" land in slice 4 alongside the
 * card-detail DTOs.
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
        List<WebPlayerView> players
) {
}
