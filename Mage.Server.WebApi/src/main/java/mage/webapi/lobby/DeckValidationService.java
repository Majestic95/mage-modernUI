package mage.webapi.lobby;

import mage.cards.decks.Deck;
import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.cards.decks.DeckValidator;
import mage.cards.decks.DeckValidatorError;
import mage.cards.decks.DeckValidatorFactory;
import mage.game.GameException;
import mage.webapi.SchemaVersion;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebDeckValidationError;
import mage.webapi.dto.WebDeckValidationResult;
import mage.webapi.mapper.DeckValidationMapper;

import java.util.List;

/**
 * Slice 72-A — backs the {@code POST /api/decks/validate?deckType=...}
 * pre-flight endpoint. Always returns {@link WebDeckValidationResult}
 * (200 OK) — the endpoint succeeded even when the deck failed
 * validation. The {@code valid} / {@code partlyLegal} / {@code errors}
 * fields carry the verdict.
 *
 * <p>Distinct from the join-time path: that one runs validation as a
 * side effect of {@code roomJoinTable} and surfaces failures via the
 * {@code DECK_INVALID} {@link WebApiException}. This pre-flight is the
 * deck builder's diagnostic loop — clients call it after every deck
 * edit to render legality affordances without having to actually
 * attempt a table join.
 *
 * <p>Validator instances are short-lived (one per call via
 * {@code DeckValidatorFactory.createDeckValidator}) so there is no
 * shared mutable state across concurrent requests — see
 * {@code LobbyService.preValidateDeck} for the safe-vs-shared
 * contrast.
 *
 * <p>Test-mode is intentionally NOT honored here. Upstream's
 * {@code TableController} skips validation entirely when
 * {@code Main.isTestMode()} is true so AI smoke-tests can run with
 * stub decks. A pre-flight call is an explicit "validate this for me"
 * request — silently lying with {@code valid=true} would defeat the
 * point. (Our embedded server is constructed with
 * {@code testMode=false} regardless, so this is just contract clarity
 * for future readers.)
 */
public final class DeckValidationService {

    /**
     * Hard cap on total entries (mainboard + sideboard line items)
     * accepted at the pre-flight endpoint. Each entry triggers a card
     * lookup + validator pass; without a cap an authed client could
     * pin a worker thread by repeatedly POSTing a maximally-large
     * payload. 250 lines comfortably covers every supported format
     * (Commander 100 + 0 sideboard, Constructed 60 + 15 sideboard,
     * casual 4-of pile experiments) with ~2× headroom. Bodies are
     * also globally bounded by Javalin's 1 MB request-size cap, but
     * that's measured in bytes and a tight JSON encoding can pack 5k+
     * entries inside it — this cap is the per-request CPU budget.
     */
    static final int MAX_DECK_ENTRIES = 250;

    public DeckValidationService() {
    }

    /**
     * Run the requested format's validator against the supplied deck
     * and return the verdict.
     *
     * @param deckType canonical deck-type name as exposed by
     *                 {@code /api/server/state} (e.g.
     *                 {@code "Variant Magic - Commander"},
     *                 {@code "Constructed - Vintage"}). Unknown values
     *                 → 400 {@code UNKNOWN_DECK_TYPE}.
     * @param deckList card list from the request body. Capped at
     *                 {@link #MAX_DECK_ENTRIES} entries combined.
     * @return result with {@code valid=true} iff no errors;
     *         {@code partlyLegal=true} iff the deck would be legal
     *         once size is met (currently valid OR only DECK_SIZE
     *         errors). Errors are pre-sorted and capped at
     *         {@link DeckValidationMapper#DEFAULT_ERROR_LIMIT} with
     *         the engine's overflow sentinel marked
     *         {@code synthetic=true}.
     */
    public WebDeckValidationResult validate(String deckType, DeckCardLists deckList) {
        // Enforce the entry cap BEFORE any factory lookup or
        // engine work — it's free arithmetic and lets the cap fire
        // even on bizarre deckType + giant payload combos. The
        // factory lookup happens next so client-side fixes are
        // signaled in dependency order: fix your deck size first,
        // fix your format pick second.
        enforceEntryCap(deckList);

        DeckValidator validator = DeckValidatorFactory.instance.createDeckValidator(deckType);
        if (validator == null) {
            throw new WebApiException(400, "UNKNOWN_DECK_TYPE",
                    "Unknown deckType: " + deckType
                            + " — see /api/server/state for the available list.");
        }

        Deck deck;
        try {
            // ignoreErrors=false so unresolvable card entries surface
            // as a parse failure (400 INVALID_DECK_FORMAT) rather than
            // silently dropping cards before validation.
            // mockCards=false matches TableController's call shape.
            deck = Deck.load(deckList, false, false);
        } catch (GameException ex) {
            throw new WebApiException(400, "INVALID_DECK_FORMAT",
                    "Could not load deck: " + ex.getMessage());
        }

        boolean ok = validator.validate(deck);
        List<DeckValidatorError> errors = validator.getErrorsListSorted(
                DeckValidationMapper.DEFAULT_ERROR_LIMIT);
        List<WebDeckValidationError> dtoErrors = DeckValidationMapper.toDtoList(errors);
        boolean partlyLegal = ok || dtoErrors.stream().allMatch(WebDeckValidationError::partlyLegal);
        return new WebDeckValidationResult(SchemaVersion.CURRENT, ok, partlyLegal, dtoErrors);
    }

    private static void enforceEntryCap(DeckCardLists deckList) {
        int total = sizeOrZero(deckList.getCards()) + sizeOrZero(deckList.getSideboard());
        if (total > MAX_DECK_ENTRIES) {
            throw new WebApiException(413, "DECK_TOO_LARGE",
                    "Deck has " + total + " line entries; pre-flight accepts at most "
                            + MAX_DECK_ENTRIES + ".");
        }
    }

    private static int sizeOrZero(List<DeckCardInfo> list) {
        return list == null ? 0 : list.size();
    }
}
