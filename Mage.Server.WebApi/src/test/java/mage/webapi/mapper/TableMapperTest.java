package mage.webapi.mapper;

import mage.cards.Card;
import mage.cards.decks.Deck;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

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
