package mage.webapi.metrics;

import io.javalin.http.Context;
import io.javalin.http.Handler;
import mage.webapi.WebApiException;
import mage.webapi.auth.SessionEntry;
import mage.webapi.embed.EmbeddedServer;
import org.jetbrains.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.UUID;

/**
 * Slice 70 (ADR 0010 v2 D10) — admin-only Prometheus-text-format
 * metrics endpoint at {@code GET /api/admin/metrics}. Reads counters
 * from {@link MetricsRegistry} and the live {@code xmage_active_games}
 * gauge from {@code GameManager} at scrape time.
 *
 * <p><b>Auth:</b> requires a Bearer token whose
 * {@link SessionEntry#isAdmin()} flag is true (obtained via
 * {@code POST /api/session/admin} with the
 * {@code XMAGE_ADMIN_PASSWORD} configured at server boot). Non-admin
 * tokens get 403; missing tokens get 401 from the upstream
 * {@code BearerAuthMiddleware}.
 *
 * <p><b>Why admin-gated:</b> the metrics surface counts (active
 * games, frames egressed, etc.) — useful for ops, but also a
 * lightweight server-side fingerprint that could feed
 * reconnaissance for a targeted DoS. Gating behind admin keeps the
 * surface scoped to the operator without precluding a future v3
 * decision to expose a public {@code /api/health} that reports a
 * subset.
 *
 * <p><b>Output format:</b> Prometheus text-format v0.0.4
 * ({@code text/plain; version=0.0.4; charset=utf-8}). Each metric
 * has {@code # HELP}, {@code # TYPE}, then a value line. Counters
 * are alphabetically ordered for byte-for-byte stable scrapes.
 *
 * <p><b>Performance:</b> O(metrics-count + 1 game-controller
 * map lookup). No periodic polling, no histograms, no heavy
 * aggregation — scrape cost is microseconds even at high game count.
 */
public final class MetricsHandler implements Handler {

    private static final Logger LOG = LoggerFactory.getLogger(MetricsHandler.class);

    private final EmbeddedServer embedded;

    public MetricsHandler(EmbeddedServer embedded) {
        this.embedded = embedded;
    }

    @Override
    public void handle(@NotNull Context ctx) {
        SessionEntry session = sessionFrom(ctx);
        if (!session.isAdmin()) {
            // Non-admin tokens: forbidden, not unauthenticated. The
            // user IS authenticated — they just don't have admin
            // scope. Distinct from MISSING_TOKEN / INVALID_TOKEN
            // which the bearer middleware emits.
            throw new WebApiException(403, "ADMIN_REQUIRED",
                    "Admin token required for /api/admin/metrics. "
                    + "Use POST /api/session/admin to obtain one.");
        }

        long activeGames = readActiveGames();
        String body = MetricsRegistry.format(activeGames);
        ctx.contentType("text/plain; version=0.0.4; charset=utf-8");
        ctx.result(body);
    }

    /**
     * Read the {@code xmage_active_games} gauge from upstream's
     * {@code GameManager}. Returns 0 on any reflection failure
     * (defensive: an admin scraping should not get a 500 when the
     * game-controller map happens to be unavailable for a transient
     * — they get an honest 0 with a server-side WARN). Same fail-
     * open philosophy as ADR R8.
     */
    private long readActiveGames() {
        try {
            Map<UUID, ?> controllers = embedded.managerFactory()
                    .gameManager().getGameController();
            return controllers == null ? 0L : controllers.size();
        } catch (RuntimeException ex) {
            LOG.warn("xmage_active_games read failed; reporting 0: {}",
                    ex.toString());
            return 0L;
        }
    }

    /**
     * Defense-in-depth: {@code BearerAuthMiddleware} already rejects
     * unauthenticated requests with 401 before the handler runs (the
     * route is not in the middleware's PUBLIC allow-list). This
     * guard is unreachable in production, but mirrors the idiom used
     * in {@code WebApiServer.sessionFrom} so a future refactor that
     * reorders middleware doesn't silently bypass auth on
     * {@code /api/admin/metrics}. Cheap to keep.
     */
    private static SessionEntry sessionFrom(Context ctx) {
        Object attr = ctx.attribute("session");
        if (!(attr instanceof SessionEntry)) {
            throw new WebApiException(401, "MISSING_TOKEN",
                    "Auth middleware did not attach a session.");
        }
        return (SessionEntry) attr;
    }
}
