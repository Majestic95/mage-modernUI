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
 * <p>Wire surface — the optional {@code difficulty} field on
 * {@code WebAddAiRequest} (schema 1.34, Slice D 2026-05-08) is parsed
 * via {@link #fromString(String)}. Missing/blank values default to
 * {@link #MEDIUM} (the wire-default) and unknown strings fail loudly
 * with HTTP 400.
 */
public enum AiDifficulty {
    EASY,
    MEDIUM,
    HARD;

    /**
     * Default difficulty when a request omits the {@code difficulty}
     * field. {@link #MEDIUM} — the rebalanced Bracket 2-3 pool live
     * since Slice C (2026-05-07).
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
