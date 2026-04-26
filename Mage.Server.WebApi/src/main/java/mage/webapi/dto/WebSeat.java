package mage.webapi.dto;

/**
 * One seat at a table. Empty seats have {@code occupied=false} and
 * empty {@code playerName} / {@code playerType}.
 *
 * <p>Nested DTO — does not carry {@code schemaVersion}.
 *
 * @param playerName seated player's display name; empty when unoccupied
 * @param playerType upstream {@code PlayerType} enum name
 *     (e.g. {@code "HUMAN"}, {@code "COMPUTER_MONTE_CARLO"}); empty
 *     when unoccupied
 * @param occupied   {@code true} if a player or AI fills the seat
 */
public record WebSeat(
        String playerName,
        String playerType,
        boolean occupied
) {
}
