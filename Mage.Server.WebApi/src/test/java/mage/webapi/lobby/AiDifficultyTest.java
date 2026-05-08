package mage.webapi.lobby;

import mage.webapi.WebApiException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Pins {@link AiDifficulty#fromString(String)} parse contract — wire
 * default behavior on missing values, case + whitespace tolerance, and
 * loud failure on unknown strings. Slice D's {@code WebAddAiRequest}
 * mapper depends on this; if the contract drifts, that mapper silently
 * gets the wrong default.
 */
class AiDifficultyTest {

    @Test
    void fromString_null_returnsWireDefault() {
        assertSame(AiDifficulty.WIRE_DEFAULT, AiDifficulty.fromString(null));
    }

    @Test
    void fromString_empty_returnsWireDefault() {
        assertSame(AiDifficulty.WIRE_DEFAULT, AiDifficulty.fromString(""));
    }

    @Test
    void fromString_blank_returnsWireDefault() {
        assertSame(AiDifficulty.WIRE_DEFAULT, AiDifficulty.fromString("   "));
    }

    @Test
    void fromString_easy_parses() {
        assertSame(AiDifficulty.EASY, AiDifficulty.fromString("easy"));
        assertSame(AiDifficulty.EASY, AiDifficulty.fromString("EASY"));
        assertSame(AiDifficulty.EASY, AiDifficulty.fromString("  Easy "));
    }

    @Test
    void fromString_medium_parses() {
        assertSame(AiDifficulty.MEDIUM, AiDifficulty.fromString("medium"));
        assertSame(AiDifficulty.MEDIUM, AiDifficulty.fromString("MEDIUM"));
    }

    @Test
    void fromString_hard_parses() {
        assertSame(AiDifficulty.HARD, AiDifficulty.fromString("hard"));
        assertSame(AiDifficulty.HARD, AiDifficulty.fromString("HARD"));
    }

    @Test
    void fromString_unknown_throwsWebApiException400() {
        WebApiException ex = assertThrows(WebApiException.class,
                () -> AiDifficulty.fromString("nightmare"));
        assertEquals(400, ex.status());
        assertEquals("BAD_REQUEST", ex.code());
    }

    @Test
    void wireDefault_isMedium() {
        // Locks the spec: missing/blank wire field -> MEDIUM, the
        // rebalanced Bracket 2-3 pool. Slice D's WebAddAiRequest mapper
        // depends on this; if the default flips, every legacy client
        // gets a different difficulty silently.
        assertSame(AiDifficulty.MEDIUM, AiDifficulty.WIRE_DEFAULT);
    }
}
