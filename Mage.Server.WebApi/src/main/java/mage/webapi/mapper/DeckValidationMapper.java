package mage.webapi.mapper;

import mage.cards.decks.DeckValidatorError;
import mage.cards.decks.DeckValidatorErrorType;
import mage.webapi.dto.WebDeckValidationError;

import java.util.ArrayList;
import java.util.List;

/**
 * Slice 72-A — translates the engine's {@link DeckValidatorError}
 * list into the wire DTO list. Pure projection: no sorting, no
 * capping (callers pass {@link #DEFAULT_ERROR_LIMIT} or their own
 * value into upstream's
 * {@link mage.cards.decks.DeckValidator#getErrorsListSorted(int)}
 * which is the sort + cap authority and is the source of the
 * "...and N more" synthetic overflow sentinel).
 *
 * <p>Two booleans get denormalized from upstream onto each DTO entry:
 * <ul>
 *   <li>{@code partlyLegal} from
 *       {@link DeckValidatorErrorType#isPartlyLegal()} — the
 *       webclient avoids maintaining a parallel enum table; future
 *       engine-side flips propagate automatically.</li>
 *   <li>{@code synthetic} detected by group
 *       {@code "..."} (the well-known sentinel marker upstream
 *       writes at
 *       {@code DeckValidator#getErrorsListSorted}). Lets clients
 *       render the overflow row as a non-clickable footer rather
 *       than a real error.</li>
 * </ul>
 */
public final class DeckValidationMapper {

    /**
     * Default cap callers should pass to upstream's
     * {@code getErrorsListSorted(int)} when fetching the sorted error
     * list to translate. 50 is generous — typical validation reports
     * are 1–10 entries; pathological mass-banned casual decks can hit
     * 30+. Any overflow is replaced by the engine's synthetic
     * sentinel which this mapper marks via {@code synthetic=true}.
     *
     * <p>This is a service-tier policy that callers apply; the mapper
     * itself never enforces it (purely projects whatever it's given).
     */
    public static final int DEFAULT_ERROR_LIMIT = 50;

    /**
     * Marker on the upstream sentinel entry. Upstream writes
     * {@code OTHER, "...", "and more N error[s]"} when it caps —
     * group {@code "..."} is the unambiguous signal because real
     * validators never emit a card or section literally named
     * {@code "..."}.
     */
    private static final String SYNTHETIC_GROUP_MARKER = "...";

    private DeckValidationMapper() {
    }

    public static List<WebDeckValidationError> toDtoList(List<DeckValidatorError> source) {
        if (source == null || source.isEmpty()) {
            return List.of();
        }
        List<WebDeckValidationError> out = new ArrayList<>(source.size());
        for (DeckValidatorError err : source) {
            out.add(toDto(err));
        }
        return List.copyOf(out);
    }

    private static WebDeckValidationError toDto(DeckValidatorError err) {
        DeckValidatorErrorType type = err.getErrorType();
        String group = err.getGroup() == null ? "" : err.getGroup();
        boolean synthetic = SYNTHETIC_GROUP_MARKER.equals(group);
        return new WebDeckValidationError(
                type.name(),
                group,
                err.getMessage() == null ? "" : err.getMessage(),
                err.getCardName(),
                type.isPartlyLegal(),
                synthetic
        );
    }
}
