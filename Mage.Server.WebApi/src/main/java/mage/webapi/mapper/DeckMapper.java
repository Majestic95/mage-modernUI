package mage.webapi.mapper;

import mage.cards.decks.DeckCardInfo;
import mage.cards.decks.DeckCardLists;
import mage.webapi.WebApiException;
import mage.webapi.dto.WebDeckCardInfo;
import mage.webapi.dto.WebDeckCardLists;

import java.util.ArrayList;
import java.util.List;

/**
 * Translates the wire-format {@link WebDeckCardLists} into upstream
 * {@link DeckCardLists}. Validates that the structure is well-formed
 * — illegal card amounts, missing fields, etc. → 400 BAD_REQUEST.
 * Format-level legality (banned cards, deck size) is checked
 * downstream during {@code roomJoinTable}.
 */
public final class DeckMapper {

    private DeckMapper() {
    }

    public static DeckCardLists toUpstream(WebDeckCardLists web) {
        if (web == null) {
            throw new WebApiException(400, "BAD_REQUEST", "Deck is required.");
        }
        DeckCardLists deck = new DeckCardLists();
        deck.setName(web.name() == null ? "" : web.name());
        deck.setAuthor(web.author() == null ? "" : web.author());
        deck.setCards(toUpstreamList(web.cards(), "cards"));
        deck.setSideboard(toUpstreamList(web.sideboard(), "sideboard"));
        return deck;
    }

    private static List<DeckCardInfo> toUpstreamList(List<WebDeckCardInfo> source, String fieldName) {
        if (source == null) {
            return new ArrayList<>();
        }
        List<DeckCardInfo> out = new ArrayList<>(source.size());
        for (int i = 0; i < source.size(); i++) {
            WebDeckCardInfo entry = source.get(i);
            if (entry == null) {
                throw new WebApiException(400, "BAD_REQUEST",
                        fieldName + "[" + i + "] is null");
            }
            if (entry.cardName() == null || entry.cardName().isBlank()) {
                throw new WebApiException(400, "BAD_REQUEST",
                        fieldName + "[" + i + "].cardName is required");
            }
            if (entry.setCode() == null || entry.setCode().isBlank()) {
                throw new WebApiException(400, "BAD_REQUEST",
                        fieldName + "[" + i + "].setCode is required");
            }
            if (entry.cardNumber() == null || entry.cardNumber().isBlank()) {
                throw new WebApiException(400, "BAD_REQUEST",
                        fieldName + "[" + i + "].cardNumber is required");
            }
            if (entry.amount() < 1) {
                throw new WebApiException(400, "BAD_REQUEST",
                        fieldName + "[" + i + "].amount must be >= 1");
            }
            out.add(new DeckCardInfo(
                    entry.cardName(),
                    entry.cardNumber(),
                    entry.setCode(),
                    entry.amount()
            ));
        }
        return out;
    }
}
