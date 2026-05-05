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
        boolean testMode,
        // Slice F18 (2026-05-04) — true when XMAGE_REGISTRATION_ENABLED
        // is set; lets the client hide / show the "Register account"
        // button without a separate probe request. Additive field; old
        // clients ignore it.
        boolean registrationEnabled
) {
}
