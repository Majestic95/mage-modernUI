package mage.webapi.mapper;

import mage.cards.Card;
import mage.cards.decks.Deck;
import mage.filter.FilterMana;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Locks the {@link TableMapper#cleanControllerName} contract.
 * Upstream's {@code TableView} constructor mutates
 * {@code controllerName} to a comma-separated list of all seat
 * occupants for Swing's table-list rendering — we strip the suffix
 * so the webclient can equality-compare the controller's username
 * against the session for the Start button gate.
 */
class TableMapperTest {

    @Test
    void cleanControllerName_solo_returnsAsIs() {
        assertEquals("guest-7ffd459e",
                TableMapper.cleanControllerName("guest-7ffd459e"));
    }

    @Test
    void cleanControllerName_withOneOpponent_stripsSuffix() {
        // Upstream uses ", " (comma + space) as the separator.
        assertEquals("guest-7ffd459e",
                TableMapper.cleanControllerName(
                        "guest-7ffd459e, Computer - monte carlo"));
    }

    @Test
    void cleanControllerName_withMultipleOpponents_stripsSuffix() {
        assertEquals("alice",
                TableMapper.cleanControllerName(
                        "alice, bob, charlie"));
    }

    @Test
    void cleanControllerName_nullOrBlank_returnsEmptyString() {
        assertEquals("", TableMapper.cleanControllerName(null));
        assertEquals("", TableMapper.cleanControllerName(""));
        assertEquals("", TableMapper.cleanControllerName("   "));
    }

    @Test
    void cleanControllerName_singleCommaWithoutSpace_isPreserved() {
        // Upstream's separator is ", " not just "," — names with
        // embedded commas (rare but legal in some upstream flows)
        // must round-trip if there's no following space.
        assertEquals("weird,name",
                TableMapper.cleanControllerName("weird,name"));
    }

    // ---- parseCardNumber (slice 70-X.13: Wave 2 lock the suffix-stripping behavior).
    //
    // The lobby-preview cardNumber field is an int; xmage card-number
    // strings are usually pure digits ("281") but some printings carry
    // a letter suffix ("281a", "281★"). Stripping the suffix is what
    // keeps Scryfall lookups matching the underlying art for the
    // lobby preview. Drop these tests and the failure mode is silent
    // — the wire still parses, the preview just renders the wrong art
    // or shows zero.

    @Test
    void parseCardNumber_pureDigits_returnsInt() {
        assertEquals(281, TableMapper.parseCardNumber("281"));
    }

    @Test
    void parseCardNumber_letterSuffix_stripsAndReturnsLeadingDigits() {
        assertEquals(281, TableMapper.parseCardNumber("281a"));
        assertEquals(45, TableMapper.parseCardNumber("45b"));
    }

    @Test
    void parseCardNumber_nonDigitPrefix_returnsZero() {
        assertEquals(0, TableMapper.parseCardNumber("Hb"));
        assertEquals(0, TableMapper.parseCardNumber("FOIL-12"));
    }

    @Test
    void parseCardNumber_nullOrBlank_returnsZero() {
        assertEquals(0, TableMapper.parseCardNumber(null));
        assertEquals(0, TableMapper.parseCardNumber(""));
        assertEquals(0, TableMapper.parseCardNumber("   "));
    }

    @Test
    void parseCardNumber_zero_returnsZero() {
        assertEquals(0, TableMapper.parseCardNumber("0"));
    }

    // ---- firstSideboardCard (slice 70-X.13: lock the empty / populated
    // / null-deck contract). Commander format stores the commander in
    // the sideboard pre-game; these branches map to the lobby preview's
    // "no commander info" vs "show this card" decision.

    @Test
    void firstSideboardCard_nullDeck_returnsNull() {
        assertNull(TableMapper.firstSideboardCard(null));
    }

    @Test
    void firstSideboardCard_emptySideboard_returnsNull() {
        Deck deck = new Deck();
        assertNull(TableMapper.firstSideboardCard(deck));
    }

    @Test
    void firstSideboardCard_populatedSideboard_returnsFirstCard() {
        Deck deck = new Deck();
        Card commander = stubCard("Atraxa, Praetors' Voice", "281");
        deck.getSideboard().add(commander);
        assertSame(commander, TableMapper.firstSideboardCard(deck));
    }

    // ---- requiredMainboardSize (slice L2: lock the deck-size derivation
    // contract). The lobby seat plate renders a "/{required}" suffix so
    // players see at-a-glance whether their deck is legal. The required
    // size is derived from the table's deckType string — a heuristic
    // pattern match. Drop these and a misclassified deckType silently
    // shows e.g. "60/100" for a Constructed deck or vice versa.

    @Test
    void requiredMainboardSize_commander_returns100() {
        assertEquals(100, TableMapper.requiredMainboardSize("Commander"));
        assertEquals(100, TableMapper.requiredMainboardSize("Commander - Brawl"));
        assertEquals(100, TableMapper.requiredMainboardSize("Tiny Leaders Commander"));
    }

    @Test
    void requiredMainboardSize_constructed_returns60() {
        assertEquals(60, TableMapper.requiredMainboardSize("Constructed - Vintage"));
        assertEquals(60, TableMapper.requiredMainboardSize("Standard"));
        assertEquals(60, TableMapper.requiredMainboardSize("Modern"));
        assertEquals(60, TableMapper.requiredMainboardSize("Legacy"));
        assertEquals(60, TableMapper.requiredMainboardSize("Pauper"));
        assertEquals(60, TableMapper.requiredMainboardSize(
                "Constructed - Freeform Unlimited"));
    }

    @Test
    void requiredMainboardSize_limited_returns40() {
        assertEquals(40, TableMapper.requiredMainboardSize("Limited"));
        assertEquals(40, TableMapper.requiredMainboardSize("Draft"));
        assertEquals(40, TableMapper.requiredMainboardSize("Sealed"));
    }

    @Test
    void requiredMainboardSize_caseInsensitive() {
        assertEquals(100, TableMapper.requiredMainboardSize("COMMANDER"));
        assertEquals(60, TableMapper.requiredMainboardSize("STANDARD"));
        assertEquals(40, TableMapper.requiredMainboardSize("DRAFT"));
    }

    @Test
    void requiredMainboardSize_unknownOrBlank_returnsZero() {
        assertEquals(0, TableMapper.requiredMainboardSize(null));
        assertEquals(0, TableMapper.requiredMainboardSize(""));
        assertEquals(0, TableMapper.requiredMainboardSize("   "));
        assertEquals(0, TableMapper.requiredMainboardSize("Mystery Format"));
    }

    // ---- colorIdentityCodes (schema 1.28) — translate a Card's
    // FilterMana colorIdentity into WUBRG letter codes. The lobby halo
    // renders by these letters; ordering matters for downstream consumers
    // that unique-by-position. Defensive null/throw fallbacks keep the
    // lobby resilient to mid-mutation engine state.

    @Test
    void colorIdentityCodes_pentacolor_returnsWUBRG() {
        FilterMana fm = new FilterMana();
        fm.setWhite(true); fm.setBlue(true); fm.setBlack(true);
        fm.setRed(true); fm.setGreen(true);
        Card c = stubCardWithColors("Kenrith", "1", "CMR", fm);
        assertEquals(List.of("W", "U", "B", "R", "G"),
                TableMapper.colorIdentityCodesForTest(c));
    }

    @Test
    void colorIdentityCodes_colorlessCommander_returnsEmpty() {
        FilterMana fm = new FilterMana();
        Card c = stubCardWithColors("Karn", "1", "DOM", fm);
        assertTrue(TableMapper.colorIdentityCodesForTest(c).isEmpty());
    }

    @Test
    void colorIdentityCodes_dimir_returnsUB_inWUBRGOrder() {
        FilterMana fm = new FilterMana();
        fm.setBlack(true); fm.setBlue(true);  // set in BU order
        Card c = stubCardWithColors("Lazav", "1", "GTC", fm);
        // Output should be WUBRG order regardless of set-order.
        assertEquals(List.of("U", "B"), TableMapper.colorIdentityCodesForTest(c));
    }

    @Test
    void colorIdentityCodes_nullFilterMana_returnsEmpty() {
        // Default stub returns null for getColorIdentity (non-primitive).
        Card c = stubCard("UnknownCard", "1");
        assertTrue(TableMapper.colorIdentityCodesForTest(c).isEmpty());
    }

    @Test
    void colorIdentityCodes_throwingCard_returnsEmpty() {
        Card c = (Card) java.lang.reflect.Proxy.newProxyInstance(
                Card.class.getClassLoader(),
                new Class<?>[]{Card.class},
                (proxy, method, args) -> {
                    if ("getColorIdentity".equals(method.getName())) {
                        throw new RuntimeException("simulated mid-mutation read");
                    }
                    return defaultFor(method.getReturnType());
                });
        assertTrue(TableMapper.colorIdentityCodesForTest(c).isEmpty());
    }

    private static Card stubCardWithColors(String name, String number, String set,
                                            FilterMana colors) {
        return (Card) java.lang.reflect.Proxy.newProxyInstance(
                Card.class.getClassLoader(),
                new Class<?>[]{Card.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getName" -> name;
                    case "getCardNumber" -> number;
                    case "getExpansionSetCode" -> set;
                    case "getColorIdentity" -> colors;
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    case "toString" -> "stubCard(" + name + ")";
                    default -> defaultFor(method.getReturnType());
                });
    }

    /**
     * Minimal {@link Card} stub built via dynamic proxy. The
     * {@code firstSideboardCard} code path only invokes
     * {@code getName()} / {@code getCardNumber()} on the returned
     * card; every other method returns the type's default value
     * (null / 0 / false). Cheaper than implementing 65+ methods
     * by hand on a proper subclass and avoids the heavy
     * {@code CardImpl(CardSetInfo, ...)} ctor chain (which
     * touches the CardRepository singleton and isn't friendly to
     * unit tests).
     */
    private static Card stubCard(String name, String cardNumber) {
        return (Card) java.lang.reflect.Proxy.newProxyInstance(
                Card.class.getClassLoader(),
                new Class<?>[]{Card.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getName" -> name;
                    case "getCardNumber" -> cardNumber;
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    case "toString" -> "stubCard(" + name + "," + cardNumber + ")";
                    default -> defaultFor(method.getReturnType());
                });
    }

    private static Object defaultFor(Class<?> t) {
        if (!t.isPrimitive()) return null;
        if (t == boolean.class) return false;
        if (t == void.class) return null;
        return 0;
    }
}
