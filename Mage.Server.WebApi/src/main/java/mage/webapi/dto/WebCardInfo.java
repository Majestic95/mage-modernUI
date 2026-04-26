package mage.webapi.dto;

import java.util.List;

/**
 * Card information DTO. Hand-written translation of upstream
 * {@code mage.cards.repository.CardInfo} (the H2 entity); the
 * {@code CardInfo} type does not appear in our wire format.
 *
 * <p>Nested DTO — does not carry {@code schemaVersion}; that lives on
 * the top-level response only.
 *
 * @param name           card name (e.g. "Lightning Bolt")
 * @param setCode        upstream set code (e.g. "LEA")
 * @param cardNumber     collector number within that set (e.g. "161")
 * @param manaValue      converted mana cost / mana value
 * @param manaCosts      mana cost symbols (e.g. ["{R}"])
 * @param rarity         enum name: COMMON, UNCOMMON, RARE, MYTHIC, SPECIAL, BONUS, LAND
 * @param types          card types (e.g. ["INSTANT"])
 * @param subtypes       creature/land subtypes (e.g. ["Goblin", "Wizard"])
 * @param supertypes     supertypes (e.g. ["LEGENDARY", "SNOW"])
 * @param colors         single-letter color codes (subset of "W","U","B","R","G")
 * @param power          creature power as printed (may be "*", "X", or empty)
 * @param toughness      creature toughness (may be "*", "X", or empty)
 * @param startingLoyalty planeswalker starting loyalty (empty if not a planeswalker)
 * @param rules          rules-text lines, one entry per line
 */
public record WebCardInfo(
        String name,
        String setCode,
        String cardNumber,
        int manaValue,
        List<String> manaCosts,
        String rarity,
        List<String> types,
        List<String> subtypes,
        List<String> supertypes,
        List<String> colors,
        String power,
        String toughness,
        String startingLoyalty,
        List<String> rules
) {
}
