package mage.webapi.auth;

import io.javalin.http.Context;
import io.javalin.http.Handler;
import mage.webapi.WebApiException;
import mage.webapi.embed.EmbeddedServer;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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
 *
 * <p>Slice 46 — AFK timeout cascade fix: after a successful resolve,
 * also call upstream {@code MageServerImpl.ping(sessionId, null)} so
 * every authed REST hit refreshes upstream's {@code User.lastActivity}.
 * Without this, a user idle on the lobby for 3 minutes would be reaped
 * by upstream's {@code UserManagerImpl.checkExpired}, evicting their
 * WAITING tables and leaving them in a "zombie" state where the WebApi
 * token is still valid but every upstream call returns
 * {@code negativeResult()} (HTTP 422 {@code UPSTREAM_REJECTED}). The
 * middleware piggyback covers every authed surface for free; the
 * keepalive WS branches in {@link mage.webapi.ws.GameStreamHandler}
 * and {@link mage.webapi.ws.RoomStreamHandler} carry the same wiring
 * for users sitting on a tab with no HTTP polling.
 */
public final class BearerAuthMiddleware implements Handler {

    private static final Logger LOG = LoggerFactory.getLogger(BearerAuthMiddleware.class);

    /** Method+path keys that bypass auth. */
    private static final Set<String> PUBLIC = Set.of(
            "GET /api/version",
            "GET /api/health",
            "POST /api/session",
            "POST /api/session/admin"
    );

    private static final String BEARER_PREFIX = "Bearer ";

    private final AuthService authService;
    private final EmbeddedServer embedded;

    public BearerAuthMiddleware(AuthService authService, EmbeddedServer embedded) {
        this.authService = authService;
        this.embedded = embedded;
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
        SessionEntry session = entry.get();
        ctx.attribute("session", session);
        ctx.attribute("webSession", authService.toDto(session));
        ctx.attribute("token", token);

        // Slice 46 — bump upstream User.lastActivity so the 3-minute
        // reaper in UserManagerImpl.checkExpired does not destroy the
        // user's WAITING tables while they sit on the lobby. Pass null
        // (not "") so User.updateLastActivity skips the pingInfo
        // assignment — there is no chat banner to broadcast. The call
        // is fire-and-forget: ping() is null-safe on a removed session
        // (returns false via SessionManagerImpl.extendUserSession's
        // Optional.orElse(false)) and a runtime exception here must
        // never block the request from reaching its handler.
        //
        // Note: there is a microsecond-scale race in upstream's
        // User.onLostConnection between setUserState(Offline) (:209)
        // and removeUser() (:210) where this ping could briefly flip
        // an already-doomed user from Offline back to Connected. That
        // is harmless — the user has empty sessionId by then so any
        // fireCallback no-ops, and removeUser proceeds to evict the
        // user anyway. This ping is not a recovery path.
        if (embedded != null) {
            try {
                embedded.server().ping(session.upstreamSessionId(), null);
            } catch (RuntimeException ex) {
                LOG.debug("upstream ping on auth bump failed for sessionId={}: {}",
                        session.upstreamSessionId(), ex.toString());
            }
        }
    }
}
