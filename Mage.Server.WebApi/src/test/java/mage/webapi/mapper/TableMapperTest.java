package mage.webapi.mapper;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
}
