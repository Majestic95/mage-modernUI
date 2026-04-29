package mage.webapi.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

/**
 * Top-level error response shape. Every 4xx/5xx returns this.
 *
 * <p>{@code code} is a stable enum-style string clients can switch on
 * (e.g. {@code "INVALID_CREDENTIALS"}, {@code "MISSING_TOKEN"}). Adding
 * a new code is a minor schema bump; renaming or removing one is a
 * major bump.
 *
 * <p>{@code message} is human-friendly text safe to display.
 *
 * <p>Slice 72-A (schema 1.21) — added {@code validationErrors} for the
 * deck-legality failure path. When the WebApi rejects a join because
 * the deck failed validation, {@code code} is {@code "DECK_INVALID"}
 * and {@code validationErrors} carries the per-card breakdown
 * (banned cards, color-identity violations, size mismatches, etc.).
 * For all other 4xx/5xx paths the field is {@code null} and Jackson
 * omits it from the wire (NON_NULL).
 *
 * <p>Forward-compat: older clients that don't recognize
 * {@code validationErrors} ignore it and fall back to displaying
 * {@code message} alone — same UX as pre-72-A.
 */
public record WebError(
        String schemaVersion,
        String code,
        String message,

        /**
         * Slice 72-A — deck validator errors when {@code code ==
         * "DECK_INVALID"}. Null otherwise. Jackson serializes
         * absent (not the literal string "null") via
         * {@link JsonInclude.Include#NON_NULL}.
         */
        @JsonInclude(JsonInclude.Include.NON_NULL)
        List<WebDeckValidationError> validationErrors
) {

    /**
     * Convenience constructor for the legacy (non-validation) error
     * path. Equivalent to passing {@code null} for
     * {@code validationErrors}. Lets every existing call site keep
     * its 3-arg invocation unchanged after the field add.
     */
    public WebError(String schemaVersion, String code, String message) {
        this(schemaVersion, code, message, null);
    }
}
