package mage.webapi.dto;

/**
 * Public health DTO. Reports whether the WebApi facade and embedded server
 * are ready to serve requests.
 *
 * @param schemaVersion JSON wire-format version.
 * @param status        One of: {@code "ready"}, {@code "starting"},
 *     {@code "error"}.
 * @param pauperLegality optional operational health for the Scryfall-backed
 *     Pauper legality overlay.
 */
public record WebHealth(
        String schemaVersion,
        String status,
        PauperLegalityHealth pauperLegality
) {
    public record PauperLegalityHealth(
            boolean enabled,
            String lastRefreshedAt,
            int knownCardCount,
            int consecutiveRefreshFailures,
            String lastRefreshError
    ) {
    }
}
