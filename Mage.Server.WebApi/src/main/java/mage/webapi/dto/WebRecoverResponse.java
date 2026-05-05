package mage.webapi.dto;

/**
 * Response body for {@code POST /api/auth/recover}. Confirms the
 * password was reset and carries a freshly-rotated one-time
 * {@code recoveryCode} — the prior code is now invalidated, and the
 * new one MUST be saved off-screen to enable a future reset.
 *
 * <p>Slice F24 (2026-05-04).
 */
public record WebRecoverResponse(
        String schemaVersion,
        String username,
        String recoveryCode
) {
}
