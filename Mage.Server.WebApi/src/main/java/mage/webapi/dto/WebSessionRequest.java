package mage.webapi.dto;

/**
 * Request body for {@code POST /api/session}. All fields optional.
 *
 * <ul>
 *   <li>Empty body / both fields null → guest session, server-generated username</li>
 *   <li>{@code username} only → guest session with that name</li>
 *   <li>{@code username + password} → authenticated session if upstream auth mode is on</li>
 * </ul>
 */
public record WebSessionRequest(
        String username,
        String password
) {
    public WebSessionRequest {
        // record canonical constructor: noop, normalize at use site
    }

    public static WebSessionRequest empty() {
        return new WebSessionRequest(null, null);
    }
}
