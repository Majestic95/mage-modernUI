package mage.webapi;

/**
 * Entry point for the WebApi server. Phase 2+ will start Javalin here and wire
 * up routes against an embedded {@link mage.webapi.embed.EmbeddedServer}.
 *
 * Currently a placeholder — Phase 1 validates the embedding strategy via tests
 * before any production server code is written.
 */
public final class WebApiMain {

    private WebApiMain() {
    }

    public static void main(String[] args) {
        throw new UnsupportedOperationException(
                "WebApiMain is a Phase 2+ entry point; not implemented during Phase 1 spike.");
    }
}
