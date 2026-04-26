package mage.webapi.dto;

/**
 * Request body for {@code POST /api/rooms/{roomId}/tables/{tableId}/ai}.
 * Server fills name + dummy deck; the AI's name appears in the next
 * {@link WebTableListing} poll.
 *
 * @param playerType upstream {@code PlayerType} enum name. Valid
 *     values: {@code "COMPUTER_MONTE_CARLO"}, {@code "COMPUTER_MAD"}.
 *     {@code "COMPUTER_DRAFT_BOT"} is for draft tables only.
 */
public record WebAddAiRequest(
        String playerType
) {
}
