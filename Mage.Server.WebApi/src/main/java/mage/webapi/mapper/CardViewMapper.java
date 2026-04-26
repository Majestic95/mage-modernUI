package mage.webapi.mapper;

import mage.ObjectColor;
import mage.constants.CardType;
import mage.constants.SubType;
import mage.constants.SuperType;
import mage.util.SubTypes;
import mage.view.CardView;
import mage.view.CounterView;
import mage.view.PermanentView;
import mage.webapi.dto.stream.WebCardView;
import mage.webapi.dto.stream.WebPermanentView;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Upstream {@code CardView} / {@code PermanentView} → narrowed wire
 * DTOs. Field selection is deliberate (ADR 0007 D7a) — slice 4 ships
 * what the renderer needs for battlefield + hand. Adding a field is a
 * deliberate decision documented in
 * {@code docs/schema/CHANGELOG.md}.
 *
 * <p>Defensive on every nullable upstream field so an in-flight engine
 * state with partial data still serializes; mapper exceptions on the
 * engine thread would silently drop a frame.
 */
public final class CardViewMapper {

    private CardViewMapper() {
    }

    public static WebCardView toCardDto(CardView cv) {
        if (cv == null) {
            throw new IllegalArgumentException("CardView must not be null");
        }
        return new WebCardView(
                cv.getId() == null ? "" : cv.getId().toString(),
                nullToEmpty(cv.getName()),
                nullToEmpty(cv.getDisplayName()),
                nullToEmpty(cv.getExpansionSetCode()),
                nullToEmpty(cv.getCardNumber()),
                nullToEmpty(cv.getManaCostStr()),
                cv.getManaValue(),
                nullToEmpty(safeTypeText(cv)),
                superTypeNames(cv.getSuperTypes()),
                cardTypeNames(cv.getCardTypes()),
                subTypeNames(cv.getSubTypes()),
                colorCodes(cv.getColor()),
                cv.getRarity() == null ? "" : cv.getRarity().name(),
                nullToEmpty(cv.getPower()),
                nullToEmpty(cv.getToughness()),
                nullToEmpty(cv.getStartingLoyalty()),
                cv.getRules() == null ? List.of() : List.copyOf(cv.getRules()),
                cv.isFaceDown(),
                "",
                countersFlat(cv.getCounters())
        );
    }

    public static WebPermanentView toPermanentDto(PermanentView pv) {
        if (pv == null) {
            throw new IllegalArgumentException("PermanentView must not be null");
        }
        WebCardView card = toCardDto(pv);
        List<String> attachments = new ArrayList<>();
        if (pv.getAttachments() != null) {
            for (UUID id : pv.getAttachments()) {
                attachments.add(id == null ? "" : id.toString());
            }
        }
        return new WebPermanentView(
                card,
                nullToEmpty(pv.getNameController()),
                pv.isTapped(),
                pv.isFlipped(),
                pv.isTransformed(),
                pv.isPhasedIn(),
                pv.hasSummoningSickness(),
                pv.getDamage(),
                attachments,
                pv.getAttachedTo() == null ? "" : pv.getAttachedTo().toString()
        );
    }

    /**
     * Map a {@code CardsView} (upstream {@code Map<UUID, CardView>}) to
     * a JSON-friendly {@code Map<String, WebCardView>} keyed by the
     * card UUID's string form.
     */
    public static Map<String, WebCardView> toCardMap(Map<UUID, CardView> cards) {
        if (cards == null || cards.isEmpty()) {
            return Map.of();
        }
        // LinkedHashMap preserves zone ordering on the wire (matters
        // for graveyard + library where MTG cares about order).
        Map<String, WebCardView> out = new LinkedHashMap<>(cards.size());
        for (Map.Entry<UUID, CardView> e : cards.entrySet()) {
            UUID id = e.getKey();
            CardView v = e.getValue();
            if (id == null || v == null) continue;
            out.put(id.toString(), toCardDto(v));
        }
        return out;
    }

    /**
     * Same idea for upstream {@code Map<UUID, PermanentView>} — the
     * shape used by {@code PlayerView.getBattlefield()}.
     */
    public static Map<String, WebPermanentView> toPermanentMap(
            Map<UUID, PermanentView> permanents) {
        if (permanents == null || permanents.isEmpty()) {
            return Map.of();
        }
        Map<String, WebPermanentView> out = new LinkedHashMap<>(permanents.size());
        for (Map.Entry<UUID, PermanentView> e : permanents.entrySet()) {
            UUID id = e.getKey();
            PermanentView v = e.getValue();
            if (id == null || v == null) continue;
            out.put(id.toString(), toPermanentDto(v));
        }
        return out;
    }

    // ---------- internal helpers ----------

    /**
     * Upstream's {@code getTypeText()} concatenates supertype, type,
     * and subtype with em-dashes — already the renderer-friendly
     * format. Defensive null check because some construct-time
     * CardView paths leave intermediate state where the call NPEs.
     */
    private static String safeTypeText(CardView cv) {
        try {
            return cv.getTypeText();
        } catch (RuntimeException ex) {
            return "";
        }
    }

    private static List<String> cardTypeNames(List<CardType> types) {
        if (types == null || types.isEmpty()) return List.of();
        List<String> out = new ArrayList<>(types.size());
        for (CardType t : types) {
            if (t != null) out.add(t.name());
        }
        return out;
    }

    private static List<String> superTypeNames(List<SuperType> supers) {
        if (supers == null || supers.isEmpty()) return List.of();
        List<String> out = new ArrayList<>(supers.size());
        for (SuperType s : supers) {
            if (s != null) out.add(s.name());
        }
        return out;
    }

    private static List<String> subTypeNames(SubTypes subs) {
        if (subs == null) return List.of();
        // SubTypes implements Set<SubType>.
        List<String> out = new ArrayList<>(subs.size());
        for (SubType s : subs) {
            if (s != null) out.add(s.getDescription());
        }
        return out;
    }

    private static List<String> colorCodes(ObjectColor color) {
        if (color == null) return List.of();
        List<String> out = new ArrayList<>(5);
        if (color.isWhite()) out.add("W");
        if (color.isBlue()) out.add("U");
        if (color.isBlack()) out.add("B");
        if (color.isRed()) out.add("R");
        if (color.isGreen()) out.add("G");
        return out;
    }

    private static Map<String, Integer> countersFlat(List<CounterView> counters) {
        if (counters == null || counters.isEmpty()) return Map.of();
        Map<String, Integer> out = new HashMap<>(counters.size());
        for (CounterView c : counters) {
            if (c == null) continue;
            String name = c.getName();
            if (name == null) continue;
            // Upstream collapses by name; defensive Integer.sum if
            // a duplicate ever sneaks through.
            out.merge(name, c.getCount(), Integer::sum);
        }
        return out;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
