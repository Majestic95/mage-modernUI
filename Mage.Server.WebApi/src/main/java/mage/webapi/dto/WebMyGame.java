package mage.webapi.dto;

import java.util.List;

/**
 * One rejoinable game for the authenticated user. An entry exists only
 * when the user is seated in the underlying engine {@code Game} AND
 * the upstream {@code Player.hasLeft()} is false (i.e. the player has
 * not conceded). Returned as part of {@link WebMyGamesResponse} from
 * {@code GET /api/games/mine}.
 *
 * <p>The DTO is intentionally small — only what the lobby banner needs
 * to render and to act on. Live game state (life, hand size, whose
 * turn) is the WebSocket stream's job; this endpoint is "where can I
 * resume," not "what's happening in the game I left."
 *
 * @param gameId        the upstream game UUID; the client uses this to
 *     transition into the Game window (same setter the start-game
 *     auto-route uses)
 * @param tableId       the parent table UUID; surfaced for diagnostics
 *     and to let the client correlate with a still-listed table row
 * @param tableName     user-visible table name (host's table) — already
 *     part of the on-wire table snapshot; duplicated here so the banner
 *     renders without a second fetch
 * @param opponentNames usernames of the OTHER seated players (this
 *     user excluded). AI seats render as the bot name. Ordered by
 *     upstream's player iteration order — stable per game.
 */
public record WebMyGame(
        String gameId,
        String tableId,
        String tableName,
        List<String> opponentNames
) {
}
