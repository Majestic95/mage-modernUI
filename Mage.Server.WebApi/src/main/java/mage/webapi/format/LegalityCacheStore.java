package mage.webapi.format;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

/**
 * Owns the on-disk cache file holding Scryfall's oracle_cards JSON.
 * Pure path + freshness arithmetic — no parsing, no HTTP, no in-memory
 * data. {@link PauperLegalityService} composes this with a
 * {@link ScryfallBulkDataClient} to drive the load-or-refresh
 * decision.
 *
 * <p>Design decisions:
 * <ul>
 *   <li><b>24-hour TTL</b> — Scryfall regenerates oracle_cards roughly
 *       daily. Refreshing more often is wasted work; refreshing less
 *       often risks serving a banlist that's been updated by Wizards
 *       (B&amp;R announcements happen on Mondays). 24h matches their
 *       cadence comfortably.</li>
 *   <li><b>No locking</b> — only one writer can exist (the WebApi
 *       process boots a single {@link PauperLegalityService}) and
 *       refreshes happen at boot, before the service is exposed. If
 *       T2.B adds a runtime refresh path, the writer will need a
 *       single-threaded executor or a lock; we cross that bridge then,
 *       not now.</li>
 *   <li><b>Cache directory creation in constructor</b> — fail-fast: if
 *       the path is unwritable, we'd rather know at boot than on the
 *       first refresh attempt.</li>
 * </ul>
 */
public final class LegalityCacheStore {

    private static final Logger LOG = LoggerFactory.getLogger(LegalityCacheStore.class);

    /**
     * Single canonical filename for the oracle_cards snapshot. Held
     * inside {@code cacheDir}; the parent directory is what changes
     * per environment ({@code mage-stack/cache} in prod, a JUnit
     * {@code @TempDir} in tests).
     */
    static final String CACHE_FILE_NAME = "scryfall-pauper-legalities.json";

    /**
     * Stale-after window. See class Javadoc for rationale.
     */
    static final Duration CACHE_TTL = Duration.ofHours(24);

    private final Path cacheDir;
    private final Path filePath;

    public LegalityCacheStore(Path cacheDir) {
        this.cacheDir = cacheDir;
        this.filePath = cacheDir.resolve(CACHE_FILE_NAME);
        prepareDir();
        LOG.info("LegalityCacheStore initialized at {}", filePath);
    }

    /**
     * Path of the cache file (may or may not exist yet).
     */
    public Path filePath() {
        return filePath;
    }

    /**
     * True iff the cache file exists and its mtime is within
     * {@link #CACHE_TTL} of now. False on missing file, future mtime
     * (clock skew), or any IO error reading the mtime.
     */
    public boolean isFresh() {
        if (!Files.exists(filePath)) {
            return false;
        }
        try {
            Instant mtime = Files.getLastModifiedTime(filePath).toInstant();
            Duration age = Duration.between(mtime, Instant.now());
            // Negative age = mtime is in the future (clock skew /
            // restored backup). Treat as stale to force a refresh
            // rather than serve a file we can't reason about.
            if (age.isNegative()) {
                LOG.warn("Cache file {} has future mtime {}; treating as stale",
                        filePath, mtime);
                return false;
            }
            return age.compareTo(CACHE_TTL) < 0;
        } catch (IOException ex) {
            LOG.warn("Could not stat cache file {}; treating as stale: {}",
                    filePath, ex.getMessage());
            return false;
        }
    }

    /**
     * Wall-clock mtime of the cache file. Caller must check
     * {@link #exists()} first.
     */
    public Instant lastModified() throws IOException {
        return Files.getLastModifiedTime(filePath).toInstant();
    }

    /**
     * True iff the cache file is present on disk (regardless of
     * freshness). Useful for the stale-fallback path where we want to
     * use a stale file when the network is down.
     */
    public boolean exists() {
        return Files.exists(filePath);
    }

    /**
     * Create the cache directory if missing. Called from constructor
     * so misconfigured paths fail at boot rather than refresh time.
     *
     * <p>Pre-checks for the "path exists as a regular file" case so we
     * surface a clear error rather than the generic
     * {@link java.nio.file.FileAlreadyExistsException} that
     * {@link Files#createDirectories} raises in that case.
     */
    private void prepareDir() {
        if (Files.exists(cacheDir) && !Files.isDirectory(cacheDir)) {
            throw new IllegalStateException(
                    "Legality cache path exists but is not a directory: " + cacheDir
                            + " — remove it or set XMAGE_LEGALITY_CACHE_DIR elsewhere");
        }
        try {
            Files.createDirectories(cacheDir);
        } catch (IOException ex) {
            throw new IllegalStateException(
                    "Could not create legality cache directory: " + cacheDir, ex);
        }
    }
}
