package mage.webapi.auth;

import io.javalin.http.Context;
import io.javalin.http.Handler;
import mage.webapi.WebApiException;
import org.jetbrains.annotations.NotNull;

import java.util.Optional;
import java.util.Set;

/**
 * Javalin {@code before} filter that enforces Bearer-token auth on
 * every non-public route (ADR 0004 D9).
 *
 * <p>On success, attaches:
 * <ul>
 *   <li>{@code ctx.attribute("session")} — the internal
 *       {@link SessionEntry} carrying the upstream sessionId; routes
 *       that talk to {@code MageServerImpl} read this</li>
 *   <li>{@code ctx.attribute("webSession")} — the public
 *       {@link mage.webapi.dto.WebSession} DTO for routes that just
 *       echo back session info (e.g. {@code GET /api/session/me})</li>
 *   <li>{@code ctx.attribute("token")} — the raw bearer string</li>
 * </ul>
 *
 * <p>Failure modes (uniform {@link WebApiException} envelope):
 * <ul>
 *   <li>Missing/malformed header → 401 {@code MISSING_TOKEN}</li>
 *   <li>Unknown or expired token → 401 {@code INVALID_TOKEN}</li>
 * </ul>
 */
public final class BearerAuthMiddleware implements Handler {

    /** Method+path keys that bypass auth. */
    private static final Set<String> PUBLIC = Set.of(
            "GET /api/version",
            "GET /api/health",
            "POST /api/session",
            "POST /api/session/admin"
    );

    private static final String BEARER_PREFIX = "Bearer ";

    private final AuthService authService;

    public BearerAuthMiddleware(AuthService authService) {
        this.authService = authService;
    }

    @Override
    public void handle(@NotNull Context ctx) {
        // CORS preflights are handled by the CORS plugin; never auth them.
        if ("OPTIONS".equals(ctx.method().name())) {
            return;
        }
        // WebSocket upgrade requests bypass HTTP Bearer auth — browsers
        // cannot set custom headers on the upgrade. Auth lives in the
        // WS onConnect handler via ?token=. ADR 0007 D2.
        String upgrade = ctx.header("Upgrade");
        if (upgrade != null && "websocket".equalsIgnoreCase(upgrade)) {
            return;
        }
        String key = ctx.method().name() + " " + ctx.path();
        if (PUBLIC.contains(key)) {
            return;
        }

        String header = ctx.header("Authorization");
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            throw new WebApiException(401, "MISSING_TOKEN",
                    "Authorization: Bearer <token> required.");
        }
        String token = header.substring(BEARER_PREFIX.length()).trim();
        Optional<SessionEntry> entry = authService.resolveAndBump(token);
        if (entry.isEmpty()) {
            throw new WebApiException(401, "INVALID_TOKEN",
                    "Bearer token is invalid or expired.");
        }
        ctx.attribute("session", entry.get());
        ctx.attribute("webSession", authService.toDto(entry.get()));
        ctx.attribute("token", token);
    }
}
