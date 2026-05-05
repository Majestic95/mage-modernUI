package mage.webapi.auth;

import mage.webapi.WebApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.Objects;

/**
 * Owns the password-recovery surface introduced in slice F24 and the
 * code-lifecycle helpers carved out of {@link AuthService} in slice
 * F24.2 (2026-05-05).
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>{@link #recoverPassword} — verify a one-time recovery code,
 *       reset the user's password, and rotate the code atomically.</li>
 *   <li>{@link #generateRecoveryCode} / {@link #buildRecoveryRow} —
 *       static helpers used both by this class (recover/rotate) and by
 *       {@code AuthService.registerWithRecoveryCode} (mint at signup).</li>
 *   <li>{@link #canonicalizeRecoveryCode} — Crockford-spec input
 *       normalization shared by verify + hash + tests.</li>
 *   <li>{@link #isRecoveryEnabled} — separate gate from the
 *       registration flag so an operator can keep recovery available
 *       while pausing new signups.</li>
 *   <li>Per-username recovery-attempt lockout tracking, kept
 *       deliberately separate from the login lockout so forgotten-
 *       password typos don't bleed into sign-in.</li>
 * </ul>
 *
 * <p>Synchronization: {@link #recoverPassword} holds the upstream
 * {@code AuthorizedUserRepository} singleton monitor for the entire
 * verify → password-reset → rotate sequence (audit C2 / F24.1
 * single-use semantics under concurrency). Disconnect of any prior
 * sessions for the same username happens OUTSIDE the lock to avoid
 * holding the upstream monitor while tearing down sockets.
 */
public final class RecoveryService {

    private static final Logger LOG = LoggerFactory.getLogger(RecoveryService.class);

    /**
     * Slice F24 — Crockford base32 alphabet (0-9 + A-Z minus I, L,
     * O, U). 32 chars; 5 bits per char. 24 generated chars carry
     * 120 bits of entropy. The omitted letters defend against typo
     * confusion (I↔1, L↔1, O↔0) and the omitted U avoids accidental
     * profanity. See <a href="https://www.crockford.com/base32.html">
     * Crockford's spec</a>.
     */
    private static final String CROCKFORD_BASE32 =
            "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    /**
     * Local {@link SecureRandom} for code generation. Independent
     * from {@link AuthService}'s instance so RecoveryService is
     * standalone-testable; both are thread-safe internally.
     */
    private static final SecureRandom RNG = new SecureRandom();

    private final AuthService authService;

    /**
     * Slice F24 — per-username lockout tracker dedicated to recovery
     * attempts. Distinct from {@link AuthService}'s login-attempt
     * tracker so a flurry of forgotten-password typos doesn't lock
     * the user out of sign-in too (and vice-versa). Same
     * threshold/backoff curve, different bucket.
     */
    private final LoginAttemptTracker recoverAttempts = new LoginAttemptTracker();

    public RecoveryService(AuthService authService) {
        this.authService = Objects.requireNonNull(authService, "authService is required");
    }

    /**
     * Slice F24.1 (post-review) — separate gate for the recovery
     * surface. Operators who flip {@code XMAGE_REGISTRATION_ENABLED}
     * off to stop new signups should NOT also lock existing users
     * out of password reset. Recovery defaults to the registration
     * flag's value when {@code XMAGE_RECOVERY_ENABLED} is unset, so
     * existing deployments are unaffected; an operator who wants to
     * keep recovery available while signups are paused sets
     * {@code XMAGE_RECOVERY_ENABLED=true} explicitly.
     *
     * <p>JVM-property fallback (matches
     * {@link AuthService#isRegistrationEnabled}) for unit-test
     * ergonomics.
     */
    public static boolean isRecoveryEnabled() {
        String env = System.getenv("XMAGE_RECOVERY_ENABLED");
        if (env != null) {
            String norm = env.trim().toLowerCase();
            return norm.equals("true") || norm.equals("1");
        }
        String prop = System.getProperty("xmage.recoveryEnabled");
        if (prop != null) {
            String norm = prop.trim().toLowerCase();
            return norm.equals("true") || norm.equals("1");
        }
        // Default: follow registration flag, so existing operators
        // see no behavior change after F24.1.
        return AuthService.isRegistrationEnabled();
    }

