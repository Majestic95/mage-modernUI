package mage.webapi.dto;

/**
 * Request body for {@code POST /api/rooms/{roomId}/tables/{tableId}/join}.
 * The {@link #deck} field is required — server validates it against
 * the table's deck-construction format and rejects illegal decks
 * with 422 {@code UPSTREAM_REJECTED}.
 *
 * @param name     player display name; defaults to authenticated username
 * @param password table password (required if the table is passworded)
 * @param skill    upstream skill rating, default 1
 * @param deck     mainboard + sideboard
 */
public record WebJoinTableRequest(
        String name,
        String password,
        Integer skill,
        WebDeckCardLists deck
) {
}
