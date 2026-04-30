package mage.webapi.metrics;

import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Slice 70 (ADR 0010 v2 D10) — process-wide counter registry for the
 * {@code GET /api/admin/metrics} endpoint. Hand-rolled rather than
 * pulled in via Micrometer / DropWizard because v2 needs only a
 * handful of counters + one gauge, and a metrics dependency is a
 * 200KB+ bundle add for value we don't need yet.
 *
 * <p><b>Counter names follow Prometheus conventions:</b>
 * <ul>
 *   <li>{@code _total} suffix on monotonic counters</li>
 *   <li>{@code _seconds} / {@code _bytes} where applicable (none yet)</li>
 *   <li>Lower-snake-case throughout</li>
 *   <li>{@code xmage_} prefix to namespace against other Prometheus
 *       metrics if this server ever shares a scrape target</li>
 * </ul>
 *
 * <p><b>Thread safety:</b> {@link AtomicLong#incrementAndGet} +
 * {@link ConcurrentHashMap#computeIfAbsent} are both lock-free safe.
 * Two threads racing to register a new counter land on the same
 * AtomicLong via the map's compute semantics. Reads via
 * {@link #format(long)} take a snapshot of each counter value but do
 * NOT lock the registry — Prometheus tolerates small skew between
 * metrics in a single scrape.
 *
 * <p><b>Registered counters (v2):</b>
 * <ul>
 *   <li>{@code xmage_frames_egressed_total} — incremented on every
 *       WebSocket frame broadcast to a client.</li>
 *   <li>{@code xmage_buffer_overflow_drops_total} — incremented when
 *       the per-handler 64-frame ring evicts a frame.</li>
 *   <li>{@code xmage_dialog_clears_emitted_total} — incremented when
 *       the slice-69c hasLeft transition detector synthesizes a
 *       {@code dialogClear} frame (ADR D11b).</li>
 *   <li>{@code xmage_roi_filter_failures_total} — incremented when
 *       {@code MultiplayerFrameContext.playersInRange} catches a
 *       transient and falls back to "no filter" (ADR R8 fail-open
 *       policy). Non-zero values are observable evidence the policy
 *       is firing — slice 71 emits a WARN log per fallback for ops.</li>
 * </ul>
 *
 * <p>Gauges (e.g. {@code xmage_active_games}) are NOT stored here —
 * they read live state at scrape time via {@link MetricsHandler}.
 * Storing them would require a periodic poller; on-demand read is
 * simpler and accurate at scrape boundary.
 *
 * <p><b>Test access:</b> {@link #resetForTest} zeros all counters.
 * Production code never calls it.
 */
public final class MetricsRegistry {

    /** Counter — incremented on every outbound frame from WebSocketCallbackHandler.broadcast. */
    public static final String FRAMES_EGRESSED_TOTAL = "xmage_frames_egressed_total";

    /** Counter — incremented when the per-handler 64-frame buffer drops an overflow frame. */
    public static final String BUFFER_OVERFLOW_DROPS_TOTAL = "xmage_buffer_overflow_drops_total";

    /** Counter — incremented when slice 69c synthesizes a dialogClear frame (D11b). */
    public static final String DIALOG_CLEARS_EMITTED_TOTAL = "xmage_dialog_clears_emitted_total";

    /** Counter — incremented when MultiplayerFrameContext.playersInRange falls back to "no filter" (R8). */
    public static final String ROI_FILTER_FAILURES_TOTAL = "xmage_roi_filter_failures_total";

    /**
     * Counter — incremented when slice 70-H.5's per-prompt
     * disconnect-timer fires. One increment per (handler, gameId)
     * timeout — the auto-pass attempt + dialogClear-TIMEOUT broadcast
     * are atomic from a metrics perspective.
     */
    public static final String DISCONNECT_TIMEOUTS_TOTAL = "xmage_disconnect_timeouts_total";

    /**
     * Counter description map — paired with each counter for the
     * Prometheus {@code # HELP} line. Kept here (not as javadoc on
     * each constant) so the format() loop has one canonical source.
     */
    private static final Map<String, String> HELP = Map.of(
            FRAMES_EGRESSED_TOTAL,
                    "Total WebSocket frames egressed to all clients.",
            BUFFER_OVERFLOW_DROPS_TOTAL,
                    "Frames dropped because the per-handler 64-frame resume buffer was full.",
            DIALOG_CLEARS_EMITTED_TOTAL,
                    "dialogClear envelopes synthesized on hasLeft transitions or disconnect-timeouts (ADR 0010 v2 D11b/D11e).",
            ROI_FILTER_FAILURES_TOTAL,
                    "RoI filter resolved to fail-open (no filter) on a transient (ADR 0010 v2 R8).",
            DISCONNECT_TIMEOUTS_TOTAL,
                    "Per-prompt disconnect-timers that fired (slice 70-H.5, ADR 0010 v2 D11(e))."
    );

    private static final ConcurrentHashMap<String, AtomicLong> COUNTERS = new ConcurrentHashMap<>();

    private MetricsRegistry() {
    }

    /**
     * Increment the named counter by 1. Thread-safe; lock-free.
     * Lazy-creates the AtomicLong on first observation.
     */
    public static void increment(String name) {
        COUNTERS.computeIfAbsent(name, k -> new AtomicLong()).incrementAndGet();
    }

    /**
     * Read the current value of the named counter without mutation.
     * Returns 0 for unobserved counters (Prometheus convention —
     * counters that have never fired still appear in the scrape with
     * value 0 so consumers can compute rates without conditional NaN
     * handling).
     */
    public static long get(String name) {
        AtomicLong c = COUNTERS.get(name);
        return c == null ? 0L : c.get();
    }

    /**
     * Format the registry as Prometheus text format (v0.0.4) for the
     * {@code GET /api/admin/metrics} response. Includes the
     * {@code xmage_active_games} gauge supplied by the caller (read
     * from {@code GameManager.getGameController().size()} at scrape
     * time) so the entire response is generated in one call.
     *
     * <p>Output is alphabetically ordered by metric name for
     * deterministic byte-for-byte stable scrapes — useful for
     * regression-testing the wire format.
     *
     * <p>Every counter in {@link #HELP} appears in the output with
     * value 0 if never incremented. This is the Prometheus-recommended
     * pattern: consumers shouldn't have to guess whether a missing
     * metric means "0" or "not instrumented."
     */
    public static String format(long activeGames) {
        StringBuilder out = new StringBuilder();

        // Gauge — always present, not stored in COUNTERS.
        out.append("# HELP xmage_active_games Active games on the server.\n");
        out.append("# TYPE xmage_active_games gauge\n");
        out.append("xmage_active_games ").append(activeGames).append('\n');

        // Counters — alphabetical order for stable output.
        TreeMap<String, String> sorted = new TreeMap<>(HELP);
        for (Map.Entry<String, String> e : sorted.entrySet()) {
            String name = e.getKey();
            out.append("# HELP ").append(name).append(' ')
                    .append(e.getValue()).append('\n');
            out.append("# TYPE ").append(name).append(" counter\n");
            out.append(name).append(' ').append(get(name)).append('\n');
        }
        return out.toString();
    }

    /**
     * Test-only — zeros every observed counter. Production code never
     * calls this; test classes call it in {@code @BeforeEach} to
     * isolate counter assertions across tests.
     *
     * <p><b>Cross-class hygiene:</b> any test class that touches
     * production code paths which increment counters (the WebSocket
     * broadcast pipeline, the RoI mapper, etc.) MUST also call this
     * in its setup, even if the class doesn't make assertions about
     * counter values. Otherwise its bumps leak into a later
     * {@code MetricsRegistryTest} run and flip the
     * {@code counters_startAtZero} assertion red. The registry is
     * static process-wide state — JUnit's per-test instance isolation
     * does NOT extend to it.
     */
    public static void resetForTest() {
        for (AtomicLong c : COUNTERS.values()) {
            c.set(0L);
        }
    }
}
