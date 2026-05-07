package mage.webapi.format;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Loads Scryfall's oracle_cards bulk-data at startup and exposes a
 * name → {@link PauperLegality} lookup. T2.A scope: build + unit tests.
 * T2.B wires {@link #legalityOf(String)} into the Pauper validator
 * override. T2.C adds a scheduled background refresh so the banlist
 * tracks Wizards' B&amp;R updates without redeploying.
 *
 * <p>Design decisions:
 * <ul>
 *   <li><b>Initial load is synchronous.</b> Boot-time load makes the
 *       cost deterministic and lets the validator override fail fast
 *       (or fall back) before the first deck-validation request lands.
 *       </li>
 *   <li><b>Refresh is scheduled.</b> A daemon
 *       {@link ScheduledExecutorService} re-fetches oracle_cards at a
 *       configurable interval (default 24h). Wizards announces Pauper
 *       bans on the Format Panel's schedule (typically Monday); a
 *       daily refresh tracks them within ≤24h. Pass
 *       {@link Duration#ZERO} (or negative) to disable scheduling and
 *       keep the historical "load once at boot" behavior — used by
 *       tests so unit-test JVMs don't accumulate timer threads.</li>
 *   <li><b>Atomic snapshot swap.</b> Refresh writes a brand-new
 *       {@link LegalitySnapshot} into the {@link AtomicReference};
 *       readers ({@link #legalityOf}) see either the old map paired
 *       with the old timestamp or the new map paired with the new
 *       timestamp — never a torn pair. The map inside each snapshot
 *       is itself immutable ({@link Map#copyOf}), so no further
 *       synchronization is needed for concurrent readers.</li>
 *   <li><b>Refresh failure keeps the prior snapshot.</b>
 *       {@link #refreshOnce()} catches {@link Throwable} (not just
 *       {@link IOException}) defensively. A
 *       {@link ScheduledExecutorService} suppresses all subsequent
 *       ticks if a runnable throws — catching everything keeps the
 *       loop alive across any unexpected fault, and a transient
 *       Scryfall outage just leaves us serving the previous snapshot
 *       until the next tick succeeds.</li>
 *   <li><b>Stale-cache fallback at boot.</b> If the network is down at
 *       startup and a stale cache exists on disk, we use it and log
 *       WARN. Refusing to serve any Pauper validation because Scryfall
 *       had a hiccup would be worse for users than serving a banlist
 *       a day or two behind. If both network and cache fail, the
 *       constructor throws and the caller decides — T2.B falls back to
 *       upstream's rarity-based check.</li>
 * </ul>
 */
public final class PauperLegalityService implements AutoCloseable {

    private static final Logger LOG = LoggerFactory.getLogger(PauperLegalityService.class);

    private final LegalityCacheStore store;
    private final ScryfallBulkDataClient client;
    private final AtomicReference<LegalitySnapshot> snapshot;
    private final ScheduledExecutorService refreshExecutor;

    /**
     * Production constructor. Wires a real
     * {@link ScryfallBulkDataClient} that talks to {@code api.scryfall.com}
     * and starts a background refresh on the supplied interval.
     *
     * @param cacheDir directory for the on-disk cache file. Created
     *                 if missing.
     * @param refreshInterval how often to re-fetch from Scryfall after
     *                        the initial boot load. Pass
     *                        {@link Duration#ZERO} or a negative
     *                        duration to disable scheduling and keep
     *                        the load-once-at-boot behavior.
     * @throws LegalityDataUnavailableException if both the network
     *         fetch and any stale cache are unusable.
     */
    public PauperLegalityService(Path cacheDir, Duration refreshInterval) {
        this(new LegalityCacheStore(cacheDir), new ScryfallBulkDataClient(),
                false, refreshInterval);
    }

    /**
     * Backwards-compat overload for tests written before T2.C. Delegates
     * to the 4-arg test seam with {@link Duration#ZERO} (no scheduled
     * refresh). Kept so T2.B's {@code WebApiPauperValidatorTest}
     * continues to compile after the scheduling field landed; do NOT
     * call this from new tests — be explicit about the interval.
     */
    PauperLegalityService(LegalityCacheStore store,
                          ScryfallBulkDataClient client,
                          boolean skipNetwork) {
        this(store, client, skipNetwork, Duration.ZERO);
    }

    /**
     * Test seam (package-private). Lets tests inject a fake bulk-data
     * client and pre-stage the cache directory with a fixture file.
     * The {@code skipNetwork} flag short-circuits the
     * fetch-on-stale-cache path so tests with a fresh fixture file
     * never reach for the wire.
     *
     * <p>Tests pass {@link Duration#ZERO} for {@code refreshInterval}
     * to disable the scheduler — unit tests don't want a background
     * thread polling Scryfall while they assert against a fixture.
     *
     * <p>This shape was chosen over an extracted {@code LegalityLoader}
     * interface because there's exactly one production wire-bound
     * implementation and the test only needs to swap the IO surface,
     * not the orchestration. If a second loader appears (e.g. an
     * MTGJSON fallback), promote {@link ScryfallBulkDataClient} to
     * an interface.
     */
    PauperLegalityService(LegalityCacheStore store,
                          ScryfallBulkDataClient client,
                          boolean skipNetwork,
                          Duration refreshInterval) {
        this.store = store;
        this.client = client;
        var loaded = loadOrRefresh(store, client, skipNetwork);
        this.snapshot = new AtomicReference<>(
                new LegalitySnapshot(Map.copyOf(loaded.map), loaded.refreshedAt));
        LOG.info("PauperLegalityService initialized with {} card entries (refreshed at {})",
                loaded.map.size(), loaded.refreshedAt);

        if (refreshInterval != null
                && !refreshInterval.isZero()
                && !refreshInterval.isNegative()) {
            this.refreshExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "webapi-pauper-legality-refresh");
                t.setDaemon(true);
                return t;
            });
            long millis = refreshInterval.toMillis();
            // initialDelay == period — the snapshot we just loaded IS
            // a fresh refresh from the operator's standpoint; the next
            // tick should fire one full interval later.
            // Milliseconds (not seconds) so sub-second test intervals
            // like Duration.ofMillis(50) don't truncate to 0 and crash
            // scheduleAtFixedRate's "period > 0" precondition.
            this.refreshExecutor.scheduleAtFixedRate(
                    this::refreshOnce, millis, millis, TimeUnit.MILLISECONDS);
            LOG.info("Scheduled Scryfall legality refresh every {}ms", millis);
        } else {
            this.refreshExecutor = null;
        }
    }

    /**
     * Pauper legality of a card by exact verbatim name. Returns
     * {@link PauperLegality#UNKNOWN} for names not in Scryfall's
     * oracle data — typically engine-only token names or names too new
     * for the cached snapshot.
     */
    public PauperLegality legalityOf(String cardName) {
        if (cardName == null) {
            return PauperLegality.UNKNOWN;
        }
        return snapshot.get().legalities().getOrDefault(cardName, PauperLegality.UNKNOWN);
    }

    /** Number of card names in the in-memory map. Diagnostic-only. */
    public int knownCardCount() {
        return snapshot.get().legalities().size();
    }

    /**
     * Wall-clock of the last successful data load — either the
     * network fetch's completion time (fresh refresh) or the cache
     * file's mtime (cache hit).
     */
    public Instant lastRefreshedAt() {
        return snapshot.get().refreshedAt();
    }

    /**
     * Re-fetch oracle_cards from Scryfall and atomically swap the
     * snapshot on success. On failure, log WARN and leave the prior
     * snapshot in place — readers continue to see consistent data
     * until the next tick succeeds.
     *
     * <p>Package-private so tests can drive a manual refresh without
     * waiting for the scheduler.
     *
     * <p><b>Catches {@link Throwable}, not just {@link IOException}.</b>
     * A scheduled runnable that throws suppresses all future ticks of
     * its own schedule. Catching everything keeps the refresh loop
     * alive across any unexpected fault — corrupted JSON, OOM during
     * parse, an I/O glitch we didn't anticipate. The trade-off is
     * intentional: refresh failure is operationally a non-event (we
     * still have the prior snapshot); a permanently dead refresh
     * thread is a silent operational regression that wouldn't surface
     * until the next redeploy.
     */
    void refreshOnce() {
        LOG.debug("Scheduled Scryfall legality refresh starting");
        try {
            Path cacheFile = store.filePath();
            client.fetchOracleCardsTo(cacheFile);
            Map<String, PauperLegality> map = client.parseLegalitiesFromFile(cacheFile);
            snapshot.set(new LegalitySnapshot(Map.copyOf(map), Instant.now()));
            LOG.info("Scheduled Scryfall refresh succeeded ({} entries)", map.size());
        } catch (Throwable ex) {
            LOG.warn("Scheduled Scryfall refresh failed; keeping prior snapshot: {}",
                    ex.getMessage());
        }
    }

    /**
     * Stops the background refresh executor (if any). Idempotent and
     * null-safe. Called from {@link mage.webapi.server.WebApiServer#stop()}
     * so the JVM shutdown hook doesn't leak a daemon thread when
     * tests rebuild a server mid-process.
     */
    @Override
    public void close() {
        if (refreshExecutor != null) {
            refreshExecutor.shutdownNow();
        }
    }

    private static LoadResult loadOrRefresh(LegalityCacheStore store,
                                             ScryfallBulkDataClient client,
                                             boolean skipNetwork) {
        Path cacheFile = store.filePath();

        // Fresh cache path — no network call needed.
        if (store.isFresh()) {
            try {
                Map<String, PauperLegality> map = client.parseLegalitiesFromFile(cacheFile);
                return new LoadResult(map, store.lastModified());
            } catch (IOException ex) {
                LOG.warn("Fresh cache file {} failed to parse; will attempt refresh: {}",
                        cacheFile, ex.getMessage());
                // Fall through to refresh path.
            }
        }

        // Refresh path — try network unless explicitly suppressed.
        IOException networkFailure = null;
        if (!skipNetwork) {
            try {
                client.fetchOracleCardsTo(cacheFile);
                Map<String, PauperLegality> map = client.parseLegalitiesFromFile(cacheFile);
                return new LoadResult(map, Instant.now());
            } catch (IOException ex) {
                networkFailure = ex;
                LOG.warn("Failed to refresh Scryfall oracle_cards: {}", ex.getMessage());
                // Fall through to stale-cache fallback.
            }
        }

        // Stale-cache fallback — better-than-nothing if we have it.
        if (store.exists()) {
            try {
                Map<String, PauperLegality> map = client.parseLegalitiesFromFile(cacheFile);
                Instant mtime;
                try {
                    mtime = store.lastModified();
                } catch (IOException ex) {
                    mtime = Instant.EPOCH;
                }
                String reason = networkFailure != null
                        ? networkFailure.getMessage()
                        : "network refresh suppressed";
                LOG.warn("Using stale Scryfall cache from {} — network refresh failed: {}",
                        mtime, reason);
                return new LoadResult(map, mtime);
            } catch (IOException ex) {
                LOG.warn("Stale cache file {} also failed to parse: {}",
                        cacheFile, ex.getMessage());
            }
        }

        // Both paths gone — surface the network failure as the cause if
        // we have one, so the stack trace tells the operator what
        // actually went wrong rather than just "data unavailable".
        String message = "Could not load Scryfall Pauper legality data: no usable cache and "
                + "network fetch failed (or was suppressed).";
        if (networkFailure != null) {
            throw new LegalityDataUnavailableException(message, networkFailure);
        }
        throw new LegalityDataUnavailableException(message);
    }

    /** Tuple of (parsed map, wall-clock at load). */
    private record LoadResult(Map<String, PauperLegality> map, Instant refreshedAt) {
    }

    /**
     * Atomic-swap unit holding both the immutable lookup map and its
     * wall-clock refresh time. Stored in a single
     * {@link AtomicReference} so a refresh can publish them as a pair
     * — no consumer ever sees a map from one fetch paired with a
     * timestamp from another.
     */
    private record LegalitySnapshot(Map<String, PauperLegality> legalities,
                                     Instant refreshedAt) {
    }

    /**
     * Thrown by the constructor when neither the network nor any
     * cached file yields a parseable Scryfall snapshot. Nested rather
     * than a top-level file because (a) it's tightly coupled to this
     * service's failure mode and (b) callers reference it via the
     * service's name, which reads better at use sites
     * ({@code PauperLegalityService.LegalityDataUnavailableException})
     * than a peer-namespaced exception type would.
     */
    public static final class LegalityDataUnavailableException extends RuntimeException {
        public LegalityDataUnavailableException(String message) {
            super(message);
        }

        public LegalityDataUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
