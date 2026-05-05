package mage.webapi.dto;

/**
 * Request body for {@code POST /api/auth/recover}. The user supplies
 * the username they want to reset, the one-time recovery code shown
 * once at register, and the new password.
 *
 * <p>Slice F24 (2026-05-04). Replaces the email-based password-reset
 * path that was removed in F23.
 */
public record WebRecoverRequest(
        String username,
        String recoveryCode,
        String newPassword
) {
}
