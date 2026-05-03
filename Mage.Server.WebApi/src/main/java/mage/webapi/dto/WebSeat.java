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
 * starts.
 *
 * <p>Schema 1.27 (slice L2) — added {@code ready} + {@code deckName}
 * + {@code deckSize} + {@code deckSizeRequired} so the new lobby
 * screen can render the per-seat deck plate and ready toggle.
 *
 * <p>Schema 1.28 — added {@code colorIdentity} so non-self seats
 * render the correct halo color in the new lobby.
 *
 * <p>Schema 1.29 — added {@code commanderSetCode} +
 * {@code commanderCardNumber} (string) so the lobby preview honors
 * the user's chosen printing for their commander art. Pre-1.29 the
 * lobby fell back to a Scryfall by-name lookup which silently
 * returned Scryfall's default printing instead of the user's pick.
 * The integer {@code commanderImageNumber} stays for legacy reasons
 * but is unused by the new lobby (it's 0 for ordinary cards).
 *
 * @param playerName            seated player's display name; empty when unoccupied
 * @param playerType            upstream {@code PlayerType} enum name
 * @param occupied              {@code true} if a player or AI fills the seat
 * @param commanderName         printed card name of this seat's first commander
 * @param commanderImageNumber  legacy int collector-number; 0 for ordinary cards
 * @param ready                 whether this seat has explicitly readied up
 * @param deckName              user-supplied deck name
 * @param deckSize              mainboard card count of the registered deck
 * @param deckSizeRequired      format-required mainboard size
 * @param colorIdentity         WUBRG color-identity letter codes
 * @param commanderSetCode      set code of this seat's first commander's chosen
 *     printing (e.g. "C18", "ZNR"). Empty for non-Commander formats and seats
 *     without a submitted deck. Used by the lobby to fetch the right Scryfall art.
 * @param commanderCardNumber   collector number string of the same printing
 *     (e.g. "1", "281", "287a"). Empty when no commander.
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
        List<String> colorIdentity,
        String commanderSetCode,
        String commanderCardNumber
) {
}
