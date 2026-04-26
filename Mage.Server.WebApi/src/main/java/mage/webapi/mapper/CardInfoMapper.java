package mage.webapi.mapper;

import mage.ObjectColor;
import mage.cards.repository.CardInfo;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.WebCardInfo;
import mage.webapi.dto.WebCardListing;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Translates upstream {@link CardInfo} (the H2 entity) into our public
 * {@link WebCardInfo} DTO. Hand-written; the upstream type stops here.
 *
 * <p>Color derivation: upstream stores W/U/B/R/G as separate boolean
 * fields exposed via {@link CardInfo#getColor()} returning an
 * {@link ObjectColor}. We collapse these to a list of single-letter
 * codes — this is the format every Magic-aware client expects on the
 * wire.
 */
public final class CardInfoMapper {

    private CardInfoMapper() {
    }

    public static WebCardListing single(CardInfo card) {
        if (card == null) {
            return new WebCardListing(SchemaVersion.CURRENT, List.of(), false);
        }
        return new WebCardListing(SchemaVersion.CURRENT, List.of(toDto(card)), false);
    }

    public static WebCardListing many(List<CardInfo> cards, boolean truncated) {
        List<WebCardInfo> dtos = cards.stream().map(CardInfoMapper::toDto).toList();
        return new WebCardListing(SchemaVersion.CURRENT, dtos, truncated);
    }

    private static WebCardInfo toDto(CardInfo c) {
        String name = c.getName();
        return new WebCardInfo(
                name,
                c.getSetCode(),
                c.getCardNumber(),
                c.getManaValue(),
                nonNull(c.getManaCosts(CardInfo.ManaCostSide.ALL)),
                c.getRarity() == null ? "" : c.getRarity().name(),
                c.getTypes().stream().map(Enum::name).toList(),
                c.getSubTypes().stream().map(Object::toString).toList(),
                c.getSupertypes().stream().map(Enum::name).toList(),
                colorsOf(c.getColor()),
                emptyIfNull(c.getPower()),
                emptyIfNull(c.getToughness()),
                emptyIfNull(c.getStartingLoyalty()),
                substituteThis(nonNull(c.getRules()), name)
        );
    }

    /**
     * Upstream uses {@code {this}} as a placeholder for the card's own
     * name in rules text — e.g. "{this} deals 3 damage to any target."
     * Substitute here so every client gets readable rules without
     * repeating the substitution logic.
     */
    private static List<String> substituteThis(List<String> rules, String cardName) {
        return rules.stream()
                .map(line -> line.replace("{this}", cardName))
                .toList();
    }

    private static List<String> colorsOf(ObjectColor color) {
        if (color == null) {
            return Collections.emptyList();
        }
        List<String> out = new ArrayList<>(5);
        if (color.isWhite()) out.add("W");
        if (color.isBlue()) out.add("U");
        if (color.isBlack()) out.add("B");
        if (color.isRed()) out.add("R");
        if (color.isGreen()) out.add("G");
        return List.copyOf(out);
    }

    private static String emptyIfNull(String s) {
        return s == null ? "" : s;
    }

    private static <T> List<T> nonNull(List<T> list) {
        return list == null ? List.of() : List.copyOf(list);
    }
}
