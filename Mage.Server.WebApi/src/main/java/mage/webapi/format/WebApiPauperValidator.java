package mage.webapi.format;

import mage.cards.decks.Deck;
import mage.cards.decks.DeckValidatorErrorType;
import mage.deck.Pauper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Override of upstream {@link Pauper} that consults
 * {@link PauperLegalityService} for the per-card legality verdict
 * instead of walking {@link mage.cards.repository.CardRepository}'s
 * rarity-per-printing data + a hardcoded 38-card banlist.
 *
 * <p>Wiring: {@link mage.webapi.server.WebApiServer#withLegalityCacheDir}
 * constructs a {@link PauperLegalityService}, calls
 * {@link #setService(PauperLegalityService)}, then registers this class
 * against {@link mage.cards.decks.DeckValidatorFactory} for the
 * {@code "Constructed - Pauper"} deck type. The factory uses
 * reflection with no args to construct each validator, hence the
 * static holder pattern.
 *
 * <p><b>Why override {@link #validate(Deck)} rather than the narrower
 * {@code legalRarity(Card)} extension point:</b> the upstream
 * {@code Constructed.validate} only calls {@code legalRarity} for
 * cards whose rarity is NOT in the format's allowed-rarity set
 * (i.e. the rarity-mismatch fallback path). COMMON-printed BANNED
 * cards (e.g. Treasure Cruise at KTK) would silently pass that
 * filter. Instead we override {@link #validate(Deck)} as an
 * additive layer: super is called first (deck size, count caps,
 * rarity walk for non-common cards), then we walk every distinct
 * card name once and add Scryfall verdicts on top. We clear the
 * upstream {@code banned} list when the service is wired so
 * Scryfall — not the hardcoded snapshot — is authoritative on
 * bans; the Scryfall layer re-adds BANNED errors for whichever
 * names Scryfall currently flags.
 *
 * <p>Service-null fallback: if Scryfall data is unavailable at boot
 * (cold cache + network down), the static holder stays null and
 * every instance behaves identically to upstream {@link Pauper}
 * (rarity-walk + 38-card banlist preserved). The override is
 * silently a no-op rather than refusing to validate decks at all.
 *
 * <p>Per-card decision tree when service is available:
 * <ul>
 *   <li>{@link PauperLegality#LEGAL} — accept (no error added by
 *       this layer; super may still reject for size / count / set).
 *       </li>
 *   <li>{@link PauperLegality#BANNED} — append BANNED error.</li>
 *   <li>{@link PauperLegality#NOT_LEGAL} — append OTHER error
 *       ({@code "Not legal in Pauper (Scryfall)"}).</li>
 *   <li>{@link PauperLegality#RESTRICTED} — same surface as
 *       NOT_LEGAL; restricted is not a real Pauper status today
 *       (banned-or-legal binary), but if Scryfall ever introduces
 *       it for Pauper we surface as a legality error rather than
 *       silently accepting. We deliberately do NOT use upstream's
 *       {@code restricted} list (which enforces "count &gt; 1") —
 *       "not_legal" semantics is the correct response for any
 *       restricted card under current Pauper rules.</li>
 *   <li>{@link PauperLegality#UNKNOWN} — defer entirely to super.
 *       Card too new for our cached snapshot, or a token / engine-
 *       only construct that doesn't appear in Scryfall's bulk
 *       data.</li>
 * </ul>
 */
public class WebApiPauperValidator extends Pauper {

    private static final Logger LOG = LoggerFactory.getLogger(WebApiPauperValidator.class);

    /**
     * Process-wide held service. Set once at WebApi boot via
     * {@link #setService(PauperLegalityService)}; read once per
     * validator instance in the constructor (which the factory calls
     * via reflection per validation request). {@code volatile} for
     * happens-before publication of the boot-time write to
     * subsequent reflection-driven reads.
     */
    private static volatile PauperLegalityService heldService;

    public static void setService(PauperLegalityService service) {
        heldService = service;
    }

    /** Visible-for-test: clear the held service so test isolation is recoverable. */
    public static void clearServiceForTest() {
        heldService = null;
    }

    private final PauperLegalityService legalityService;

    /**
     * Public no-arg constructor required by {@link mage.cards.decks.DeckValidatorFactory}'s
     * reflective instantiation path. Snapshots the static holder once
     * so multi-threaded mutations of {@link #heldService} mid-validation
     * cannot half-rewire this instance.
     */
    public WebApiPauperValidator() {
        super();
        this.legalityService = heldService;
        if (this.legalityService != null) {
            // Scryfall is authoritative when we have it. Clear the
            // upstream-hardcoded banlist (Pauper's 38 + Constructed's
            // structural Conspiracy / ante / etc. — Scryfall flags all
            // of those as legalities.pauper="not_legal" or "banned",
            // so the Scryfall layer in validate() re-adds them for
            // whichever names are currently flagged). For UNKNOWN
            // cards we defer to super's rarity / set walks, which
            // don't consult banned, so the clear is safe for the
            // fallback path too.
            banned.clear();
            LOG.debug("WebApiPauperValidator constructed with service "
                    + "({} card entries known)", legalityService.knownCardCount());
        }
    }

    /**
     * Visible-for-test: construct with an explicit service (no static
     * holder). Lets unit tests inject a fixture-backed service
     * without touching process-wide state.
     */
    WebApiPauperValidator(PauperLegalityService service) {
        super();
        this.legalityService = service;
        if (service != null) {
            banned.clear();
        }
    }

    @Override
    public boolean validate(Deck deck) {
        boolean valid = super.validate(deck);
        if (legalityService == null) {
            return valid;
        }

        // Walk distinct card names across maindeck + sideboard once.
        // LinkedHashMap preserves first-seen order so test diagnostics
        // are stable; the validator itself doesn't care about order.
        Map<String, Integer> counts = new LinkedHashMap<>();
        countCards(counts, deck.getCards());
        countCards(counts, deck.getSideboard());

        for (String name : counts.keySet()) {
            switch (legalityService.legalityOf(name)) {
                case BANNED -> {
                    addError(DeckValidatorErrorType.BANNED, name,
                            "Banned in Pauper", true);
                    valid = false;
                }
                case NOT_LEGAL, RESTRICTED -> {
                    addError(DeckValidatorErrorType.OTHER, name,
                            "Not legal in Pauper (Scryfall)", true);
                    valid = false;
                }
                case LEGAL, UNKNOWN -> {
                    // LEGAL: no error added by this layer. Super's
                    // rarity / set walks already passed (or didn't,
                    // and added their own errors).
                    // UNKNOWN: defer entirely to super's verdict.
                }
            }
        }

        return valid;
    }
}
