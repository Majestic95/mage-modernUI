package mage.webapi.upstream;

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
}
