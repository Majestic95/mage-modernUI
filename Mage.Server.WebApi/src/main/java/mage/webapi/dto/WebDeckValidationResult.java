package mage.webapi.dto;

import java.util.List;

/**
 * Slice 72-A — response payload for
 * {@code POST /api/decks/validate?deckType=...}. Returns a
 * {@code valid} flag, a deck-level {@code partlyLegal} rollup, and
 * the (possibly empty) list of validation errors. Always 200 OK —
 * even when {@code valid=false}, the endpoint succeeded; only the
 * deck failed.
 *
 * <p>Distinct from the {@link WebError} envelope: that's used when
 * the WebApi itself rejects (4xx/5xx). This DTO is the success-shape
 * for the pre-flight validator.
 *
 * <p>Wire format (schema 1.21):
 * <pre>
 *   {
 *     "schemaVersion": "1.21",
 *     "valid":         false,
 *     "partlyLegal":   true,
 *     "errors":        [ WebDeckValidationError, ... ]
 *   }
 * </pre>
 *
 * <p>Errors are pre-sorted by {@code DeckValidatorErrorType#getSortOrder()}
 * (PRIMARY → DECK_SIZE → BANNED → WRONG_SET → OTHER) per upstream's
 * {@code DeckValidator.getErrorsListSorted()}. Capped at
 * {@link mage.webapi.mapper.DeckValidationMapper#DEFAULT_ERROR_LIMIT}
 * entries with the engine's "...and N more" synthetic entry pattern
 * when the cap is hit (the synthetic entry has {@code synthetic=true}).
 *
 * <p>{@code partlyLegal} is the deck-LEVEL rollup: true iff the deck
 * is currently valid OR every remaining error is itself partly-legal
 * (today only {@code DECK_SIZE} qualifies). Drives the deck builder's
 * amber "legal once finished" badge vs the red "needs card changes"
 * badge — clients should branch on this single boolean rather than
 * folding {@code errors[].partlyLegal} themselves.
 *
 * @param schemaVersion always {@link mage.webapi.SchemaVersion#CURRENT}
 * @param valid         true iff {@code errors.isEmpty()}
 * @param partlyLegal   deck-level rollup: true iff valid OR every
 *                      error has {@code partlyLegal=true}
 * @param errors        sorted, capped list of validation failures
 */
public record WebDeckValidationResult(
        String schemaVersion,
        boolean valid,
        boolean partlyLegal,
        List<WebDeckValidationError> errors
) {
}
