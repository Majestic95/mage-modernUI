package mage.webapi;

import mage.webapi.dto.WebDeckValidationError;

import java.util.List;

/**
 * Uniform exception type for WebApi business errors. Carries the
 * intended HTTP status code, a stable string error code, and a human
 * message. The Javalin exception handler translates these into the
 * {@link mage.webapi.dto.WebError} JSON envelope.
 *
 * <p>Throw from any route or service. Do not throw from inside a
 * Javalin handler chain that expects to short-circuit silently —
 * callers should let this propagate.
 *
 * <p>Slice 72-A — added the optional {@link #validationErrors()} payload
 * so the {@code DECK_INVALID} path can surface upstream's per-card
 * validator breakdown alongside the human message. Other error paths
 * leave it null; the exception handler omits the field via
 * {@code @JsonInclude(NON_NULL)}.
 */
public final class WebApiException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final int status;
    private final String code;
    private final List<WebDeckValidationError> validationErrors;

    public WebApiException(int status, String code, String message) {
        this(status, code, message, null);
    }

    /**
     * Slice 72-A — variant that attaches the deck-validator error list.
     * Use when {@code code == "DECK_INVALID"} to give the client the
     * per-card breakdown. The exception handler serializes the list
     * into {@link mage.webapi.dto.WebError#validationErrors()}.
     */
    public WebApiException(int status, String code, String message,
                           List<WebDeckValidationError> validationErrors) {
        super(message);
        this.status = status;
        this.code = code;
        this.validationErrors = validationErrors == null ? null : List.copyOf(validationErrors);
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }

    /**
     * Slice 72-A — the validator errors attached at construction time,
     * or {@code null} when this isn't a {@code DECK_INVALID} path.
     * Returned list is immutable.
     */
    public List<WebDeckValidationError> validationErrors() {
        return validationErrors;
    }
}
