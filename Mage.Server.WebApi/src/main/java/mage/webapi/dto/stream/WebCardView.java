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
 * @param cardId          stable underlying-{@code Card} UUID. For
 *     hand / battlefield / graveyard / exile / sideboard / library
 *     this matches {@link #id} — upstream's {@code CardView.getId()}
 *     for those zones already <em>is</em> the {@code Card.getId()}.
 *     For the <strong>stack</strong>, however, upstream constructs
 *     the view from a {@code Spell} where {@code Spell.getId()} is a
 *     fresh {@code SpellAbility} UUID minted at cast time; this field
 *     recovers the underlying {@code Spell.getCard().getId()} so the
 *     webclient can use {@code cardId} as a Framer Motion
 *     {@code layoutId} for cross-zone animation
 *     (hand → stack → battlefield/graveyard) without the identity
 *     break that {@code id} alone would cause. Slice 52a / schema
 *     1.19 — added as a new required field for cross-zone Framer
 *     Motion {@code layoutId} animation in the webclient.
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
 * @param transformable   true if this card has a back face that can
 *     be flipped to (transformable cards from Innistrad onward AND
 *     modal-DFCs from Zendikar Rising onward). When true,
 *     {@link #secondCardFace} is populated.
 * @param transformed     when {@link #transformable} is true, this is
 *     the current state of the card: {@code false} = front face shown,
 *     {@code true} = back face shown. The {@code secondCardFace} stays
 *     populated either way so the renderer can preview the other side.
 * @param secondCardFace  the other face of a transformable card, or
 *     {@code null} for non-transformable cards. Recursion is capped at
 *     one level: the second face's {@code secondCardFace} is always
 *     {@code null} on the wire, mirroring upstream's recursive
 *     {@code CardView.secondCardFace} which itself holds a
 *     {@code CardView} but never a third level.
 * @param sourceLabel     non-empty only when this view is an upstream
 *     {@code AbilityView} carrying a triggered / activated ability —
 *     populated from the source object's name ({@code "Soul Warden"},
 *     {@code "Atraxa, Praetors' Voice"}, an emblem name, etc.). Slice
 *     28 / ADR 0009 / schema 1.18 — lets the trigger-order panel show
 *     "from: ‹source›" attribution under each rule, useful for
 *     emblems / dungeons / planes whose rule text doesn't include the
 *     source. Empty string for ordinary cards.
 */
public record WebCardView(
        String id,
        String cardId,
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
        Map<String, Integer> counters,
        boolean transformable,
        boolean transformed,
        WebCardView secondCardFace,
        String sourceLabel
) {
}
