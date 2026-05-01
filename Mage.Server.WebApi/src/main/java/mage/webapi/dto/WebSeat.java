package mage.webapi.dto;

/**
 * One seat at a table. Empty seats have {@code occupied=false} and
 * empty {@code playerName} / {@code playerType}.
 *
 * <p>Nested DTO — does not carry {@code schemaVersion}.
 *
 * <p>Slice 70-X (user direction 2026-04-30) — added {@code
 * commanderName} + {@code commanderImageNumber} so the lobby can
 * preview each seated player's commander identity BEFORE the game
 * starts. Both default to empty/{@code 0} for non-Commander game
 * types or seats whose deck submission hasn't completed yet
 * (validates fine — empty string + 0 means "no commander info to
 * show").
 *
 * @param playerName            seated player's display name; empty when unoccupied
 * @param playerType            upstream {@code PlayerType} enum name
 *     (e.g. {@code "HUMAN"}, {@code "COMPUTER_MONTE_CARLO"}); empty
 *     when unoccupied
 * @param occupied              {@code true} if a player or AI fills the seat
 * @param commanderName         printed card name of this seat's first
 *     commander (sideboard slot 0). Empty for non-Commander formats
 *     and seats with no submitted deck. Multi-commander pairings
 *     (partner / background) surface only the first commander; later
 *     slices can extend to a list if useful.
 * @param commanderImageNumber  numeric printing identifier for
 *     scryfall art lookup ({@code commanderImageNumber} maps directly
 *     to {@code WebCommandObjectView.imageNumber}). 0 when no
 *     commander.
 */
public record WebSeat(
        String playerName,
        String playerType,
        boolean occupied,
        String commanderName,
        int commanderImageNumber
) {
}
