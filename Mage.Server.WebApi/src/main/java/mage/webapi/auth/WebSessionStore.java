package mage.webapi.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory token map backing the WebApi auth layer (ADR 0004).
 * Thread-safe — uses {@link ConcurrentHashMap} internally.
 *
 * <p>Implements the timing rules from ADR 0004 D3:
 * <ul>
 *   <li>Sliding 24 h expiry — every {@link #getAndBump(String)} extends
 *       {@code expiresAt} to {@code now + TOKEN_TTL}, bounded by
 *       {@code createdAt + HARD_CAP}</li>
 *   <li>Hard 7 d cap — entries past their hard cap are evicted no
 *       matter how active</li>
 *   <li>Periodic sweep removes expired entries; caller wires the
 *       schedule</li>
 * </ul>
 *
 * <p>{@link Clock} is injected so tests can advance time deterministically.
 */
public final class WebSessionStore {

    public static final Duration TOKEN_TTL = Duration.ofHours(24);
    public static final Duration HARD_CAP = Duration.ofDays(7);

    private final ConcurrentHashMap<String, SessionEntry> byToken = new ConcurrentHashMap<>();
    private final Clock clock;

    public WebSessionStore() {
        this(Clock.systemUTC());
    }

    public WebSessionStore(Clock clock) {
        this.clock = clock;
    }

    /** Wall-clock instant according to the injected clock. */
    public Instant now() {
        return clock.instant();
    }

    /** Insert or replace by token. Caller is responsible for token uniqueness. */
    public void put(SessionEntry entry) {
        byToken.put(entry.token(), entry);
    }

    /**
     * Look up a token, bump its expiry, and return the updated entry.
     * Returns empty if the token is unknown or expired (in which case
     * it is also evicted).
     */
    public Optional<SessionEntry> getAndBump(String token) {
        SessionEntry entry = byToken.get(token);
        if (entry == null) {
            return Optional.empty();
        }
        Instant now = clock.instant();
        if (now.isAfter(entry.expiresAt()) || now.isAfter(hardCapOf(entry))) {
            byToken.remove(token);
            return Optional.empty();
        }
        Instant slid = now.plus(TOKEN_TTL);
        Instant cap = hardCapOf(entry);
        Instant newExpiresAt = slid.isAfter(cap) ? cap : slid;
        SessionEntry bumped = entry.withExpiresAt(newExpiresAt);
        byToken.put(token, bumped);
        return Optional.of(bumped);
    }

    /** Remove and return; used by logout. */
    public Optional<SessionEntry> remove(String token) {
        return Optional.ofNullable(byToken.remove(token));
    }

    /**
     * Find and remove every entry with the given username. Used by the
     * "newest wins" concurrency rule (ADR 0004 D7) — when a fresh
     * login arrives for an already-logged-in user, prior tokens are
     * revoked.
     */
    public List<SessionEntry> removeAllByUsername(String username) {
        List<SessionEntry> removed = new ArrayList<>();
        byToken.values().removeIf(e -> {
            if (e.username().equalsIgnoreCase(username)) {
                removed.add(e);
                return true;
            }
            return false;
        });
        return removed;
    }

    /** Evict all expired entries. Cheap; safe to call from a scheduler. */
    public int evictExpired() {
        Instant now = clock.instant();
        int[] count = {0};
        byToken.values().removeIf(e -> {
            if (now.isAfter(e.expiresAt()) || now.isAfter(hardCapOf(e))) {
                count[0]++;
                return true;
            }
            return false;
        });
        return count[0];
    }

    public int size() {
        return byToken.size();
    }

    private static Instant hardCapOf(SessionEntry entry) {
        return entry.createdAt().plus(HARD_CAP);
    }
}
