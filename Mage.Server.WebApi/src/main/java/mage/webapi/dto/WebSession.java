package mage.webapi.dto;

/**
 * Top-level session DTO. Returned by {@code POST /api/session},
 * {@code POST /api/session/admin}, and {@code GET /api/session/me}.
 *
 * <p>The {@code token} field is what the client sends back as
 * {@code Authorization: Bearer <token>} on subsequent requests.
 *
 * @param schemaVersion JSON wire-format version
 * @param token         opaque UUID; the Bearer token
 * @param username      resolved server-side username (anon usernames look like {@code guest-ab12cd})
 * @param isAnonymous   true when no password was supplied (server-mode-independent)
 * @param isAdmin       true when obtained via {@code POST /api/session/admin}
 * @param expiresAt     ISO-8601 UTC timestamp; reflects the post-bump value when returned
 */
public record WebSession(
        String schemaVersion,
        String token,
        String username,
        boolean isAnonymous,
        boolean isAdmin,
        String expiresAt
) {
}
