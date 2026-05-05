package mage.webapi.dto;

/**
 * Request body for {@code POST /api/auth/register}. Both fields
 * required. Validation happens at the service boundary (username
 * pattern, password length) and surfaces as a 400 with a field-
 * specific error code.
 *
 * <p>Slice F18 (2026-05-04) — laid the groundwork for formal
 * authentication. Slice F23 (2026-05-04) — dropped the {@code
 * email} field on user privacy direction ("I don't want people's
 * email addresses being used. Just username and password pairs").
 * Behaviour is gated by the server-side
 * {@code XMAGE_REGISTRATION_ENABLED} flag (default {@code false}).
 */
public record WebRegisterRequest(
        String username,
        String password
) {
}
