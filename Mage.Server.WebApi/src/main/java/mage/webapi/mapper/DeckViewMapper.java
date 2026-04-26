package mage.webapi.mapper;

import mage.cards.repository.CardInfo;
import mage.cards.repository.CardRepository;
import mage.view.DeckView;
import mage.view.SimpleCardView;
import mage.view.SimpleCardsView;
import mage.view.TableClientMessage;
import mage.webapi.dto.stream.WebDeckView;
import mage.webapi.dto.stream.WebSideboardInfo;
import mage.webapi.dto.stream.WebSimpleCardView;

import java.util.ArrayList;
import java.util.List;

/**
 * Translates upstream {@link DeckView} (sideboarding / construction
 * payload) into wire DTOs. The headline transformation is filling in
 * each card's name via {@link CardRepository} so the webclient can
 * render a deck picker without an extra round trip.
 *
 * <p>{@code SimpleCardView} only carries (id, setCode, cardNumber,
 * usesVariousArt, isGameObject); the upstream Swing client looks the
 * name up locally because it ships with a card database. The
 * webclient does not, so we resolve names server-side. Cards whose
 * print isn't in the repository (e.g. a deck imported from a yet-to-
 * be-implemented set) fall back to {@code "<set>:<number>"} so the
 * picker still renders something useful.
 */
public final class DeckViewMapper {

    private DeckViewMapper() {
    }

    public static WebSideboardInfo toSideboardInfo(TableClientMessage tcm) {
        if (tcm == null) {
            throw new IllegalArgumentException("TableClientMessage must not be null");
        }
        return new WebSideboardInfo(
                toDeckDto(tcm.getDeck()),
                tcm.getCurrentTableId() == null ? "" : tcm.getCurrentTableId().toString(),
                tcm.getParentTableId() == null ? "" : tcm.getParentTableId().toString(),
                tcm.getTime(),
                tcm.getFlag()
        );
    }

    public static WebDeckView toDeckDto(DeckView dv) {
        if (dv == null) {
            return new WebDeckView("", List.of(), List.of());
        }
        return new WebDeckView(
                dv.getName() == null ? "" : dv.getName(),
                toCardList(dv.getCards()),
                toCardList(dv.getSideboard())
        );
    }

    private static List<WebSimpleCardView> toCardList(SimpleCardsView source) {
        if (source == null || source.isEmpty()) {
            return List.of();
        }
        List<WebSimpleCardView> out = new ArrayList<>(source.size());
        for (SimpleCardView card : source.values()) {
            if (card == null) {
                continue;
            }
            out.add(toCardDto(card));
        }
        return List.copyOf(out);
    }

    static WebSimpleCardView toCardDto(SimpleCardView card) {
        return new WebSimpleCardView(
                card.getId() == null ? "" : card.getId().toString(),
                resolveCardName(card.getExpansionSetCode(), card.getCardNumber()),
                card.getExpansionSetCode() == null ? "" : card.getExpansionSetCode(),
                card.getCardNumber() == null ? "" : card.getCardNumber(),
                card.getUsesVariousArt()
        );
    }

    /**
     * Look up the display name for a (setCode, cardNumber) print. The
     * repository call returns null on miss; we fall back to
     * {@code "<set>:<number>"} so a missing card doesn't blank the
     * UI. Lookups are unsynchronized — {@link CardRepository} is a
     * thread-safe singleton in upstream's design.
     */
    static String resolveCardName(String setCode, String cardNumber) {
        if (setCode == null || cardNumber == null
                || setCode.isBlank() || cardNumber.isBlank()) {
            return "<unknown card>";
        }
        try {
            CardInfo info = CardRepository.instance.findCard(setCode, cardNumber);
            if (info != null && info.getName() != null && !info.getName().isBlank()) {
                return info.getName();
            }
        } catch (RuntimeException ex) {
            // Repository init failures should not crash a frame
            // mapping. Fall through to the fallback below.
        }
        return setCode + ":" + cardNumber;
    }
}
