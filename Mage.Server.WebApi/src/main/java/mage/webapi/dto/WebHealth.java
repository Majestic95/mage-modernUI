package mage.webapi.dto;

/**
 * Public health DTO. Reports whether the WebApi facade and embedded server
 * are ready to serve requests.
 *
 * @param schemaVersion JSON wire-format version.
 * @param status        One of: {@code "ready"}, {@code "starting"},
 *     {@code "error"}.
 */
public record WebHealth(
        String schemaVersion,
        String status
) {
}
