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
 * <p>Slice L2 (new-lobby-window, schema 1.27) — added {@code ready}
 * + {@code deckName} + {@code deckSize} + {@code deckSizeRequired}
 * so the new lobby screen can render the per-seat deck plate and
 * the per-seat ready toggle. {@code ready} is wire-only state today
 * (always emitted as {@code false}); slice L5 wires the toggle
 * endpoint that flips it. The deck-info fields read from the seat's
 * registered deck on the upstream {@link mage.game.match.Match}; if
 * no deck is registered yet (pre-submit) all three default to
 * {@code ""} / {@code 0}.
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
 * @param ready                 whether this seat has explicitly
 *     readied up. Always {@code false} pre-L5; L5 wires the
 *     toggle endpoint. AI seats are auto-ready on join (TableMapper
 *     emits {@code true} when {@code playerType != HUMAN}).
 * @param deckName              user-supplied deck name. Empty when
 *     no deck is registered yet.
 * @param deckSize              mainboard card count of the registered
 *     deck. {@code 0} when no deck yet.
 * @param deckSizeRequired      format-required mainboard size (60 for
 *     constructed, 100 for Commander, 40 for limited). Derived from
 *     the table's {@code deckType} string. {@code 0} if it cannot be
 *     determined.
 */
public record WebSeat(
        String playerName,
        String playerType,
        boolean occupied,
        String commanderName,
        int commanderImageNumber,
        boolean ready,
        String deckName,
        int deckSize,
        int deckSizeRequired
) {
}
