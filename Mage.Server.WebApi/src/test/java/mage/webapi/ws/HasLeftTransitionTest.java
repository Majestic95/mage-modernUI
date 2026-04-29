package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.webapi.dto.stream.WebDialogClear;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertSame;

/**
 * Slice 69c (ADR 0010 v2 D11b) — unit coverage for the {@code hasLeft}
 * transition detector that synthesizes {@code dialogClear} frames.
 *
 * <p>Tests target the pure data kernel
 * {@link WebSocketCallbackHandler#detectNewlyLeft(UUID, Set, boolean)}
 * — the accessor pattern mirrors {@code AiActionDiagnosticTest}'s use
 * of {@link WebSocketCallbackHandler#observeTurnTransition} (which also
 * avoids constructing a full upstream {@code GameView} in a unit test).
 *
 * <p>The end-to-end emission path (real engine → upstream callback
 * → mapper → synthesized {@code dialogClear} on the wire) is
 * exercised in slice 69e e2e specs against a 4p FFA fixture.
 */
class HasLeftTransitionTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final UUID GAME_A = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID GAME_B = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID ALICE = UUID.fromString("aaaaaaaa-1111-1111-1111-111111111111");
    private static final UUID BOB = UUID.fromString("bbbbbbbb-2222-2222-2222-222222222222");
    private static final UUID CAROL = UUID.fromString("cccccccc-3333-3333-3333-333333333333");

    @Test
    void firstObservationOfLeaver_returnsNewlyLeftSet() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        // Alice concedes — engine's next gameUpdate carries her
        // hasLeft=true. The handler observes this for the first time.
        Set<UUID> newly = h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        assertEquals(Set.of(ALICE), newly,
                "first hasLeft observation = synthesize dialogClear");
        assertEquals(Set.of(ALICE), h.leaversForTest(GAME_A),
                "the leaver set is recorded so the next call dedupes");
    }

    @Test
    void repeatedObservationOfSameLeaver_returnsEmpty() {
        // Engine fires many gameUpdate frames per turn; each one
        // carries Alice's hasLeft=true. We must NOT emit dialogClear
        // on every frame — only the FIRST observation per game.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        Set<UUID> second = h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        Set<UUID> third = h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        assertTrue(second.isEmpty(), "second call: alice already announced");
        assertTrue(third.isEmpty(), "third call: alice already announced");
    }

    @Test
    void cascadingConcessions_returnsOnlyTheNewLeaverEachStep() {
        // 4p FFA. Alice concedes first, then a few turns later Carol
        // concedes. Each transition should yield exactly one
        // newly-left UUID.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        Set<UUID> first = h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        Set<UUID> second = h.detectNewlyLeft(GAME_A, Set.of(ALICE, CAROL), false);
        assertEquals(Set.of(ALICE), first);
        assertEquals(Set.of(CAROL), second,
                "cascading concession: only the new leaver yields a frame");
    }

    @Test
    void simultaneousConcessions_returnsAllNewLeavers() {
        // Defensive — if upstream batches a state change such that
        // two players' hasLeft flips in the same frame (rare but
        // possible during state-based actions), both should be
        // synthesized. Set semantics handle this cleanly.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        Set<UUID> result = h.detectNewlyLeft(GAME_A, Set.of(ALICE, BOB), false);
        assertEquals(Set.of(ALICE, BOB), result);
    }

    @Test
    void resetClearsLeaverSet_game2DoesNotInheritGame1Leavers() {
        // Best-of-three: Alice loses game 1 (concedes). Game 2
        // starts fresh — Alice is back at full life, hasLeft=false.
        // The reset flag (gameInit) must clear the prior leaver set
        // so a subsequent same-game-id frame doesn't dedupe against
        // game-1's stale entry.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        assertEquals(Set.of(ALICE), h.leaversForTest(GAME_A));

        // game-2 init: gameInit fires with reset=true and an empty
        // currentlyLeft set (no one has left the new game yet).
        h.detectNewlyLeft(GAME_A, Set.of(), true);
        assertEquals(Set.of(), h.leaversForTest(GAME_A),
                "reset must purge prior leaver set");

        // A few turns into game 2, Alice concedes again. Should
        // synthesize a fresh dialogClear for her (not deduped).
        Set<UUID> game2Concession = h.detectNewlyLeft(
                GAME_A, Set.of(ALICE), false);
        assertEquals(Set.of(ALICE), game2Concession,
                "game-2 reconcession of alice yields a fresh dialogClear");
    }

    @Test
    void perGameIsolation_concededInGameAdoesNotDedupeInGameB() {
        // Auditor-like cross-game-isolation guard. The handler is
        // per-WebSession (per user) and a single user can be in
        // multiple games. Leavers in game A must not dedupe against
        // leavers in game B — that's how the slice-49 cross-game
        // diagnostic bug was caused (auditor-2 fix in
        // diagnosticsByGame). Same shape applies here.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);
        Set<UUID> gameB = h.detectNewlyLeft(GAME_B, Set.of(ALICE), false);
        assertEquals(Set.of(ALICE), gameB,
                "alice leaving game-B is independent of game-A");
        assertEquals(Set.of(ALICE), h.leaversForTest(GAME_A));
        assertEquals(Set.of(ALICE), h.leaversForTest(GAME_B));
    }

    @Test
    void emptyOrNullCurrentlyLeft_returnsEmptyAndDoesNotMutate() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.detectNewlyLeft(GAME_A, Set.of(ALICE), false);

        assertTrue(h.detectNewlyLeft(GAME_A, Set.of(), false).isEmpty());
        assertTrue(h.detectNewlyLeft(GAME_A, null, false).isEmpty());
        assertEquals(Set.of(ALICE), h.leaversForTest(GAME_A),
                "no-currently-left calls must not clear the prior set "
                        + "(only reset=true clears)");
    }

    @Test
    void nullGameId_isANoOp() {
        // Defensive — if a callback omits objectId for any reason
        // (shouldn't happen for game frames, but defense in depth),
        // the kernel returns empty without throwing.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        Set<UUID> result = h.detectNewlyLeft(null, Set.of(ALICE), false);
        assertTrue(result.isEmpty());
    }

    @Test
    void leaversForTest_unrecordedGame_returnsEmpty() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        assertSame(Set.of(), h.leaversForTest(GAME_A),
                "no observations yet → empty set, not null");
    }

    @Test
    void webDialogClear_jsonShape_locksTwoFields() throws Exception {
        // Wire-format lock. WebDialogClear is a small synthetic
        // envelope; pin the shape so a future field add can't sneak
        // through without a CHANGELOG entry.
        WebDialogClear dto = new WebDialogClear(
                ALICE.toString(),
                WebDialogClear.REASON_PLAYER_LEFT);
        JsonNode node = JSON.valueToTree(dto);
        assertEquals(2, node.size(),
                "WebDialogClear must have exactly 2 fields; got: " + node);
        for (String f : List.of("playerId", "reason")) {
            assertTrue(node.has(f), "missing field: " + f);
        }
        assertEquals("PLAYER_LEFT", node.get("reason").asText(),
                "v2 emits PLAYER_LEFT for any leaver detection (D11b)");
    }
}
