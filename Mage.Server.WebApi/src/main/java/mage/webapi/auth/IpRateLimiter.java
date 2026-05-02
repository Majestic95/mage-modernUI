package mage.webapi.auth;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Slice L8 review (security HIGH #3) — per-IP fixed-window rate
 * limiter for session-mint endpoints. Without this, an attacker can
 * churn anonymous tokens (each {@code POST /api/session} with empty
 * body returns a new {@code guest-XXXXXXXX} token) and amplify them
 * across the various per-token caps (4 WS subs / table, etc.) for
 * trivial fd / thread exhaustion.
 *
 * <p>Implementation is intentionally simple: a fixed 60-second window
 * with a per-IP counter, reset lazily on the next acquire after
 * window expiry. Concurrent-safe via {@link ConcurrentHashMap#compute}
 * — counter increments are atomic. No distributed coordination —
 * single-instance only, which matches the rest of the WebApi.
 *
 * <p>Threshold of {@value #DEFAULT_LIMIT} sessions per minute is
 * generous for legit users (rapid login cycles for testing, tab
 * reopens) but restrictive for abuse (a botnet would hit the limit
 * within seconds per IP).
 */
public final class IpRateLimiter {

    public static final int DEFAULT_LIMIT = 20;
    public static final long DEFAULT_WINDOW_MS = 60_000L;

    private final int limit;
    private final long windowMs;
    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();

    public IpRateLimiter() {
        this(DEFAULT_LIMIT, DEFAULT_WINDOW_MS);
    }

    /**
     * Public ctor with explicit limits. Tests inject permissive
     * limits ({@code Integer.MAX_VALUE}) via
     * {@code WebApiServer.setSessionMintLimiter} so the production
     * cap doesn't 429 high-cadence test traffic.
     */
    public IpRateLimiter(int limit, long windowMs) {
        this.limit = limit;
        this.windowMs = windowMs;
    }

    /**
     * Check + increment in a single atomic step.
     *
     * @return {@code true} if the request is allowed; {@code false} if
     *         the IP has exceeded its window quota
     */
    public boolean tryAcquire(String ip) {
        if (ip == null || ip.isBlank()) {
            // No IP information — fail open (don't block) but don't
            // reward; treat as a single shared-counter under the
            // sentinel key.
            ip = "<unknown>";
        }
        long now = System.currentTimeMillis();
        Bucket result = buckets.compute(ip, (k, b) -> {
            if (b == null || now - b.windowStart >= windowMs) {
                return new Bucket(now, 1);
            }
            return new Bucket(b.windowStart, b.count + 1);
        });
        return result.count <= limit;
    }

    /** Test/debug — current count (or 0) for an IP. */
    int currentCount(String ip) {
        Bucket b = buckets.get(ip);
        if (b == null) return 0;
        if (System.currentTimeMillis() - b.windowStart >= windowMs) return 0;
        return b.count;
    }

    private record Bucket(long windowStart, int count) {
        Bucket(long windowStart, int count) {
            this.windowStart = windowStart;
            this.count = count;
        }
    }

    /** Visible-for-test entries map size (for sweep/leak diagnostics). */
    int size() {
        // Entries leak across the window indefinitely without sweep;
        // for typical traffic the unique-IP set is small. If this ever
        // grows pathologically, add a periodic sweep that drops
        // expired buckets. Tracked but not implemented for L8.
        return buckets.size();
    }
}
