package mage.webapi.dto;

import java.util.List;

/**
 * Top-level wrapper for {@code GET /api/rooms/{id}/tables}. Carries
 * the required {@code schemaVersion} and the table list. Empty list
 * is valid (no active tables).
 */
public record WebTableListing(
        String schemaVersion,
        List<WebTable> tables
) {
}
