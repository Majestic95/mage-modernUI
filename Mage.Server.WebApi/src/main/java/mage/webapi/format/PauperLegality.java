package mage.webapi.format;

/**
 * Pauper legality verdict for a single card name, sourced from
 * Scryfall's {@code legalities.pauper} field.
 *
 * <p>Design decision: this enum is the WebApi's <em>authoritative</em>
 * Pauper legality source — Scryfall mirrors the DCI/Wizards
 * announcement banlist. We do <em>not</em> derive legality from the
 * card's printed rarity (T2.A's whole point). Rarity-derived legality
 * was the upstream {@code Pauper} validator's behaviour and produced
 * false positives on cards like {@code Hada Freeblade} (printed common,
 * banned in Pauper). T2.B will plug this verdict into validation; this
 * slice only loads + exposes the data.
 *
 * <p>{@link #UNKNOWN} is reserved for names not present in Scryfall's
 * bulk data — typically engine-only token names or cards too new for
 * the cached snapshot. Callers decide the policy for UNKNOWN (likely
 * "fall back to upstream rarity check" in T2.B).
 */
public enum PauperLegality {
    LEGAL,
    NOT_LEGAL,
    BANNED,
    RESTRICTED,
    UNKNOWN;

    /**
     * Map a raw Scryfall {@code legalities.pauper} string to the enum.
     * Null and unrecognized values collapse to {@link #UNKNOWN} — be
     * lenient on input, since Scryfall could add a new value (e.g.
     * "future") without notice and we'd rather flag it as UNKNOWN than
     * crash the boot path.
     */
    public static PauperLegality fromScryfall(String value) {
        if (value == null) {
            return UNKNOWN;
        }
        return switch (value) {
            case "legal" -> LEGAL;
            case "not_legal" -> NOT_LEGAL;
            case "banned" -> BANNED;
            case "restricted" -> RESTRICTED;
            default -> UNKNOWN;
        };
    }
}
