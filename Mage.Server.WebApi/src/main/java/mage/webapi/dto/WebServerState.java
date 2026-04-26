package mage.webapi.dto;

import java.util.List;

/**
 * Top-level "what does this server support?" payload. Returned by
 * {@code GET /api/server/state}. Lists every loaded game/tournament/
 * player/deck/cube type so a client can render a lobby UI without
 * needing other endpoints first.
 *
 * <p>Top-level response DTO — carries {@code schemaVersion}. Nested DTOs
 * ({@link WebGameType}, {@link WebTournamentType}) do not.
 */
public record WebServerState(
        String schemaVersion,
        List<WebGameType> gameTypes,
        List<WebTournamentType> tournamentTypes,
        List<String> playerTypes,
        List<String> deckTypes,
        List<String> draftCubes,
        boolean testMode
) {
}
