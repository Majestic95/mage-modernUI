package mage.webapi.lobby;

import mage.webapi.WebApiException;

/**
 * Difficulty tier for AI players. Selects which Commander deck pool the
 * fallback deck library serves at AI fill time.
 *
 * <ul>
 *   <li>{@link #EASY} — vanilla creature pile, no anthems, no engines.
 *       Bracket 1 / battlecruiser feel. Casual playgroup floor.</li>
 *   <li>{@link #MEDIUM} — Bracket 2-3. One anthem + mild engines per
 *       deck; no exponential snowballs or board-locks. The default.</li>
 *   <li>{@link #HARD} — the original high-density synergy decks
 *       (Bracket 3-4). Coat of Arms / Craterhoof / Cathars' Crusade
 *       in their original neighborhoods.</li>
 * </ul>
 *
 * <p>Wire surface — when the JSON wire field arrives in Slice D, parse
 * via {@link #fromString(String)} so missing/blank values default to
 * {@link #MEDIUM} (the wire-default) and unknown strings fail loudly
 * with HTTP 400.
 */
public enum AiDifficulty {
    EASY,
    MEDIUM,
    HARD;

    /**
     * Default difficulty when a request omits the field. Currently
     * {@link #MEDIUM} — the rebalanced Bracket 2-3 pool. Slice C flips
     * the dispatcher's effective default here once the Medium pool is
     * populated; until then, both Easy and Medium delegate to Hard
     * (so the practical default is "Hard via Medium delegation").
     */
    public static final AiDifficulty WIRE_DEFAULT = MEDIUM;

    public static AiDifficulty fromString(String raw) {
        if (raw == null || raw.isBlank()) {
            return WIRE_DEFAULT;
        }
        switch (raw.trim().toLowerCase()) {
            case "easy":
                return EASY;
            case "medium":
                return MEDIUM;
            case "hard":
                return HARD;
            default:
                throw new WebApiException(400, "BAD_REQUEST",
                        "Unknown AI difficulty: '" + raw
                                + "'. Expected one of: easy, medium, hard.");
        }
    }
}
