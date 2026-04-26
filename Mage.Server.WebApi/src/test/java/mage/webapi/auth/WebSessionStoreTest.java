package mage.webapi.auth;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Unit tests for the in-memory token store. Time is driven by
 * {@link TestClock} for determinism.
 */
class WebSessionStoreTest {

    private static final Instant T0 = Instant.parse("2026-04-25T00:00:00Z");

    @Test
    void put_thenGetAndBump_extendsExpiresAt() {
        TestClock clock = new TestClock(T0);
        WebSessionStore store = new WebSessionStore(clock);

        store.put(entry("tok", "alice", T0, T0.plus(WebSessionStore.TOKEN_TTL)));

        clock.advance(Duration.ofHours(1));
        Optional<SessionEntry> bumped = store.getAndBump("tok");
        assertTrue(bumped.isPresent());
        // After bump, expiresAt = now + TOKEN_TTL = T0+1h + 24h = T0+25h
        assertEquals(T0.plusSeconds(25 * 3600), bumped.get().expiresAt());
    }

    @Test
    void getAndBump_pastExpiry_returnsEmptyAndEvicts() {
        TestClock clock = new TestClock(T0);
        WebSessionStore store = new WebSessionStore(clock);
        store.put(entry("tok", "alice", T0, T0.plus(Duration.ofMinutes(5))));

        clock.advance(Duration.ofMinutes(10));
        assertTrue(store.getAndBump("tok").isEmpty());
        assertEquals(0, store.size(), "expired entry must be evicted on getAndBump");
    }

    @Test
    void hardCap_isHonoredEvenWithContinuousActivity() {
        TestClock clock = new TestClock(T0);
        WebSessionStore store = new WebSessionStore(clock);
        store.put(entry("tok", "alice", T0, T0.plus(WebSessionStore.TOKEN_TTL)));

        // Bump every 12 h for 8 days; the hard cap (7 d) caps the
        // returned expiresAt and after T0+7d the token must be gone.
        for (int i = 0; i < 16; i++) {
            clock.advance(Duration.ofHours(12));
            store.getAndBump("tok");
        }
        Instant cap = T0.plus(WebSessionStore.HARD_CAP);
        // Now at T0 + 8d. Should be past hard cap → evicted.
        Optional<SessionEntry> e = store.getAndBump("tok");
        assertTrue(e.isEmpty(), "token must be evicted after hard cap");
        assertEquals(0, store.size());
    }

    @Test
    void evictExpired_removesOnlyExpired() {
        TestClock clock = new TestClock(T0);
        WebSessionStore store = new WebSessionStore(clock);
        store.put(entry("alive", "alice", T0, T0.plus(Duration.ofHours(2))));
        store.put(entry("dead", "bob", T0, T0.plus(Duration.ofMinutes(5))));

        clock.advance(Duration.ofMinutes(10));
        int evicted = store.evictExpired();
        assertEquals(1, evicted);
        assertEquals(1, store.size());
        assertTrue(store.getAndBump("alive").isPresent());
        assertTrue(store.getAndBump("dead").isEmpty());
    }

    @Test
    void evictExpiredEntries_returnsRemovedSessionEntries() {
        // The evictExpiredEntries() variant returns the SessionEntry
        // for each eviction so AuthService.sweep can run downstream
        // cleanup (close sockets, disconnect upstream). The slice-1
        // sweep used to drop the count only — leak fix 2026-04-26.
        TestClock clock = new TestClock(T0);
        WebSessionStore store = new WebSessionStore(clock);
        store.put(entry("dead-1", "alice", T0, T0.plus(Duration.ofMinutes(5))));
        store.put(entry("dead-2", "bob", T0, T0.plus(Duration.ofMinutes(5))));
        store.put(entry("alive", "carol", T0, T0.plus(Duration.ofHours(2))));

        clock.advance(Duration.ofMinutes(10));
        List<SessionEntry> evicted = store.evictExpiredEntries();
        assertEquals(2, evicted.size());
        // Both evicted entries must carry their upstream session ID
        // so the caller can disconnect upstream.
        for (SessionEntry e : evicted) {
            assertFalse(e.upstreamSessionId().isBlank());
        }
        assertEquals(1, store.size());
    }

    @Test
    void removeAllByUsername_revokesPriorTokens_caseInsensitive() {
        TestClock clock = new TestClock(T0);
        WebSessionStore store = new WebSessionStore(clock);
        store.put(entry("a", "Alice", T0, T0.plus(Duration.ofHours(1))));
        store.put(entry("b", "alice", T0, T0.plus(Duration.ofHours(1))));
        store.put(entry("c", "Bob", T0, T0.plus(Duration.ofHours(1))));

        List<SessionEntry> removed = store.removeAllByUsername("alice");
        assertEquals(2, removed.size());
        assertEquals(1, store.size());
        assertTrue(store.getAndBump("c").isPresent());
    }

    @Test
    void remove_returnsRemovedEntry() {
        WebSessionStore store = new WebSessionStore(new TestClock(T0));
        store.put(entry("tok", "alice", T0, T0.plus(Duration.ofHours(1))));

        Optional<SessionEntry> removed = store.remove("tok");
        assertTrue(removed.isPresent());
        assertEquals(0, store.size());
        assertTrue(store.remove("tok").isEmpty(), "second remove is no-op");
    }

    @Test
    void getAndBump_unknownToken_returnsEmpty() {
        WebSessionStore store = new WebSessionStore(new TestClock(T0));
        assertFalse(store.getAndBump("nope").isPresent());
    }

    private static SessionEntry entry(String token, String username, Instant created, Instant expires) {
        return new SessionEntry(token, "upstream-" + token, username, false, false, created, expires);
    }
}
