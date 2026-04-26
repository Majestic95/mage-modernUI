package mage.webapi.dto;

/**
 * Top-level error response shape. Every 4xx/5xx returns this.
 *
 * <p>{@code code} is a stable enum-style string clients can switch on
 * (e.g. {@code "INVALID_CREDENTIALS"}, {@code "MISSING_TOKEN"}). Adding
 * a new code is a minor schema bump; renaming or removing one is a
 * major bump.
 *
 * <p>{@code message} is human-friendly text safe to display.
 */
public record WebError(
        String schemaVersion,
        String code,
        String message
) {
}