    /**
     * Slice F24 (2026-05-04) — reset a user's password using a one-
     * time recovery code. On success, the user's stored password
     * hash is replaced (preserving the original synthesized email
     * placeholder), the recovery code is rotated, and the new
     * cleartext code is returned for one-time display.
     *
     * <p>The recovery code is normalized (uppercase, stripped of
     * separators, common visual confusables coerced to their canonical
     * digit) before comparison so a user who types the code with
     * mixed case, spaces, or hyphens still recovers successfully.
     *
     * <p>Throws:
     * <ul>
     *   <li>403 {@code REGISTRATION_DISABLED} — recovery flag is off</li>
     *   <li>400 {@code INVALID_PASSWORD} — new password fails policy</li>
     *   <li>401 {@code INVALID_RECOVERY} — username unknown OR code
     *       mismatch (uniform; do not split)</li>
     *   <li>429 {@code ACCOUNT_LOCKED} — too many recovery attempts
     *       for this username</li>
     *   <li>500 {@code UPSTREAM_ERROR} — repository write failed</li>
     * </ul>
     */
    public String recoverPassword(String username, String recoveryCode, String newPassword) {
        if (!isRecoveryEnabled()) {
            throw new WebApiException(403, "REGISTRATION_DISABLED",
                    "Account recovery is disabled on this server.");
        }
        if (username == null || username.isBlank()) {
            // Wire shape uniform with wrong-code path so a blank
            // username can't be distinguished from an unknown one.
            throw new WebApiException(401, "INVALID_RECOVERY",
                    "Recovery failed. Check your username and recovery code.");
        }
        String trimmed = username.trim();
        // Normalize new password identically to register's path.
        if (newPassword == null) {
            throw new WebApiException(400, "INVALID_PASSWORD",
                    "Password must be at least 8 characters.");
        }
        String normalizedNew =
                java.text.Normalizer.normalize(newPassword, java.text.Normalizer.Form.NFKC);
        if (normalizedNew.length() < 8) {
            throw new WebApiException(400, "INVALID_PASSWORD",
                    "Password must be at least 8 characters.");
        }
        if (normalizedNew.length() > 128) {
            throw new WebApiException(400, "INVALID_PASSWORD",
                    "Password must be 128 characters or fewer.");
        }
        // Lockout check before any expensive work — fires uniformly
        // for known and unknown usernames (the unknown-username path
        // never calls recordFailure here, so it can't generate a
        // user-specific lockout, but a hammering attacker still gets
        // the global per-IP rate limit at the route layer).
        long lockedUntilMs = recoverAttempts.lockedUntil(trimmed);
        if (lockedUntilMs > 0L) {
            long remainingSec =
                    Math.max(1L, (lockedUntilMs - System.currentTimeMillis()) / 1000L);
            throw new WebApiException(429, "ACCOUNT_LOCKED",
                    "Too many recovery attempts for this account. "
                            + "Try again in " + remainingSec + " seconds.");
        }

        // F24.1 (post-review) — verify, password-reset, and code-
        // rotate all run UNDER the upstream-repo monitor. Pre-F24.1
        // the verify step ran outside the lock, so two concurrent
        // recovers presenting the SAME valid C1 could both pass
        // verify, both enter the lock serially, and both succeed —
        // breaking single-use semantics (whichever rotation wrote
        // last won; the loser's password change was silently
        // overwritten and the loser was shown a code that doesn't
        // verify against the persisted hash).
        //
        // With verify inside the lock, the second thread re-reads
        // the (rotated) recovery row after the first thread exits
        // and the verify fails → 401 INVALID_RECOVERY → the failure
        // counter ticks. Single-use semantics hold under concurrency.
        String fresh;
        synchronized (mage.server.AuthorizedUserRepository.getInstance()) {
            mage.server.AuthorizedUser stored = mage.server.AuthorizedUserRepository
                    .getInstance().getByName(trimmed);
            RecoveryCodeRow row = stored == null
                    ? null
                    : RecoveryCodeRepository.getInstance().getByUsername(trimmed);
            if (stored == null || row == null) {
                // Unknown user OR a known user with no recovery row
                // (a pre-F24 account, or one whose recovery row was
                // wiped). Uniform wire response matches the wrong-
                // code path so an attacker can't distinguish.
                LOG.info("Recovery failed: user={} reason={}",
                        trimmed, stored == null ? "unknown-user" : "no-row");
                throw new WebApiException(401, "INVALID_RECOVERY",
                        "Recovery failed. Check your username and recovery code.");
            }

            String canonicalSupplied = canonicalizeRecoveryCode(recoveryCode);
            if (canonicalSupplied.isEmpty()
                    || !verifyRecoveryHash(row, canonicalSupplied)) {
                recoverAttempts.recordFailure(trimmed);
                LOG.info("Recovery failed: user={} reason=wrong-code", trimmed);
                throw new WebApiException(401, "INVALID_RECOVERY",
                        "Recovery failed. Check your username and recovery code.");
            }

            // Verified — reset the failure streak and apply the new
            // password. We replace via remove + add because upstream
            // has no setPassword() — only its ctor stamps the four
            // hash fields atomically. We do NOT preserve the user's
            // lockedUntil / chatLockedUntil / active flags because
            // (a) WebApi doesn't write any of those and (b) a
            // successful recovery is the user's "fresh start" moment.
            recoverAttempts.recordSuccess(trimmed);

            String email = trimmed.toLowerCase(Locale.ROOT) + "@local.invalid";
            mage.server.AuthorizedUserRepository.getInstance().remove(trimmed);
            mage.server.AuthorizedUserRepository.getInstance()
                    .add(trimmed, normalizedNew, email);
            if (mage.server.AuthorizedUserRepository.getInstance().getByName(trimmed) == null) {
                throw new WebApiException(500, "UPSTREAM_ERROR",
                        "Server error during recovery. Please try again.");
            }

            // Rotate: persist a NEW recovery code under the same
            // lock, so concurrent recover requests deterministically
            // see the new code (or 401 if they had the old one).
            // RecoveryCodeRepository now THROWS on SQL failure (post-
            // F24.1); a silent rotation failure used to leave the
            // user with a "new" code that didn't actually verify.
            fresh = generateRecoveryCode();
            try {
                RecoveryCodeRepository.getInstance()
                        .addOrUpdate(buildRecoveryRow(trimmed, fresh));
            } catch (RecoveryCodeRepository.RecoveryRepositoryException ex) {
                LOG.error("Recovery-code rotate failed for user={}", trimmed, ex);
                throw new WebApiException(500, "UPSTREAM_ERROR",
                        "Server error during recovery. Please try again.");
            }
        }
        // Newest-wins on duplicate sessions: if this user has an
        // active token from the OLD password, kick it. Recovery is
        // a credential-change event — old sessions should not
        // continue under the prior credentials. Outside the lock so
        // we don't hold the upstream monitor while disconnecting
        // sockets.
        authService.revokePriorTokensForSameUsername(trimmed);
        LOG.info("Password recovered + code rotated: user={}", trimmed);
        return fresh;
    }

