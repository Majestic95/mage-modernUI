package mage.webapi.dto.stream;

/**
 * Mirror of upstream {@code mage.view.ManaPoolView}. Conditional mana
 * is folded into the per-color totals upstream-side, so the wire
 * format only carries the six color buckets.
 */
public record WebManaPoolView(
        int red,
        int green,
        int blue,
        int white,
        int black,
        int colorless
) {
}
