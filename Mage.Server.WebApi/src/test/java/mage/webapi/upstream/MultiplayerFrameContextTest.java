package mage.webapi.upstream;

import mage.webapi.lobby.DisplayCardRegistry;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 69c — unit coverage for {@link MultiplayerFrameContext}'s
 * static null-input paths and accessor semantics.
 *
 * <p>The {@code extract(Game)} factory and the
 * {@code playersInRange(Game, UUID)} static helper read live engine
 * state and are practical to exercise only inside the embedded
 * server (covered in slice 69e e2e specs). Here we lock the surface
 * that's directly testable: the EMPTY sentinel's behavior, accessor
 * defaults for null inputs, and the non-null guard rails.
 */
class MultiplayerFrameContextTest {

    @Test
    void empty_returnsEmptyListForEveryPermanent() {
        // The EMPTY sentinel is what gets passed by every legacy /
        // test mapper call site. Its goadingFor() must always
        // return List.of() — null returns would break the wire
        // contract (WebPermanentView.goadingPlayerIds is never null).
        MultiplayerFrameContext ctx = MultiplayerFrameContext.EMPTY;
        assertEquals(List.of(), ctx.goadingFor(UUID.randomUUID()));
        assertEquals(List.of(), ctx.goadingFor(UUID.randomUUID()));
    }

    @Test
    void empty_returnsEmptyListForNullPermanentId() {
        // Defensive — caller should pass non-null UUIDs but a buggy
        // mapper passing null shouldn't crash the frame.
        assertEquals(List.of(), MultiplayerFrameContext.EMPTY.goadingFor(null));
    }

    @Test
    void extract_nullGame_returnsEmptySentinel() {
        // Test path: legacy callsites + tests that hold no embedded
        // server reference call extract(null). The result should be
        // exactly the EMPTY singleton — same instance, no allocation.
        assertSame(MultiplayerFrameContext.EMPTY,
                MultiplayerFrameContext.extract(null),
                "extract(null) must return the EMPTY singleton, not "
                        + "allocate a fresh empty context");
    }

    @Test
    void playersInRange_nullGame_returnsNullNoFilter() {
        // null sentinel = "no filter", per the toDto contract:
        // every player goes on the wire (RoI.ALL semantics).
        assertNull(MultiplayerFrameContext.playersInRange(null, UUID.randomUUID()));
    }

    @Test
    void playersInRange_nullRecipient_returnsNullNoFilter() {
        // A spectator path (slice 71) has no recipient playerId in
        // the seated-players sense. Mapper falls through to "no
        // filter" rather than throwing. The spectator-specific
        // visibility rules are owned by ADR D2, not the RoI filter.
        assertNull(MultiplayerFrameContext.playersInRange(null, null));
    }

    @Test
    void empty_isASingleton() {
        // Forward-compat: future callers that compare contexts via
        // == should land on the same instance for the empty case.
        assertNotNull(MultiplayerFrameContext.EMPTY);
        assertSame(MultiplayerFrameContext.EMPTY, MultiplayerFrameContext.EMPTY);
        // Also a sanity check that the public API doesn't accidentally
        // expose a way to mutate it (the ctor is private).
        assertTrue(MultiplayerFrameContext.EMPTY.goadingFor(UUID.randomUUID())
                .isEmpty());
    }

    @Test
    void forTesting_synthesizesContextWithGoadingData() {
        // Production builds the context from live Permanent state via
        // extract(Game). Tests build it from a hand-crafted map via
        // forTesting(...). Both paths produce contexts whose
        // goadingFor() accessor matches the input shape.
        UUID permId = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        UUID goader = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
        Map<UUID, Set<UUID>> goading = Map.of(permId, Set.of(goader));
        MultiplayerFrameContext ctx = MultiplayerFrameContext.forTesting(goading);

        List<String> goaders = ctx.goadingFor(permId);
        assertEquals(1, goaders.size());
        assertEquals(goader.toString(), goaders.get(0));
    }

    @Test
    void forTesting_unrecordedPermanent_returnsEmptyList() {
        // Permanents not in the goading map (the typical FFA case —
        // most permanents are never goaded) get an empty list, not null.
        UUID goadedPermId = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        UUID goader = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
        MultiplayerFrameContext ctx = MultiplayerFrameContext.forTesting(
                Map.of(goadedPermId, Set.of(goader)));

        assertTrue(ctx.goadingFor(UUID.randomUUID()).isEmpty(),
                "permanents not in the goading map get []");
    }

