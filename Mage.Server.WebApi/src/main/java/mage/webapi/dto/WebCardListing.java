package mage.webapi.dto;

import java.util.List;

/**
 * Top-level response wrapper for card-lookup endpoints. Carries the
 * required {@code schemaVersion} and a list of zero or more cards.
 * Single-card lookups return a list of size 0 or 1; printings searches
 * return up to a per-request limit.
 *
 * <p>Top-level DTO — carries {@code schemaVersion}.
 */
public record WebCardListing(
        String schemaVersion,
        List<WebCardInfo> cards,
        boolean truncated
) {
}
