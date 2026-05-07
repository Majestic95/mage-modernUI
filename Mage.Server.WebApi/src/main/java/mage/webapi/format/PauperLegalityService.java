package mage.webapi.format;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;

/**
 * Loads Scryfall's oracle_cards bulk-data once at startup and exposes
 * a name → {@link PauperLegality} lookup. T2.A scope: build + unit
 * tests; not yet wired into deck validation. T2.B will plug
 * {@link #legalityOf(String)} into the Pauper validator override.
 *
 * <p>Design decisions:
 * <ul>
 *   <li><b>Load-once-at-startup, in-memory after.</b> The
 *       oracle_cards file is ~30-40 MB on disk; the parsed map is
 *       ~1-2 MB heap (just String keys and a 5-value enum). Re-parsing
 *       on every validation would be measurably slow; lazy-loading on
 *       first call would push a 5-10 second hitch onto the first
 *       deck validator request. Boot-time load makes the cost
 *       deterministic.</li>
 *   <li><b>Stale-cache fallback.</b> If the network is down at boot
 *       and a stale cache exists on disk, we use it and log WARN.
 *       Refusing to serve any Pauper validation because Scryfall's
 *       CDN had a hiccup would be worse for users than serving a
 *       banlist that's a day or two behind. If both network and cache
 *       fail, the constructor throws and the caller decides — T2.B
 *       will fall back to upstream's rarity-based check.</li>
 *   <li><b>Immutable result map.</b> {@link Map#copyOf(Map)} freezes
 *       the parsed map; lookups are concurrent-safe without locking.
 *       The map field is {@code final}; replacing it would require a
 *       new service instance.</li>
 * </ul>
 */
public final class PauperLegalityService {

    private static final Logger LOG = LoggerFactory.getLogger(PauperLegalityService.class);

    private final Map<String, PauperLegality> legalities;
    private final Instant lastRefreshedAt;

    /**
     * Production constructor. Wires a real
     * {@link ScryfallBulkDataClient} that talks to {@code api.scryfall.com}.
     *
     * @param cacheDir directory for the on-disk cache file. Created
     *                 if missing.
     * @throws LegalityDataUnavailableException if both the network
     *         fetch and any stale cache are unusable.
     */
    public PauperLegalityService(Path cacheDir) {
        this(new LegalityCacheStore(cacheDir), new ScryfallBulkDataClient(), false);
    }

    /**
     * Test seam (package-private). Lets tests inject a fake bulk-data
     * client and pre-stage the cache directory with a fixture file.
     * The {@code skipNetwork} flag short-circuits the
     * fetch-on-stale-cache path so tests with a fresh fixture file
     * never reach for the wire.
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
                          boolean skipNetwork) {
        var loaded = loadOrRefresh(store, client, skipNetwork);
        this.legalities = Map.copyOf(loaded.map);
        this.lastRefreshedAt = loaded.refreshedAt;
        LOG.info("PauperLegalityService initialized with {} card entries (refreshed at {})",
                legalities.size(), lastRefreshedAt);
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
        return legalities.getOrDefault(cardName, PauperLegality.UNKNOWN);
    }

    /** Number of card names in the in-memory map. Diagnostic-only. */
    public int knownCardCount() {
        return legalities.size();
    }

    /**
     * Wall-clock of the last successful data load — either the
     * network fetch's completion time (fresh refresh) or the cache
     * file's mtime (cache hit).
     */
    public Instant lastRefreshedAt() {
        return lastRefreshedAt;
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
