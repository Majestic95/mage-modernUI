package mage.webapi.lobby;

import mage.webapi.dto.WebDeckCardInfo;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Unit tests for {@link DisplayCardRegistry}.
 *
 * <p>The set/remove/lookup paths are the load-bearing contract for
 * cosmetic display-card portraits (schema 1.33). The lobby seat
 * mapper, the in-game frame mapper, and the WebApi route handlers
 * all read this registry; the read keys ({@code SeatView.getPlayerName},
 * {@code Player.getName}, {@code User.getName}) must agree with the
 * write keys, and the pre-write {@code normalize} (lower/trim) is the
 * backstop when minor casing drift occurs.
 *
 * <p>The {@code Game}-aware overloads (forPlayer / snapshotForGame)
 * are exercised by the integration tests in
 * {@code GameViewMapperTest} that wire a real engine; this file pins
 * the in-memory map contract.
 */
class DisplayCardRegistryTest {

    private static final WebDeckCardInfo SWIFTSPEAR =
            new WebDeckCardInfo("Monastery Swiftspear", "KTK", "118", 4);
    private static final WebDeckCardInfo BOLT =
            new WebDeckCardInfo("Lightning Bolt", "LEA", "161", 4);

    @Test
    void setThenForSeat_returnsTheStoredCard() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "alice", SWIFTSPEAR);

        DisplayCardRegistry.DisplayCard got = r.forSeat(t, "alice");
        assertEquals("Monastery Swiftspear", got.name());
        assertEquals("KTK", got.setCode());
        assertEquals("118", got.cardNumber());
    }

    @Test
    void forSeat_isCaseInsensitive_andTrimsWhitespace() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "Alice", SWIFTSPEAR);

        // Engine paths read User.getName() which may differ in case
        // from the joinTable name. The registry must absorb the drift.
        assertEquals("Monastery Swiftspear", r.forSeat(t, "alice").name());
        assertEquals("Monastery Swiftspear", r.forSeat(t, "ALICE").name());
        assertEquals("Monastery Swiftspear", r.forSeat(t, "  alice  ").name());
    }

    @Test
    void set_withBlankOrNullName_isANoOp() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, null, SWIFTSPEAR);
        r.set(t, "", SWIFTSPEAR);
        r.set(t, "   ", SWIFTSPEAR);
        assertNull(r.forSeat(t, ""));
        assertNull(r.forSeat(t, "alice"));
    }

    @Test
    void set_withIncompletePrintingTriple_clearsTheEntry() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "alice", SWIFTSPEAR);
        // Missing setCode → DisplayCard.from(...) returns null → remove.
        r.set(t, "alice", new WebDeckCardInfo("X", "", "1", 1));
        assertNull(r.forSeat(t, "alice"));
    }

    @Test
    void set_withNullDto_clearsTheEntry() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "alice", SWIFTSPEAR);
        r.set(t, "alice", null);
        assertNull(r.forSeat(t, "alice"));
    }

    @Test
    void set_overwrite_lastWriteWins() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "alice", SWIFTSPEAR);
        r.set(t, "alice", BOLT);
        assertEquals("Lightning Bolt", r.forSeat(t, "alice").name());
    }

    @Test
    void remove_clearsOneSeatButLeavesOthers() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "alice", SWIFTSPEAR);
        r.set(t, "bob", BOLT);

        r.remove(t, "alice");
        assertNull(r.forSeat(t, "alice"));
        assertEquals("Lightning Bolt", r.forSeat(t, "bob").name());
    }

    @Test
    void removeTable_clearsAllSeatsForThatTableOnly() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        r.set(a, "alice", SWIFTSPEAR);
        r.set(a, "bob", BOLT);
        r.set(b, "alice", SWIFTSPEAR);

        r.removeTable(a);
        assertNull(r.forSeat(a, "alice"));
        assertNull(r.forSeat(a, "bob"));
        assertEquals("Monastery Swiftspear", r.forSeat(b, "alice").name());
    }

    @Test
    void forSeat_unknownKey_returnsNull() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        assertNull(r.forSeat(t, "nobody"));
        assertNull(r.forSeat(null, "alice"));
        assertNull(r.forSeat(t, null));
        assertNull(r.forSeat(t, ""));
    }

    @Test
    void displayCard_trimsTripleWhitespace() {
        DisplayCardRegistry r = new DisplayCardRegistry();
        UUID t = UUID.randomUUID();
        r.set(t, "alice",
                new WebDeckCardInfo(" Monastery Swiftspear ", " KTK ", " 118 ", 4));
        DisplayCardRegistry.DisplayCard got = r.forSeat(t, "alice");
        assertEquals("Monastery Swiftspear", got.name());
        assertEquals("KTK", got.setCode());
        assertEquals("118", got.cardNumber());
    }
}
