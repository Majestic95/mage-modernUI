package mage.webapi.auth;

import java.time.Instant;

/**
 * Internal session record stored in {@link WebSessionStore}. Never
 * serialized to the wire — the public DTO is
 * {@link mage.webapi.dto.WebSession}.
 *
 * @param token             opaque UUID; the Bearer token
 * @param upstreamSessionId UUID we passed to {@code SessionManagerImpl
 *     .createSession()}; used to dispatch upstream calls and to
 *     disconnect on logout
 * @param username          resolved username (anon names are
 *     {@code guest-XXXXXX})
 * @param isAnonymous       true if no password was supplied on login
 * @param isAdmin           true if obtained via {@code POST /api/session/admin}
 * @param createdAt         monotonic creation timestamp; the hard cap
 *     ({@link WebSessionStore#HARD_CAP}) is computed from this
 * @param expiresAt         sliding-window expiry; bumped on every
 *     authenticated request
 */
public record SessionEntry(
        String token,
        String upstreamSessionId,
        String username,
        boolean isAnonymous,
        boolean isAdmin,
        Instant createdAt,
        Instant expiresAt
) {
    public SessionEntry withExpiresAt(Instant newExpiresAt) {
        return new SessionEntry(token, upstreamSessionId, username,
                isAnonymous, isAdmin, createdAt, newExpiresAt);
    }
}
