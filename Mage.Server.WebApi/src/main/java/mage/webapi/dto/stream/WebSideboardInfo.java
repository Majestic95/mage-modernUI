package mage.webapi.dto.stream;

/**
 * Carried as the {@code data} payload of {@code sideboard} frames
 * (schema 1.14+). Server emits one per player at the start of each
 * post-game-1 sideboarding window; the player picks main vs.
 * sideboard cards in the webclient's SideboardModal and submits via
 * {@code POST /api/tables/{tableId}/deck}.
 *
 * <p>Maps from upstream {@code TableClientMessage} as populated by
 * {@code User.ccSideboard(deck, currentTableId, parentTableId,
 * remainingTime, limited)}.
 *
 * @param deck             current deck state (main + sideboard).
 *     Webclient lets the player swap entries between the two lists,
 *     subject to format rules; server validates on submit.
 * @param tableId          table whose match is sideboarding —
 *     submit-deck calls target this id
 * @param parentTableId    parent (tournament) table id, empty string
 *     when the table isn't a tournament sub-table. Carried only for
 *     debugging / future tournament UX.
 * @param time             seconds remaining on the sideboard timer
 *     (server-side counts down independently)
 * @param limited          true when the table is a draft-style
 *     limited format — webclient may relax some validation hints
 *     (e.g. allow basic-land additions)
 */
public record WebSideboardInfo(
        WebDeckView deck,
        String tableId,
        String parentTableId,
        int time,
        boolean limited
) {
}
