package mage.webapi.dto;

/**
 * Public version DTO. Lives behind the DTO firewall: never references any
 * upstream type ({@code mage.utils.MageVersion}, {@code mage.interfaces
 * .ServerState}, or anything in {@code mage.view}). The corresponding
 * mapper translates from upstream types into this record.
 *
 * @param schemaVersion JSON wire-format version (see
 *     {@link mage.webapi.SchemaVersion#CURRENT}).
 * @param mageVersion   Upstream version string (e.g. {@code "1.4.58-V1"}).
 * @param buildTime     Upstream jar build timestamp, empty if unavailable.
 */
public record WebVersion(
        String schemaVersion,
        String mageVersion,
        String buildTime
) {
}
