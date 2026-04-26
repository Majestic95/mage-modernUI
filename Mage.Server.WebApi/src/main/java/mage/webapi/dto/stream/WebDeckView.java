package mage.webapi.dto.stream;

import java.util.List;

/**
 * Deck snapshot used in sideboard / construct payloads. Flattens
 * upstream {@code DeckView}'s {@code SimpleCardsView}
 * (LinkedHashMap&lt;UUID, SimpleCardView&gt;) to ordered lists; the
 * insertion order matches upstream so a client-side render stays
 * stable across snapshots.
 *
 * <p>The {@code name} field exposes the deck's display name. Some
 * formats (e.g. Tiny Leaders) hide the name from opponents — see
 * {@code TableController.submitDeck} for the workaround that
 * preserves the name on resubmit. We pass through whatever the
 * server populated.
 *
 * @param name        deck display name; may be empty
 * @param mainList    main-deck cards in upstream insertion order
 * @param sideboard   sideboard cards in upstream insertion order
 */
public record WebDeckView(
        String name,
        List<WebSimpleCardView> mainList,
        List<WebSimpleCardView> sideboard
) {
}