    @Test
    void forTesting_nullMap_returnsContextWithEmptyGoading() {
        // Defensive — caller passing null shouldn't NPE; treat as
        // "no goading anywhere."
        MultiplayerFrameContext ctx = MultiplayerFrameContext.forTesting(null);
        assertTrue(ctx.goadingFor(UUID.randomUUID()).isEmpty());
    }

    @Test
    void empty_connectionStateForAnyPlayer_isConnected() {
        // Slice 70-H — EMPTY's bundled tracker is the
        // EVERY_PLAYER_CONNECTED default. Tests that don't set up a
        // tracker get "connected" for every player, preserving the
        // pre-70-H wire shape (no DISCONNECTED overlay surfaces).
        assertEquals("connected",
                MultiplayerFrameContext.EMPTY
                        .connectionStateFor(UUID.randomUUID()));
    }

    @Test
    void empty_connectionStateForNullPlayerId_isConnected() {
        // Defensive: null playerId (malformed PlayerView) defaults
        // to "connected" so we never paint a healthy player as
        // disconnected on a transient lookup failure.
        assertEquals("connected",
                MultiplayerFrameContext.EMPTY.connectionStateFor(null));
    }

    @Test
    void withConnectionTracker_overridesDefaultLookup() {
        // Slice 70-H — withConnectionTracker returns a copy with
        // the supplied tracker swapped in. The copy preserves the
        // goading map (no allocation churn for the goading data)
        // and threads the new tracker into connectionStateFor().
        UUID disconnected = UUID.fromString(
                "dddddddd-4444-4444-4444-444444444444");
        WebSocketConnectionTracker tracker = playerId ->
                disconnected.equals(playerId)
                        ? "disconnected"
                        : "connected";
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.EMPTY.withConnectionTracker(tracker);

        assertEquals("disconnected", ctx.connectionStateFor(disconnected));
        assertEquals("connected",
                ctx.connectionStateFor(UUID.randomUUID()));
    }

    @Test
    void withConnectionTracker_nullTracker_fallsBackToEveryPlayerConnected() {
        // Defensive: passing null swaps in the EVERY_PLAYER_CONNECTED
        // sentinel, not a NullPointerException at lookup time.
        UUID disconnected = UUID.fromString(
                "dddddddd-4444-4444-4444-444444444444");
        MultiplayerFrameContext base = MultiplayerFrameContext.EMPTY
                .withConnectionTracker(playerId ->
                        disconnected.equals(playerId)
                                ? "disconnected" : "connected");
        // Sanity — base reports disconnected.
        assertEquals("disconnected",
                base.connectionStateFor(disconnected));
        // Reset to default — the disconnected lookup now returns
        // "connected" because the tracker was nulled out.
        MultiplayerFrameContext reset = base.withConnectionTracker(null);
        assertEquals("connected", reset.connectionStateFor(disconnected));
    }

    @Test
    void withConnectionTracker_sameTracker_returnsSameInstance() {
        // Idempotency check: passing the already-bound tracker is a
        // no-op. EMPTY's tracker is EVERY_PLAYER_CONNECTED, so
        // calling withConnectionTracker(EVERY_PLAYER_CONNECTED) on
        // EMPTY returns EMPTY itself (no fresh allocation).
        assertSame(MultiplayerFrameContext.EMPTY,
                MultiplayerFrameContext.EMPTY.withConnectionTracker(
                        WebSocketConnectionTracker.EVERY_PLAYER_CONNECTED),
                "Re-binding the existing tracker must be a no-op "
                        + "(same instance), not a fresh allocation.");
    }

    @Test
    void multipleGoaders_allSurfaceInTheList() {
        // A permanent goaded by 2 different players (4p FFA — alice
        // and carol both cast Goading Vortex on bob's creature)
        // surfaces both UUIDs.
        UUID permId = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        UUID goader1 = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
        UUID goader2 = UUID.fromString("cccccccc-3333-3333-3333-333333333333");
        MultiplayerFrameContext ctx = MultiplayerFrameContext.forTesting(
                Map.of(permId, Set.of(goader1, goader2)));

        List<String> goaders = ctx.goadingFor(permId);
        assertEquals(2, goaders.size());
        // Order is unspecified (set iteration); just verify both are
        // present rather than locking a specific order.
        assertTrue(goaders.contains(goader1.toString()));
        assertTrue(goaders.contains(goader2.toString()));
    }

