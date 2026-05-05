package mage.webapi.dto;

/**
 * Response body for {@code POST /api/auth/register}. Confirms the
 * username that was registered. Does NOT issue a session token —
 * the user logs in via {@code POST /api/session} as the second step.
 *
 * <p>Slice F18 (2026-05-04).
 */
public record WebRegisterResponse(
        String schemaVersion,
        String username
) {
}
