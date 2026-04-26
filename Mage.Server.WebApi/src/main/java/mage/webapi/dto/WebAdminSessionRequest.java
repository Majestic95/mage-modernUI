package mage.webapi.dto;

/**
 * Request body for {@code POST /api/session/admin}.
 *
 * @param adminPassword the shared admin password configured on the server
 */
public record WebAdminSessionRequest(
        String adminPassword
) {
}
