package mage.webapi.auth;

import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Slice F21.3 (2026-05-04, audit Sec B2) — in-memory per-username
 * login-attempt lockout tracker. Defends against credential brute-
 * force attacks that rotate IPs (defeating the per-IP rate limiter).
 *
 * <p><b>Why in-memory, not persistent.</b> Upstream's
 * {@link mage.server.AuthorizedUser#lockedUntil} field exists but has
 * no setter, and the repository has no update API. Adding one would
 * touch upstream code. The in-memory approach has acceptable
 * properties for our threat model:
 * <ul>
 *   <li>Lockouts reset on JVM restart — an attacker can defeat the
 *       lockout by waiting for an admin-triggered restart, but this
 *       is rare and the wait is itself a deterrent.</li>
 *   <li>Pre-authentication state is unsafe to persist anyway —
 *       writing to disk on every failed login amplifies a DoS.</li>
 *   <li>Process-wide lock state matches our single-WebApi
 *       deployment shape; no need to coordinate across replicas.</li>
 * </ul>
 *
 * <p><b>Lockout policy.</b> After {@link #FAILURE_THRESHOLD}
 * consecutive failures, the username is locked for
 * {@link #INITIAL_LOCKOUT_MS} milliseconds. Subsequent failures
 * after the lockout expires double the duration up to
 * {@link #MAX_LOCKOUT_MS}. A successful login resets the counter
 * and clears the lockout.
 *
 * <p>Username keys are lowercased so case variants of the same name
 * share state (matches upstream's case-insensitive duplicate check).
 *
 * <p>This tracker is NOT consulted before the username has been
 * validated — feeding malformed usernames to it would bloat the
 * map. Callers must validate first.
 */
public final class LoginAttemptTracker {

    /** Failures before the FIRST lockout fires. */
    static final int FAILURE_THRESHOLD = 5;

    /** First lockout duration (after FAILURE_THRESHOLD failures). */
    static final long INITIAL_LOCKOUT_MS = 15L * 60L * 1000L; // 15 min

    /** Cap on exponential backoff. */
    static final long MAX_LOCKOUT_MS = 24L * 60L * 60L * 1000L; // 24 h

    private static final class State {
        int failures;
        long lockedUntilEpochMs; // 0 = not locked
        long currentLockoutMs;    // last applied duration; 0 = none yet
    }

    private final ConcurrentHashMap<String, State> byUsername =
            new ConcurrentHashMap<>();

    private static String key(String username) {
        return username == null ? "" : username.toLowerCase(Locale.ROOT);
    }

    /**
     * Returns the millis-since-epoch at which the username's lockout
     * expires, or 0 if not currently locked. Caller compares with
     * {@code System.currentTimeMillis()}.
     */
    public long lockedUntil(String username) {
        State s = byUsername.get(key(username));
        if (s == null) return 0L;
        long now = System.currentTimeMillis();
        synchronized (s) {
            if (s.lockedUntilEpochMs > now) return s.lockedUntilEpochMs;
            return 0L;
        }
    }

    /** Convenience: is the username currently locked out? */
    public boolean isLocked(String username) {
        return lockedUntil(username) > 0L;
    }

    /**
     * Record a failed login attempt. Increments the counter and, on
     * crossing the threshold, applies a fresh lockout (with
     * exponential backoff up to {@link #MAX_LOCKOUT_MS}).
     */
    public void recordFailure(String username) {
        String k = key(username);
        State s = byUsername.computeIfAbsent(k, _k -> new State());
        synchronized (s) {
            s.failures++;
            if (s.failures >= FAILURE_THRESHOLD) {
                long next;
                if (s.currentLockoutMs == 0L) {
                    next = INITIAL_LOCKOUT_MS;
                } else {
                    next = Math.min(MAX_LOCKOUT_MS, s.currentLockoutMs * 2L);
                }
                s.currentLockoutMs = next;
                s.lockedUntilEpochMs = System.currentTimeMillis() + next;
                // Reset the failures counter so the NEXT lockout
                // requires a fresh batch of failures rather than
                // firing immediately on the next attempt.
                s.failures = 0;
            }
        }
    }

    /**
     * Record a successful login. Clears any existing failure count
     * and lockout state for this username.
     */
    public void recordSuccess(String username) {
        byUsername.remove(key(username));
    }

    /** Test hook — wipe all tracker state. */
    void __reset() {
        byUsername.clear();
    }
}
