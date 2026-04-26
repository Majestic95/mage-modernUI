package mage.webapi;

/**
 * Uniform exception type for WebApi business errors. Carries the
 * intended HTTP status code, a stable string error code, and a human
 * message. The Javalin exception handler translates these into the
 * {@link mage.webapi.dto.WebError} JSON envelope.
 *
 * <p>Throw from any route or service. Do not throw from inside a
 * Javalin handler chain that expects to short-circuit silently —
 * callers should let this propagate.
 */
public final class WebApiException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final int status;
    private final String code;

    public WebApiException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public int status() {
        return status;
    }

    public String code() {
        return code;
    }
}