    // ---- Schema 1.33 displayCard plumbing (audit-fix M2 broader).
    // Locks the in-memory wiring — extract(Game) reads live engine
    // state and is exercised in the e2e specs; here we pin
    // withDisplayCards / displayCardFor / null guards.

    @Test
    void displayCardFor_emptyContext_returnsNull() {
        assertNull(MultiplayerFrameContext.EMPTY.displayCardFor(UUID.randomUUID()));
    }

    @Test
    void displayCardFor_nullPlayerId_returnsNull() {
        assertNull(MultiplayerFrameContext.EMPTY.displayCardFor(null));
    }

    @Test
    void withDisplayCards_populatesPerPlayerLookup() {
        UUID alice = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        UUID bob = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
        DisplayCardRegistry.DisplayCard swiftspear =
                new DisplayCardRegistry.DisplayCard("Monastery Swiftspear", "KTK", "118");
        DisplayCardRegistry.DisplayCard bolt =
                new DisplayCardRegistry.DisplayCard("Lightning Bolt", "LEA", "161");

        MultiplayerFrameContext ctx = MultiplayerFrameContext.EMPTY
                .withDisplayCards(Map.of(alice, swiftspear, bob, bolt));

        assertEquals(swiftspear, ctx.displayCardFor(alice));
        assertEquals(bolt, ctx.displayCardFor(bob));
        assertNull(ctx.displayCardFor(UUID.randomUUID()),
                "unknown player → no display card");
    }

    @Test
    void withDisplayCards_nullMap_isEquivalentToEmpty() {
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.EMPTY.withDisplayCards(null);
        assertNull(ctx.displayCardFor(UUID.randomUUID()));
    }

    @Test
    void withDisplayCards_emptyMapOnEmptyContext_returnsSameInstance() {
        // Idempotency: empty + empty is a no-op (no fresh allocation).
        assertSame(MultiplayerFrameContext.EMPTY,
                MultiplayerFrameContext.EMPTY.withDisplayCards(Map.of()),
                "Re-binding empty display-cards on EMPTY must be a no-op.");
    }

    @Test
    void withDisplayCards_preservesGoadingAndConnectionTracker() {
        UUID permId = UUID.fromString("ddddddd1-1111-1111-1111-111111111111");
        UUID goader = UUID.fromString("ddddddd2-2222-2222-2222-222222222222");
        UUID alice = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
        DisplayCardRegistry.DisplayCard card =
                new DisplayCardRegistry.DisplayCard("Monastery Swiftspear", "KTK", "118");

        MultiplayerFrameContext ctx = MultiplayerFrameContext
                .forTesting(Map.of(permId, Set.of(goader)))
                .withDisplayCards(Map.of(alice, card));

        // Goading data still surfaces.
        assertEquals(1, ctx.goadingFor(permId).size());
        assertEquals(goader.toString(), ctx.goadingFor(permId).get(0));
        // Connection-tracker default still in place.
        assertEquals("connected", ctx.connectionStateFor(UUID.randomUUID()));
        // Display card now resolves.
        assertEquals(card, ctx.displayCardFor(alice));
    }

    /* =================================================================
     * Slice 5-F (Bundle 5 / Damage Moment, 2026-05-10) — coverage for
     * commanderDamageReceivedFor. The extract(Game) populate path
     * is exercised in the embedded-server integration suite (slice
     * 69e pattern); here we lock the accessor's UUID-keyed lookup,
     * String-key conversion, and null-input defenses.
     * ===============================================================*/

    @Test
    void commanderDamageReceivedFor_emptyContext_returnsEmptyMap() {
        MultiplayerFrameContext ctx = MultiplayerFrameContext.EMPTY;
        assertEquals(Map.of(), ctx.commanderDamageReceivedFor(UUID.randomUUID()));
    }

    @Test
    void commanderDamageReceivedFor_nullPlayerId_returnsEmptyMap() {
        // Defensive: a null PlayerView.getPlayerId() must NOT crash
        // the mapper. The wire contract for this field is "always
        // present, possibly empty" — never null.
        MultiplayerFrameContext ctx = MultiplayerFrameContext.EMPTY;
        assertEquals(Map.of(), ctx.commanderDamageReceivedFor(null));
    }

