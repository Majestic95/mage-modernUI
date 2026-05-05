package mage.webapi.dto;

/**
 * Response body for {@code POST /api/auth/register}. Confirms the
 * username that was registered. Does NOT issue a session token —
 * the user logs in via {@code POST /api/session} as the second step.
 *
 * <p>Slice F18 (2026-05-04).
 *
 * <p>Slice F24 (2026-05-04) — added {@code recoveryCode}: a one-time
 * passphrase the user MUST save off-screen to reset their password
 * later via {@code POST /api/auth/recover}. Shown to the user once
 * here and never again from the server (only the SHA-256 hash is
 * persisted). On a subsequent successful recovery the code is
 * rotated and a new one is issued in {@code WebRecoverResponse}.
 */
public record WebRegisterResponse(
        String schemaVersion,
        String username,
        String recoveryCode
) {
}