    // ---- F24 recovery-code helpers ---- //

    /**
     * Slice F24 — generate a 24-char Crockford-base32 recovery code,
     * formatted as {@code XXXX-XXXX-XXXX-XXXX-XXXX-XXXX} for human
     * legibility. Hyphens are display-only; storage and verification
     * both use the canonical 24-char form.
     */
    static String generateRecoveryCode() {
        StringBuilder out = new StringBuilder(29);
        for (int i = 0; i < 24; i++) {
            if (i > 0 && i % 4 == 0) {
                out.append('-');
            }
            out.append(CROCKFORD_BASE32.charAt(RNG.nextInt(CROCKFORD_BASE32.length())));
        }
        return out.toString();
    }

    /**
     * Slice F24 — canonicalize a user-supplied recovery code for
     * comparison: uppercase, strip whitespace + hyphens, coerce
     * common visual confusables (I/L → 1, O → 0) so a user who
     * mistypes 0 as O or 1 as I still recovers successfully.
     * Returns the empty string if the input is null.
     *
     * <p>Crockford's spec defines exactly this normalization on
     * input. We do NOT perform it on generation (we only emit
     * canonical chars), so the round-trip is verifyable without a
     * lookup table.
     */
    static String canonicalizeRecoveryCode(String raw) {
        if (raw == null) {
            return "";
        }
        StringBuilder out = new StringBuilder(raw.length());
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (Character.isWhitespace(c) || c == '-' || c == '_') {
                continue;
            }
            char up = Character.toUpperCase(c);
            switch (up) {
                case 'I':
                case 'L':
                    out.append('1');
                    break;
                case 'O':
                    out.append('0');
                    break;
                case 'U':
                    // Crockford: U is not in the alphabet; treat it as
                    // V (the next-closest letter) to be lenient on
                    // OCR/handwriting transcription. A user who typed
                    // a literal U probably saw a V.
                    out.append('V');
                    break;
                default:
                    out.append(up);
            }
        }
        return out.toString();
    }

    /**
     * Slice F24 — produce a {@link RecoveryCodeRow} for storage from a
     * cleartext code, hashing under the same scheme upstream uses for
     * passwords (SHA-256 × 1024 with random salt) so the persisted
     * shape is interchangeable with what the verify path expects.
     */
    static RecoveryCodeRow buildRecoveryRow(String username, String cleartextCode) {
        org.apache.shiro.crypto.RandomNumberGenerator gen =
                new org.apache.shiro.crypto.SecureRandomNumberGenerator();
        org.apache.shiro.util.ByteSource salt = gen.nextBytes();
        org.apache.shiro.crypto.hash.Hash hash = new org.apache.shiro.crypto.hash.SimpleHash(
                org.apache.shiro.crypto.hash.Sha256Hash.ALGORITHM_NAME,
                canonicalizeRecoveryCode(cleartextCode),
                salt,
                1024);
        return new RecoveryCodeRow(
                username,
                hash.toBase64(),
                salt.toBase64(),
                hash.getAlgorithmName(),
                hash.getIterations());
    }

    /**
     * Slice F24 — recompute the hash of a candidate recovery code
     * with the row's stored salt + algorithm + iterations and
     * compare in constant time. Mirrors AuthService's reflective
     * password-verify on the same digest path (we don't go through
     * Shiro's matcher because of the {@code setHashSalted(false)}
     * default that breaks SimpleHash verification).
     */
    private static boolean verifyRecoveryHash(RecoveryCodeRow row, String canonicalCode) {
        try {
            byte[] saltBytes = org.apache.shiro.codec.Base64.decode(row.saltB64);
            byte[] inputBytes =
                    canonicalCode.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            MessageDigest md = MessageDigest.getInstance(row.hashAlgorithm);
            md.reset();
            md.update(saltBytes);
            byte[] hashed = md.digest(inputBytes);
            for (int i = 0; i < row.hashIterations - 1; i++) {
                md.reset();
                hashed = md.digest(hashed);
            }
            String recomputed = java.util.Base64.getEncoder().encodeToString(hashed);
            byte[] a = recomputed.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            byte[] b = row.hashB64.getBytes(java.nio.charset.StandardCharsets.UTF_8);
            return MessageDigest.isEqual(a, b);
        } catch (NoSuchAlgorithmException
                | IllegalArgumentException
                | NullPointerException ex) {
            LOG.error("Recovery hash verify failed; row may be corrupt", ex);
            return false;
        }
    }
}
