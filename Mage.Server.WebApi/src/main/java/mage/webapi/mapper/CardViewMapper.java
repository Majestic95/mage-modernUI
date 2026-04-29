package mage.webapi.mapper;

import mage.ObjectColor;
import mage.constants.CardType;
import mage.constants.SubType;
import mage.constants.SuperType;
import mage.util.SubTypes;
import mage.view.AbilityView;
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
        return toCardDto(cv, null, true);
    }

    /**
     * Public overload that lets the caller supply an explicit
     * underlying-card UUID for the resulting {@code cardId} field.
     * Used by the stack-mapping path where {@code cv.getId()} is a
     * fresh {@code SpellAbility} UUID and the stable {@code Card}
     * UUID lives on the upstream {@code Spell.getCard()} reference
     * that the mapper no longer has access to (see
     * {@link mage.webapi.upstream.StackCardIdHint}).
     *
     * <p>Pass {@code null} for {@code underlyingCardId} to fall back
     * to {@code cv.getId()} (the hand / battlefield / graveyard /
     * exile / sideboard / library path — those zones already key by
     * the card UUID).
     */
    public static WebCardView toCardDto(CardView cv, UUID underlyingCardId) {
        return toCardDto(cv, underlyingCardId, true);
    }

    /**
     * Internal entry point for the recursive secondCardFace mapping.
     * {@code allowSecondFace} is true on the top-level call and false
     * when mapping the back face — caps recursion at one level so the
     * wire format never carries a third-tier face. Mirrors upstream
     * {@code CardView.secondCardFace} which itself never recurses past
     * the first back face.
     *
     * <p>The {@code underlyingCardId} parameter is forwarded to
     * {@link #resolveCardId} for the top-level mapping; the recursive
     * back-face call always passes null so the second face's
     * {@code cardId} resolves to its own {@code id} (back faces are
     * separate Card instances upstream and don't share a UUID with
     * the front face).
     */
    private static WebCardView toCardDto(CardView cv, UUID underlyingCardId, boolean allowSecondFace) {
        if (cv == null) {
            throw new IllegalArgumentException("CardView must not be null");
        }
        WebCardView secondFace = null;
        boolean transformable = false;
        boolean transformed = false;
        if (allowSecondFace) {
            try {
                transformable = cv.canTransform();
                transformed = cv.isTransformed();
                CardView upstreamSecond = cv.getSecondCardFace();
                if (upstreamSecond != null) {
                    // Recursive call passes null underlyingCardId — the
                    // back face resolves its own cardId from cv.getId().
                    secondFace = toCardDto(upstreamSecond, null, false);
                }
            } catch (RuntimeException ex) {
                // Defensive: some upstream code paths NPE when reading
                // transform state on a card mid-event. Fall through with
                // the default (no-op) values.
                secondFace = null;
                transformable = false;
                transformed = false;
            }
        }
        return new WebCardView(
                cv.getId() == null ? "" : cv.getId().toString(),
                resolveCardId(cv, underlyingCardId),
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
                countersFlat(cv.getCounters()),
                transformable,
                transformed,
                secondFace,
                extractSourceLabel(cv)
        );
    }

    /**
     * Single source of truth for the {@code cardId} resolution rule:
     * if the caller supplied an explicit underlying-card UUID, use it;
     * otherwise fall back to {@code cv.getId()}. Returns the empty
     * string if both are null (matches the {@code id} fallback for
     * symmetry — upstream never produces a null id in practice but
     * the mapper is defensive).
     */
    private static String resolveCardId(CardView cv, UUID explicit) {
        if (explicit != null) {
            return explicit.toString();
        }
        UUID fallback = cv == null ? null : cv.getId();
        return fallback == null ? "" : fallback.toString();
    }

    /**
     * For an {@link AbilityView} carrying a triggered / activated
     * ability, return the source card's name (used by the trigger-
     * order panel as a "from: ‹source›" attribution under each rule).
     * For ordinary CardViews, return the empty string.
     *
     * <p>{@code AbilityView.sourceName} is a private field with no
     * public getter, so we read it via {@link AbilityView#getSourceCard()}
     * which carries the same value (see {@code CardsView.java:140}
     * where both the {@code sourceName} string and the source CardView
     * are built from {@code sourceObject.getName()}). For emblem /
     * dungeon / plane sources the {@code setName(...)} call at
     * {@code CardsView.java:112-126} keeps the source CardView's name
     * field aligned.
     */
    private static String extractSourceLabel(CardView cv) {
        if (!(cv instanceof AbilityView av)) return "";
        CardView source = av.getSourceCard();
        return source == null ? "" : nullToEmpty(source.getName());
    }

    public static WebPermanentView toPermanentDto(PermanentView pv) {
        if (pv == null) {
            throw new IllegalArgumentException("PermanentView must not be null");
        }
        // Permanents pass null for the explicit underlying-card UUID:
        // pv.getId() is already the Card UUID for battlefield zones,
        // so resolveCardId() falls through to cv.getId() correctly.
        WebCardView card = toCardDto(pv, null);
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
                pv.getAttachedTo() == null ? "" : pv.getAttachedTo().toString(),
                pv.isAttachedToPermanent(),
                // Slice 69a — schema 1.20 wire shape ships empty.
                // Upstream PermanentView doesn't carry goading info;
                // slice 69b populates from Permanent.getGoadingPlayers()
                // once live-game lookup is plumbed through the mapper
                // (ADR 0010 v2 D3c).
                List.of()
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
     * Stack-specific variant of {@link #toCardMap}. The wire-format
     * map key is still the upstream {@code SpellAbility} UUID (so the
     * webclient can correlate the entry with priority/target prompts
     * keyed by the same UUID), but the {@code cardId} field on each
     * {@link WebCardView} is overridden from
     * {@code spellAbilityToCardId} (built by
     * {@link mage.webapi.upstream.StackCardIdHint}). Entries without
     * a hint (e.g. {@code StackAbility} for triggered abilities) fall
     * back to {@code cv.getId()}, which is the right answer for
     * non-physical-card stack objects.
     *
     * @param stack             upstream {@code Map<UUID, CardView>}
     *     for the stack (key = stack object id, typically the
     *     {@code SpellAbility} UUID for spells)
     * @param spellAbilityToCardId hint map from
     *     {@code Spell.getId()} to {@code Spell.getCard().getId()};
     *     null is tolerated and treated as empty
     */
    public static Map<String, WebCardView> toStackMap(
            Map<UUID, CardView> stack,
            Map<UUID, UUID> spellAbilityToCardId) {
        if (stack == null || stack.isEmpty()) {
            return Map.of();
        }
        Map<UUID, UUID> hints = spellAbilityToCardId == null
                ? Map.of()
                : spellAbilityToCardId;
        Map<String, WebCardView> out = new LinkedHashMap<>(stack.size());
        for (Map.Entry<UUID, CardView> e : stack.entrySet()) {
            UUID id = e.getKey();
            CardView v = e.getValue();
            if (id == null || v == null) continue;
            UUID underlying = hints.get(id);
            out.put(id.toString(), toCardDto(v, underlying));
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
