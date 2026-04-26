package mage.webapi.dto;

/**
 * One card entry in a deck list. Mirrors upstream {@code mage.cards
 * .decks.DeckCardInfo}. The triple {@code (cardName, setCode,
 * cardNumber)} canonically identifies a specific printing.
 *
 * @param cardName   e.g. "Lightning Bolt"
 * @param setCode    e.g. "LEA"
 * @param cardNumber collector number, e.g. "161"
 * @param amount     copies in this list (mainboard or sideboard)
 */
public record WebDeckCardInfo(
        String cardName,
        String setCode,
        String cardNumber,
        int amount
) {
}
