package mage.webapi.dto.stream;

import java.util.List;
import java.util.Map;

/**
 * Wire-format card snapshot. Deliberately narrowed from upstream's
 * 1626-LOC {@code mage.view.CardView} per ADR 0007 D7a — only the
 * fields the renderer actually consumes are exposed. Adding a field
 * here is a deliberate decision; the slice 4 budget targets battlefield
 * + hand rendering only.
 *
 * <p>Slice 4 ships the base shape. Slice 5 may add transform/flip
 * second-face data, ability lists, and split-card halves once the
 * webclient needs them.
 *
 * <p>Composition: {@link WebPermanentView} carries one of these as its
 * {@code card} field rather than extending. Java records can't extend
 * and the duplicated field count would balloon the wire format.
 *
 * @param id              card UUID; stable for the lifetime of the
 *     game-object (re-issued on transform / blink)
 * @param name            internal name (always populated)
 * @param displayName     user-facing name; differs for face-down,
 *     transformed, and morph
 * @param expansionSetCode upstream set code (e.g. {@code "LEA"}) — used
 *     by the webclient for Scryfall art lookup
 * @param cardNumber      printing number within the set
 * @param manaCost        rendered mana-cost string ({@code "{2}{R}{R}"})
 * @param manaValue       converted mana cost
 * @param typeLine        rendered type line (supertypes — types — subtypes)
 * @param supertypes      upstream {@code SuperType} enum names
 * @param types           upstream {@code CardType} enum names
 * @param subtypes        subtype names (e.g. {@code "Goblin"}, {@code "Forest"})
 * @param colors          single-letter color codes (subset of
 *     {@code "W"}, {@code "U"}, {@code "B"}, {@code "R"}, {@code "G"})
 * @param rarity          upstream {@code Rarity} enum name
 * @param power           creature power as a string ({@code ""},
 *     {@code "*"}, {@code "X"} all allowed)
 * @param toughness       creature toughness as a string
 * @param startingLoyalty planeswalker starting loyalty as a string;
 *     empty for non-planeswalkers
 * @param rules           rules-text paragraphs (each entry is one
 *     paragraph, {@code <br>}-separated upstream)
 * @param faceDown        true for morph / face-down permanents
 * @param counters        flattened counter map ("counter name" → count);
 *     populated for permanents on the battlefield
 */
public record WebCardView(
        String id,
        String name,
        String displayName,
        String expansionSetCode,
        String cardNumber,
        String manaCost,
        int manaValue,
        String typeLine,
        List<String> supertypes,
        List<String> types,
        List<String> subtypes,
        List<String> colors,
        String rarity,
        String power,
        String toughness,
        String startingLoyalty,
        List<String> rules,
        boolean faceDown,
        Map<String, Integer> counters
) {
}
