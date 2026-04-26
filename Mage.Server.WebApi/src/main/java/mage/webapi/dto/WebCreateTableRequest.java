package mage.webapi.dto;

import java.util.List;

/**
 * Request body for {@code POST /api/rooms/{roomId}/tables}. Three
 * fields are required ({@code gameType}, {@code deckType},
 * {@code winsNeeded}); everything else has a server-side default.
 *
 * <p>{@code seats} declares the per-seat {@code PlayerType} composition.
 * Defaults to {@code ["HUMAN", "HUMAN"]} for a 2-player table. To
 * include AI opponents, list them upfront — e.g.
 * {@code ["HUMAN", "COMPUTER_MONTE_CARLO"]} creates a 1v1-vs-AI table.
 * Then {@code POST /tables/{id}/ai} fills declared COMPUTER seats.
 *
 * <p>Optional enum fields ({@code skillLevel}, {@code matchTimeLimit},
 * etc.) accept upstream enum names. Invalid values produce a
 * {@code 400 BAD_REQUEST}.
 */
public record WebCreateTableRequest(
        String gameType,
        String deckType,
        Integer winsNeeded,
        String tableName,
        String password,
        String skillLevel,
        String matchTimeLimit,
        Boolean spectatorsAllowed,
        Boolean rated,
        Integer freeMulligans,
        String mulliganType,
        String attackOption,
        String range,
        List<String> seats
) {
}
