package mage.webapi.dto;

import java.util.List;

/**
 * Deck list submitted at table-join time. Mirrors upstream
 * {@code mage.cards.decks.DeckCardLists}. Server validates against
 * the table's deck-construction format on join.
 *
 * @param name      display label (user-supplied)
 * @param author    deck author (user-supplied)
 * @param cards     mainboard
 * @param sideboard sideboard; empty list when not applicable
 * @param displayCard cosmetic portrait card for non-Commander formats;
 *     nullable/absent for older clients and decks with no explicit pick
 */
public record WebDeckCardLists(
        String name,
        String author,
        List<WebDeckCardInfo> cards,
        List<WebDeckCardInfo> sideboard,
        WebDeckCardInfo displayCard
) {
}
