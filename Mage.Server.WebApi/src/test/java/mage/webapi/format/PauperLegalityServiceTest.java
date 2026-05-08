package mage.webapi.format;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for {@link PauperLegalityService} against the
 * {@code pauper-legalities-fixture.json} resource. No network access:
 * tests pre-stage the cache file (fresh-cache path) or inject a
 * client that throws (fallback / failure paths).
 *
 * <p>Each test gets its own {@code @TempDir} cache directory — JUnit
 * cleans these up automatically.
 *
 * <p><b>Note on the synthetic RESTRICTED entry.</b> Pauper has
 * historically been a banned-or-legal binary format with no restricted
 * list. The fixture's {@code "Synthetic Restricted Card"} row is a
 * deliberate fabrication purely to exercise the parser branch for
 * {@link PauperLegality#RESTRICTED}; it is NOT a claim about real
 * Pauper rules. Do not "correct" it to a real card name during fixture
 * maintenance — the synthetic-name signal is the contract.
 *
 * <p><b>Note on the synthetic layout-excluded entries.</b> Names like
 * {@code "Synthetic Token Goblin"}, {@code "Synthetic Emblem"} etc.
 * are deliberately fabricated to exercise the
 * {@code EXCLUDED_LAYOUTS} filter without coupling the test to real
 * Scryfall name+layout combinations. The vanguard-layout entry
 * {@code "Akroma, Angel of Wrath Avatar"} is the one real exception —
 * it actually exists at layout=vanguard on Scryfall (set {@code pmoa}).
 */
class PauperLegalityServiceTest {

    private static final String FIXTURE_RESOURCE = "/scryfall/pauper-legalities-fixture.json";

    /**
     * Number of card entries the parser is expected to surface from
     * the fixture: 30 total entries minus 7 layout-excluded
     * (token / emblem / double_faced_token / art_series / vanguard /
     * scheme / planar) = 23. Update both this constant AND the
     * fixture file together; the comment is the contract.
     */
    private static final int EXPECTED_DECK_LEGAL_COUNT = 23;

    @Test
    void loadsLegalitiesFromFixture(@TempDir Path tmp) throws IOException {
        stageFreshFixture(tmp);
        PauperLegalityService service = newServiceWithRealClient(tmp);

        assertEquals(PauperLegality.LEGAL, service.legalityOf("Lightning Bolt"));
        assertEquals(PauperLegality.LEGAL, service.legalityOf("Counterspell"));
        assertEquals(PauperLegality.LEGAL, service.legalityOf("Forest"));

        assertEquals(PauperLegality.BANNED, service.legalityOf("Treasure Cruise"));
        assertEquals(PauperLegality.BANNED, service.legalityOf("Daze"));
        assertEquals(PauperLegality.BANNED, service.legalityOf("Cloudpost"));
        // Post-2020 erratum-wave bans (added in fixer pass for breadth).
        assertEquals(PauperLegality.BANNED, service.legalityOf("Sojourner's Companion"));
        assertEquals(PauperLegality.BANNED, service.legalityOf("Galvanic Relay"));
        assertEquals(PauperLegality.BANNED, service.legalityOf("Chatterstorm"));
        assertEquals(PauperLegality.BANNED, service.legalityOf("Atog"));

        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Hada Freeblade"));
        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Force of Will"));
        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Black Lotus"));
        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Sol Ring"));
        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Ancestral Recall"));
        // Pradesh Gypsies: in upstream Constructed's structural-ban
        // list (4ED #265, COMMON; banned officially by Wizards in the
        // 2020 racism removals across all formats). T2.B's
        // WebApiPauperValidator clears upstream's hardcoded banlist
        // when the service is wired, so Scryfall's banned verdict has
        // to re-flag this name or the cleared-banlist path becomes a
        // regression. Pinned here so fixture maintenance keeps the
        // entry — see WebApiPauperValidatorTest's coverage of the
        // structural-ban path.
        assertEquals(PauperLegality.BANNED, service.legalityOf("Pradesh Gypsies"));

        assertEquals(PauperLegality.RESTRICTED, service.legalityOf("Synthetic Restricted Card"));

        assertEquals(EXPECTED_DECK_LEGAL_COUNT, service.knownCardCount());
    }

    @Test
    void unknownCardReturnsUNKNOWN(@TempDir Path tmp) throws IOException {
        stageFreshFixture(tmp);
        PauperLegalityService service = newServiceWithRealClient(tmp);

        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Card That Does Not Exist"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf(""));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf(null));
    }

    @Test
    void skipsTokenLayouts(@TempDir Path tmp) throws IOException {
        stageFreshFixture(tmp);
        PauperLegalityService service = newServiceWithRealClient(tmp);

        // The fixture's token / emblem / double_faced_token / art_series
        // / vanguard / scheme / planar entries must NOT appear in the
        // map at all — UNKNOWN is the contractual return for "name not
        // in map", which is what we want.
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Synthetic Token Goblin"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Synthetic Emblem"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Synthetic Double Faced Token"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Synthetic Art Series Card"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Akroma, Angel of Wrath Avatar"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Synthetic Plane Card"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Edge of Malacol"));
    }

    @Test
    void splitCardLookupByFullName(@TempDir Path tmp) throws IOException {
        stageFreshFixture(tmp);
        PauperLegalityService service = newServiceWithRealClient(tmp);

        // Scryfall keys split cards by "Front // Back" verbatim. Looking
        // up either half alone must NOT match — if T2.B's caller passes
        // the wrong shape, we surface UNKNOWN rather than silently
        // serving the wrong verdict. Fire // Ice is genuinely Pauper-
        // legal post-MH2 downshift (set mh2 #332 common) — the lookup
        // returning LEGAL pins that against any future fixture drift.
        assertEquals(PauperLegality.LEGAL, service.legalityOf("Fire // Ice"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Fire"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Ice"));

        // Transform cards: same rule. The full "Front // Back" is the
        // key; the front-face-only string is not.
        assertEquals(PauperLegality.LEGAL,
                service.legalityOf("Delver of Secrets // Insectile Aberration"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Delver of Secrets"));
    }

    @Test
    void cardNameWithSpecialCharsRoundTrips(@TempDir Path tmp) throws IOException {
        stageFreshFixture(tmp);
        PauperLegalityService service = newServiceWithRealClient(tmp);

        // Apostrophe + diacritic. Lim-Dûl's Vault stores with the û on
        // Scryfall — verbatim match required.
        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Lim-Dûl's Vault"));
        // Scryfall normalizes Æ → "Ae" in the canonical name field
        // (verified against api.scryfall.com), so the realistic stored
        // name is "Aether Spellbomb". Looking up the legacy "Æther"
        // glyph must NOT match — that would mean we silently
        // ASCII-fold queries, which would also match other cards we
        // didn't intend.
        assertEquals(PauperLegality.LEGAL, service.legalityOf("Aether Spellbomb"));
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Æther Spellbomb"));

        // Sanity: ASCII-fold-and-pray would silently match
        // "Lim-Dul's Vault" — we must NOT do that. The bug prevented by
        // this test is the whole reason name lookup is verbatim.
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("Lim-Dul's Vault"));
    }

    @Test
    void staleCacheReUsedIfNetworkDown(@TempDir Path tmp) throws IOException {
        // Stage the fixture, then backdate it past the TTL so the
        // service won't take the fresh-cache path.
        Path cacheFile = tmp.resolve(LegalityCacheStore.CACHE_FILE_NAME);
        copyFixtureTo(cacheFile);
        Files.setLastModifiedTime(cacheFile,
                FileTime.from(Instant.now().minus(25, ChronoUnit.HOURS)));

        LegalityCacheStore store = new LegalityCacheStore(tmp);
        assertFalse(store.isFresh(), "precondition: backdated cache should be stale");

        ScryfallBulkDataClient throwingClient = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(), new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) throws IOException {
                throw new IOException("simulated network failure");
            }
        };

        // Service must NOT throw — it falls back to the stale file.
        PauperLegalityService service = new PauperLegalityService(
                store, throwingClient, false, Duration.ZERO);
        assertEquals(PauperLegality.NOT_LEGAL, service.legalityOf("Hada Freeblade"));
        assertNotNull(service.lastRefreshedAt());
    }

    @Test
    void bothCacheAndNetworkFailedThrowsLegalityDataUnavailable(@TempDir Path tmp) {
        // Empty cache dir + a client whose fetch throws. The service
        // should give up and let the caller decide what fallback to
        // run (T2.B: upstream rarity check).
        LegalityCacheStore store = new LegalityCacheStore(tmp);
        assertFalse(store.exists(), "precondition: cache file must not exist");

        ScryfallBulkDataClient throwingClient = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(), new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) throws IOException {
                throw new IOException("simulated network failure");
            }
        };

        PauperLegalityService.LegalityDataUnavailableException ex = assertThrows(
                PauperLegalityService.LegalityDataUnavailableException.class,
                () -> new PauperLegalityService(
                        store, throwingClient, false, Duration.ZERO));
        assertTrue(ex.getMessage().toLowerCase().contains("scryfall"),
                "exception message should mention Scryfall: " + ex.getMessage());
    }

    @Test
    void skipNetworkRespectsExistingFreshFixture(@TempDir Path tmp) throws IOException {
        // Belt-and-braces: with skipNetwork=true and a fresh fixture
        // already on disk, the service must load purely from the
        // fixture without ever calling fetchOracleCardsTo. We prove
        // it by injecting a client whose fetch would explode if hit.
        stageFreshFixture(tmp);
        LegalityCacheStore store = new LegalityCacheStore(tmp);

        ScryfallBulkDataClient noFetchClient = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(), new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) throws IOException {
                throw new AssertionError("fetchOracleCardsTo must not be called when "
                        + "fresh cache exists");
            }
        };

        PauperLegalityService service = new PauperLegalityService(
                store, noFetchClient, true, Duration.ZERO);
        assertEquals(PauperLegality.LEGAL, service.legalityOf("Lightning Bolt"));
        // A non-zero card count proves the fixture really loaded.
        assertNotEquals(0, service.knownCardCount());
    }

    @Test
    void refreshOnce_swapsSnapshotOnSuccess(@TempDir Path tmp) throws IOException {
        // Stage the real fixture so the constructor's initial load
        // succeeds and the snapshot has known content.
        stageFreshFixture(tmp);
        LegalityCacheStore store = new LegalityCacheStore(tmp);

        // Inject a client whose fetchOracleCardsTo overwrites the
        // cache file with a tiny synthetic JSON containing one new
        // card name we can probe for. parseLegalitiesFromFile is
        // delegated to the real implementation so the parse contract
        // (layout filtering, name-key extraction) is exercised end-
        // to-end. This proves the refresh path actually re-parses the
        // file — not just that the snapshot reference changed.
        Path fixtureRewriteSource = writeMinimalFixture(tmp.resolve("rewrite.json"),
                Map.of("T2C Refresh Probe", "legal"));
        ScryfallBulkDataClient rewritingClient = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(),
                new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) throws IOException {
                Files.copy(fixtureRewriteSource, destination,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        };

        PauperLegalityService service = new PauperLegalityService(
                store, rewritingClient, true, Duration.ZERO);

        // Pre-condition: the boot snapshot is the real fixture; the
        // probe name does NOT exist there.
        Instant initialRefreshedAt = service.lastRefreshedAt();
        assertEquals(PauperLegality.UNKNOWN, service.legalityOf("T2C Refresh Probe"));
        int initialCount = service.knownCardCount();

        // Driving refreshOnce manually replaces the snapshot with the
        // synthetic content the rewrite client just wrote. Sleep a
        // millisecond so the new Instant.now() can't equal the prior
        // one on coarse-clock systems.
        try {
            Thread.sleep(2);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        service.refreshOnce();

        assertEquals(PauperLegality.LEGAL, service.legalityOf("T2C Refresh Probe"));
        // The synthetic fixture has only the one entry — count drops
        // from ~23 to 1, proving we picked up the new file.
        assertEquals(1, service.knownCardCount());
        assertNotEquals(initialCount, service.knownCardCount());
        assertTrue(service.lastRefreshedAt().isAfter(initialRefreshedAt),
                "refreshedAt should advance after a successful refresh");
    }

    @Test
    void refreshOnce_failureKeepsPriorSnapshot(@TempDir Path tmp) throws IOException {
        stageFreshFixture(tmp);
        LegalityCacheStore store = new LegalityCacheStore(tmp);

        ScryfallBulkDataClient throwingClient = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(),
                new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) throws IOException {
                throw new IOException("simulated refresh failure");
            }
        };

        // Initial constructor takes the fresh-cache path (skipNetwork
        // true) so the failing fetch doesn't blow up boot. The first
        // network call is now the manual refreshOnce below.
        PauperLegalityService service = new PauperLegalityService(
                store, throwingClient, true, Duration.ZERO);

        Instant initialRefreshedAt = service.lastRefreshedAt();
        int initialCount = service.knownCardCount();
        PauperLegality initialBoltVerdict = service.legalityOf("Lightning Bolt");

        // refreshOnce must swallow the IOException — the scheduler
        // contract requires it (a thrown runnable kills future ticks).
        // The prior snapshot stays in place.
        service.refreshOnce();

        assertEquals(initialCount, service.knownCardCount());
        assertEquals(initialRefreshedAt, service.lastRefreshedAt());
        assertEquals(initialBoltVerdict, service.legalityOf("Lightning Bolt"));
    }

    @Test
    void firstRefreshDelay_accountsForSnapshotAge() {
        Duration interval = Duration.ofHours(24);

        long nearExpiredDelay = PauperLegalityService.firstRefreshDelayMillisForTest(
                Instant.now().minus(23, ChronoUnit.HOURS).minus(59, ChronoUnit.MINUTES),
                interval);
        assertTrue(nearExpiredDelay > 0 && nearExpiredDelay <= TimeUnit.MINUTES.toMillis(2),
                "nearly-expired cache should refresh almost immediately, got "
                        + nearExpiredDelay + "ms");

        long freshDelay = PauperLegalityService.firstRefreshDelayMillisForTest(
                Instant.now(), interval);
        assertTrue(freshDelay > TimeUnit.HOURS.toMillis(23),
                "fresh network/cache snapshot should wait close to the full interval, got "
                        + freshDelay + "ms");

        long staleDelay = PauperLegalityService.firstRefreshDelayMillisForTest(
                Instant.now().minus(25, ChronoUnit.HOURS), interval);
        assertEquals(1L, staleDelay,
                "already-stale snapshot should schedule the first refresh immediately");
    }

    @Test
    void close_stopsScheduledExecutor(@TempDir Path tmp) throws Exception {
        stageFreshFixture(tmp);
        LegalityCacheStore store = new LegalityCacheStore(tmp);
        // Offline-safe client — refreshOnce's network call is a no-op,
        // so a tick that fires while we're sleeping below doesn't
        // talk to the real Scryfall during a unit-test run.
        ScryfallBulkDataClient offlineClient = new ScryfallBulkDataClient(
                HttpClient.newHttpClient(),
                new ObjectMapper().getFactory()) {
            @Override
            public void fetchOracleCardsTo(Path destination) {
                // Cache file already on disk from stageFreshFixture;
                // the tick will re-parse it after we "fetch".
            }
        };

        // Tight interval so a tick has a chance to fire before close.
        // Constructor returns immediately — initial load uses
        // skipNetwork=true off the fresh fixture.
        PauperLegalityService service = new PauperLegalityService(
                store, offlineClient, true, Duration.ofMillis(50));

        // Brief sleep gives the scheduler a chance to attempt a tick.
        // refreshOnce's Throwable catch swallows any unexpected fault
        // so the executor stays alive ready for the next tick — that's
        // exactly the property close() then needs to stop.
        Thread.sleep(120);

        long closeStart = System.nanoTime();
        service.close();
        // close() calls shutdownNow; we can't call awaitTermination on
        // the executor directly (it's private), but the public
        // contract is "no leaked threads". Verify by polling the JVM's
        // thread set: the named refresh thread must be gone within a
        // generous deadline.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        boolean threadGone = false;
        while (System.nanoTime() < deadline) {
            if (!hasThreadNamed("webapi-pauper-legality-refresh")) {
                threadGone = true;
                break;
            }
            Thread.sleep(20);
        }
        assertTrue(threadGone,
                "webapi-pauper-legality-refresh thread should be terminated within 2s of close(); "
                        + "elapsed " + ((System.nanoTime() - closeStart) / 1_000_000) + "ms");

        // close() is idempotent — calling again should be a no-op.
        service.close();
    }

    // --- helpers ---

    /**
     * Write a synthetic Scryfall-shaped fixture containing one entry per
     * map row, each shaped like the real bulk-data: a JSON object array
     * with {@code name}, {@code layout="normal"}, and a
     * {@code legalities} sub-object whose {@code pauper} key carries
     * the verdict. Used by the refresh-success test to drop a
     * known-content payload into the cache file path.
     */
    private static Path writeMinimalFixture(Path destination,
                                             Map<String, String> nameToVerdict)
            throws IOException {
        StringBuilder sb = new StringBuilder("[\n");
        boolean first = true;
        for (Map.Entry<String, String> e : nameToVerdict.entrySet()) {
            if (!first) sb.append(",\n");
            first = false;
            sb.append("  {")
                    .append("\"object\":\"card\",")
                    .append("\"name\":\"").append(jsonEscape(e.getKey())).append("\",")
                    .append("\"layout\":\"normal\",")
                    .append("\"legalities\":{\"pauper\":\"")
                    .append(jsonEscape(e.getValue())).append("\"}")
                    .append("}");
        }
        sb.append("\n]\n");
        Files.writeString(destination, sb.toString(), StandardCharsets.UTF_8);
        return destination;
    }

    private static String jsonEscape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static boolean hasThreadNamed(String name) {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (name.equals(t.getName()) && t.isAlive()) {
                return true;
            }
        }
        return false;
    }

    /**
     * Copy the bundled fixture to the cache filename inside {@code tmp}.
     * The file's mtime is "now" so the cache reads as fresh.
     */
    private static void stageFreshFixture(Path tmp) throws IOException {
        copyFixtureTo(tmp.resolve(LegalityCacheStore.CACHE_FILE_NAME));
    }

    private static void copyFixtureTo(Path destination) throws IOException {
        try (InputStream in = PauperLegalityServiceTest.class.getResourceAsStream(FIXTURE_RESOURCE)) {
            if (in == null) {
                throw new IOException("fixture resource not found: " + FIXTURE_RESOURCE);
            }
            Files.createDirectories(destination.getParent());
            Files.copy(in, destination);
        }
    }

    /**
     * Service with the real bulk-data client but {@code skipNetwork=true}
     * so the constructor never reaches for the wire — the fresh cache
     * staged via {@link #stageFreshFixture} is enough.
     */
    private static PauperLegalityService newServiceWithRealClient(Path tmp) {
        LegalityCacheStore store = new LegalityCacheStore(tmp);
        ScryfallBulkDataClient client = new ScryfallBulkDataClient();
        return new PauperLegalityService(store, client, true, Duration.ZERO);
    }
}
