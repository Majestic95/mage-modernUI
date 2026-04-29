package mage.webapi.dto;

/**
 * Slice 72-A — one entry in the validator's error report. Mirrors
 * upstream's {@link mage.cards.decks.DeckValidatorError} fields plus
 * two denormalized booleans the webclient would otherwise have to
 * recompute: {@code partlyLegal} (from
 * {@link mage.cards.decks.DeckValidatorErrorType#isPartlyLegal()})
 * and {@code synthetic} (whether this entry is the engine's
 * "...and N more" overflow sentinel).
 *
 * <p>{@code partlyLegal=true} means this specific error is satisfied
 * once the deck reaches its required size — drives the deck builder's
 * "legal once finished" amber-styled state vs the red-styled hard
 * errors that need card changes. The deck-LEVEL rollup
 * (deck-as-a-whole is partly-legal iff every error is partly-legal)
 * is on {@link WebDeckValidationResult#partlyLegal} — clients should
 * read that for the badge state and use this per-error flag only when
 * styling individual list rows.
 *
 * <p>{@code synthetic=true} marks the
 * {@code OTHER, "...", "and more N error[s]"} entry that upstream's
 * {@code DeckValidator#getErrorsListSorted(int)} appends when the
 * caller-supplied cap drops entries. Distinguishing it from a "real"
 * OTHER error (e.g. color-identity violation that happens to have a
 * null {@code cardName}) lets the client render it as a non-clickable
 * footer rather than a clickable error row.
 *
 * <p>Wire format (schema 1.21):
 * <pre>
 *   {
 *     "errorType":   "BANNED" | "PRIMARY" | "DECK_SIZE" | "WRONG_SET" | "OTHER",
 *     "group":       "Mana Crypt",
 *     "message":     "Banned",
 *     "cardName":    "Mana Crypt",   // null for global errors
 *     "partlyLegal": false,
 *     "synthetic":   false           // true only on the overflow sentinel
 *   }
 * </pre>
 *
 * <p>{@code errorType} serializes as the upstream enum's name. Today
 * 5 values exist (PRIMARY / DECK_SIZE / BANNED / WRONG_SET / OTHER);
 * color-identity + singleton violations both fall under OTHER —
 * clients distinguish them via {@code message} text. Future engine
 * upgrades may add new {@code DeckValidatorErrorType} values; the
 * wire is additive-by-design and clients must default-render unknown
 * {@code errorType} strings rather than switch-without-default.
 *
 * @param errorType    upstream {@code DeckValidatorErrorType#name()}
 * @param group        usually a card name when {@code cardName} is
 *                     non-null; for global errors it's a tag like
 *                     {@code "Deck"} or {@code "Commander"}
 * @param message      hardcoded English (no i18n yet)
 * @param cardName     non-null only when the error is "click this
 *                     card" actionable
 * @param partlyLegal  {@code true} iff the upstream errorType has
 *                     {@code isPartlyLegal()=true} (DECK_SIZE only,
 *                     today)
 * @param synthetic    {@code true} iff this is the engine's overflow
 *                     sentinel ("...and N more error[s]"); never set
 *                     for real validator findings
 */
public record WebDeckValidationError(
        String errorType,
        String group,
        String message,
        String cardName,
        boolean partlyLegal,
        boolean synthetic
) {
}