    @Test
    void commanderDamageReceivedFor_unknownPlayerId_returnsEmptyMap() {
        UUID alice = UUID.randomUUID();
        UUID aliceCmdr = UUID.randomUUID();
        UUID bob = UUID.randomUUID();
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.forTestingWithCommanderDamage(
                        Map.of(alice, Map.of(aliceCmdr, 7)));
        // Bob has received no commander damage — must return Map.of(),
        // not null.
        assertEquals(Map.of(), ctx.commanderDamageReceivedFor(bob));
    }

    @Test
    void commanderDamageReceivedFor_singleCommander_returnsStringKeyedMap() {
        UUID alice = UUID.randomUUID();
        UUID aliceCmdr = UUID.randomUUID();
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.forTestingWithCommanderDamage(
                        Map.of(alice, Map.of(aliceCmdr, 14)));
        Map<String, Integer> dmg = ctx.commanderDamageReceivedFor(alice);
        assertEquals(1, dmg.size());
        // UUID converted to String for JSON-friendly map keys.
        assertEquals(Integer.valueOf(14), dmg.get(aliceCmdr.toString()));
    }

    @Test
    void commanderDamageReceivedFor_partnerPairing_returnsBothCommanders() {
        // Partner / background pairings — an opponent can field 2
        // commanders. Each commander tracks damage independently;
        // both surface in the recipient's map. CR 704.5b applies
        // per-commander, so reaching 21 from EITHER triggers the
        // lethal sub-feature in slice 5-E.
        UUID alice = UUID.randomUUID();
        UUID partnerA = UUID.randomUUID();
        UUID partnerB = UUID.randomUUID();
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.forTestingWithCommanderDamage(
                        Map.of(alice, Map.of(partnerA, 12, partnerB, 6)));
        Map<String, Integer> dmg = ctx.commanderDamageReceivedFor(alice);
        assertEquals(2, dmg.size());
        assertEquals(Integer.valueOf(12), dmg.get(partnerA.toString()));
        assertEquals(Integer.valueOf(6), dmg.get(partnerB.toString()));
    }

    @Test
    void commanderDamageReceivedFor_multipleRecipients_isolatedPerPlayer() {
        // Each player's incoming-damage map is independent. Bob
        // receiving damage from Alice's commander does not leak into
        // Charlie's map.
        UUID alice = UUID.randomUUID();
        UUID bob = UUID.randomUUID();
        UUID aliceCmdr = UUID.randomUUID();
        UUID bobCmdr = UUID.randomUUID();
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.forTestingWithCommanderDamage(Map.of(
                        alice, Map.of(bobCmdr, 9),
                        bob, Map.of(aliceCmdr, 21)));
        Map<String, Integer> aliceDmg = ctx.commanderDamageReceivedFor(alice);
        Map<String, Integer> bobDmg = ctx.commanderDamageReceivedFor(bob);
        assertEquals(1, aliceDmg.size());
        assertEquals(Integer.valueOf(9), aliceDmg.get(bobCmdr.toString()));
        assertEquals(1, bobDmg.size());
        // 21+ is the lethal threshold (CR 704.5b); slice 5-E reads
        // this same map and fires the cinematic.
        assertEquals(Integer.valueOf(21), bobDmg.get(aliceCmdr.toString()));
    }

    @Test
    void commanderDamageReceivedFor_mapIsImmutableCopy() {
        // Defensive: the returned map must not be a reference into
        // the internal state. Callers may freely iterate / annotate
        // without polluting the next frame's read.
        UUID alice = UUID.randomUUID();
        UUID aliceCmdr = UUID.randomUUID();
        MultiplayerFrameContext ctx =
                MultiplayerFrameContext.forTestingWithCommanderDamage(
                        Map.of(alice, Map.of(aliceCmdr, 5)));
        Map<String, Integer> dmg = ctx.commanderDamageReceivedFor(alice);
        // Map.copyOf returns an immutable Map; mutation throws.
        try {
            dmg.put("extra", 99);
            // If no exception thrown, the contract failed.
            assertEquals(true, false,
                    "commanderDamageReceivedFor map must be immutable");
        } catch (UnsupportedOperationException ok) {
            // Expected.
        }
    }
}
