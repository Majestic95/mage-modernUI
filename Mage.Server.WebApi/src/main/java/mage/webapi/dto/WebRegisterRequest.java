package mage.webapi.dto;

/**
 * Request body for {@code POST /api/auth/register}. All three fields
 * required. Validation happens at the service boundary (username
 * pattern, password length, email format) and surfaces as a 422 with
 * a field-specific error message.
 *
 * <p>Slice F18 (2026-05-04) — laid the groundwork for formal
 * authentication. Behaviour is gated by the server-side
 * {@code XMAGE_REGISTRATION_ENABLED} flag (default {@code false}).
 * When the flag is off, the registration route returns 403; the
 * existing anonymous + named-no-password login flow stays unchanged.
 */
public record WebRegisterRequest(
        String username,
        String password,
        String email
) {
}
