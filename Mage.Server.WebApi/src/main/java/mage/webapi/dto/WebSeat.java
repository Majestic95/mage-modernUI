package mage.webapi.dto;

import java.util.List;

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
 * <p>Schema 1.28 — added {@code colorIdentity} so non-self seats
 * render the correct halo color in the new lobby. Without it the
 * client could only color the local user's seat (via the saved-
 * deck local override); every other seat fell back to a hardcoded
 * 6-commander stub and rendered a neutral team-ring.
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
 * @param colorIdentity         color identity of this seat's first
 *     commander as upper-case single-letter codes ("W","U","B","R","G").
 *     Empty list when no commander or non-Commander format. Read by
 *     the new lobby's seat halo / pip rendering.
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
        int deckSizeRequired,
        List<String> colorIdentity
) {
}
