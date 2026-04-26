package mage.webapi.dto;

/**
 * Tournament-mode descriptor. Hand-written translation of upstream
 * {@code mage.view.TournamentTypeView}; the {@code mage.view} type does
 * not appear in our wire format.
 *
 * <p>Nested DTO — does not carry {@code schemaVersion}; that lives on the
 * top-level response only.
 */
public record WebTournamentType(
        String name,
        int minPlayers,
        int maxPlayers,
        int numBoosters,
        boolean draft,
        boolean limited,
        boolean cubeBooster,
        boolean elimination,
        boolean random,
        boolean reshuffled,
        boolean richMan,
        boolean jumpstart
) {
}
