package mage.webapi.metrics;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 70 (ADR 0010 v2 D10) — unit coverage for {@link MetricsRegistry}.
 *
 * <p>Locks the Prometheus text-format wire shape so a future format
 * drift (re-ordering, missing TYPE lines, lost newline at end of
 * counter, etc.) surfaces here rather than in a downstream scraper's
 * silent error log. Counter increment semantics are also locked so
 * the call sites can rely on at-least-once + idempotent-when-zero
 * behavior.
 */
class MetricsRegistryTest {

    @BeforeEach
    void resetCounters() {
        // The registry is process-wide static state. Other tests
        // (production code or mistakes) might leave counters non-zero;
        // explicit reset isolates each test's assertions.
        MetricsRegistry.resetForTest();
    }

    @Test
    void counters_startAtZero_evenWhenNeverIncremented() {
        // Prometheus convention: counters that have never fired still
        // appear in the scrape with value 0. Consumers compute rates
        // without conditional NaN handling. Lock this contract.
        assertEquals(0L, MetricsRegistry.get(MetricsRegistry.FRAMES_EGRESSED_TOTAL));
        assertEquals(0L, MetricsRegistry.get(
                MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL));
        assertEquals(0L, MetricsRegistry.get(
                MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL));
        assertEquals(0L, MetricsRegistry.get(
                MetricsRegistry.ROI_FILTER_FAILURES_TOTAL));
    }

    @Test
    void increment_addsOnePerCall() {
        for (int i = 0; i < 7; i++) {
            MetricsRegistry.increment(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        }
        assertEquals(7L, MetricsRegistry.get(MetricsRegistry.FRAMES_EGRESSED_TOTAL));
    }

    @Test
    void increment_isIndependentAcrossCounters() {
        // Per-counter isolation: incrementing one counter must not
        // touch another. ConcurrentHashMap.computeIfAbsent guarantees
        // each name maps to its own AtomicLong; lock that contract.
        MetricsRegistry.increment(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        MetricsRegistry.increment(MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL);
        MetricsRegistry.increment(MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL);
        assertEquals(1L, MetricsRegistry.get(MetricsRegistry.FRAMES_EGRESSED_TOTAL));
        assertEquals(2L, MetricsRegistry.get(
                MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL));
        assertEquals(0L, MetricsRegistry.get(
                MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL));
    }

    @Test
    void format_emitsActiveGamesGaugeAndAllCounters() {
        // Even when never incremented, the format() output includes
        // every counter at value 0 — Prometheus consumers should not
        // have to special-case "metric absent" vs "metric is 0."
        MetricsRegistry.increment(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        String body = MetricsRegistry.format(3L);

        // xmage_active_games gauge — present + carries the supplied value.
        assertTrue(body.contains("# TYPE xmage_active_games gauge"),
                "active_games TYPE line missing: " + body);
        assertTrue(body.contains("\nxmage_active_games 3\n")
                || body.contains("xmage_active_games 3\n"),
                "active_games value missing or wrong: " + body);

        // Every counter constant appears with its TYPE line.
        for (String counter : new String[]{
                MetricsRegistry.FRAMES_EGRESSED_TOTAL,
                MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL,
                MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL,
                MetricsRegistry.ROI_FILTER_FAILURES_TOTAL,
        }) {
            assertTrue(body.contains("# TYPE " + counter + " counter"),
                    "Missing TYPE line for " + counter + " in: " + body);
        }

        // Frames-egressed surfaces its incremented value (1).
        assertTrue(body.contains(
                MetricsRegistry.FRAMES_EGRESSED_TOTAL + " 1\n"),
                "frames_egressed_total should be 1; output: " + body);
    }

    @Test
    void format_includesHelpLineForEveryMetric() {
        // # HELP <name> <description> — Prometheus text-format
        // convention. Scrapers display these in dashboards. A missing
        // HELP line is silently OK per the spec but creates poor ops
        // UX; lock the contract.
        String body = MetricsRegistry.format(0L);
        assertTrue(body.contains("# HELP xmage_active_games"));
        assertTrue(body.contains("# HELP " + MetricsRegistry.FRAMES_EGRESSED_TOTAL));
        assertTrue(body.contains("# HELP " + MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL));
        assertTrue(body.contains("# HELP " + MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL));
        assertTrue(body.contains("# HELP " + MetricsRegistry.ROI_FILTER_FAILURES_TOTAL));
    }

    @Test
    void format_isStableAcrossInvocations() {
        // Byte-for-byte deterministic output enables regression testing
        // and makes diff-based ops dashboards reliable. The
        // alphabetical-sort in format() guarantees this; lock it.
        MetricsRegistry.increment(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        MetricsRegistry.increment(MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL);
        String first = MetricsRegistry.format(2L);
        String second = MetricsRegistry.format(2L);
        assertEquals(first, second,
                "format() must be deterministic for identical state — "
                        + "downstream scrapers + tests rely on stability.");
    }

    @Test
    void format_countersAppearAlphabetically() {
        // Buffer overflow comes before dialog clears comes before
        // frames egressed comes before roi filter failures.
        // A future addition like xmage_aaa would land first; this
        // test pins the convention so additions don't silently
        // break ordering.
        String body = MetricsRegistry.format(0L);
        int bufferIdx = body.indexOf(MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL);
        int dialogIdx = body.indexOf(MetricsRegistry.DIALOG_CLEARS_EMITTED_TOTAL);
        int framesIdx = body.indexOf(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        int roiIdx = body.indexOf(MetricsRegistry.ROI_FILTER_FAILURES_TOTAL);
        assertTrue(bufferIdx > 0, "buffer counter missing");
        assertTrue(bufferIdx < dialogIdx,
                "buffer must precede dialog: " + bufferIdx + " vs " + dialogIdx);
        assertTrue(dialogIdx < framesIdx,
                "dialog must precede frames: " + dialogIdx + " vs " + framesIdx);
        assertTrue(framesIdx < roiIdx,
                "frames must precede roi: " + framesIdx + " vs " + roiIdx);
    }

    @Test
    void resetForTest_zerosObservedCounters() {
        // The test-only reset is what every other test in the file
        // relies on for isolation. Lock it independently so a future
        // refactor of resetForTest can't silently break test isolation.
        MetricsRegistry.increment(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        MetricsRegistry.increment(MetricsRegistry.FRAMES_EGRESSED_TOTAL);
        assertEquals(2L, MetricsRegistry.get(MetricsRegistry.FRAMES_EGRESSED_TOTAL));
        MetricsRegistry.resetForTest();
        assertEquals(0L, MetricsRegistry.get(MetricsRegistry.FRAMES_EGRESSED_TOTAL));
    }
}
