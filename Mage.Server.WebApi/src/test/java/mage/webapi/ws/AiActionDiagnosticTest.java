package mage.webapi.ws;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Unit coverage for the slice-49 AI-action diagnostic counter on
 * {@link WebSocketCallbackHandler}. Exercises
 * {@link WebSocketCallbackHandler#observeTurnTransition} directly so
 * the test does not need to construct a real {@code GameView} (the
 * upstream type takes a full {@code Game}/{@code GameState} pair —
 * impractical to mock in a unit test).
 *
 * <p>The end-to-end path is exercised in live-test smoke runs; here
 * we pin the segment-counting logic so a future refactor doesn't
 * break the threshold semantics.
 *
 * <p>The {@code GAME_A} / {@code GAME_B} synthetic UUIDs stand in for
 * the real {@code ClientCallback.getObjectId()} values in production.
 * After the auditor-2 cross-game-isolation fix the diagnostic state
 * is keyed per-game in {@link WebSocketCallbackHandler#diagnosticsByGame},
 * so every {@code observeTurnTransition} call must pass an explicit
 * gameId.
 */
class AiActionDiagnosticTest {

    private static final UUID GAME_A = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID GAME_B = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test
    void resetAnchorsWithoutLogging() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", /* reset */ true, GAME_A);
        WebSocketCallbackHandler.AiSegmentDiagnostics d = h.diagnosticsForTest(GAME_A);
        assertNotNull(d, "first observed frame must lazy-create the per-game state");
        assertEquals(1, d.lastSeenTurn);
        assertEquals("alice", d.lastSeenActivePlayer);
        assertEquals(1, d.framesThisSegment,
                "first frame in a fresh segment counts as 1");
    }

    @Test
    void framesAccumulateWithinTheSameSegment() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", /* reset */ true, GAME_A);
        for (int i = 0; i < 9; i++) {
            h.observeTurnTransition(1, "alice", /* reset */ false, GAME_A);
        }
        assertEquals(10, h.diagnosticsForTest(GAME_A).framesThisSegment,
                "10 same-(turn,player) frames → 10");
    }

    @Test
    void turnAdvanceResetsSegmentCount() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", /* reset */ true, GAME_A);
        h.observeTurnTransition(1, "alice", false, GAME_A);
        h.observeTurnTransition(1, "alice", false, GAME_A);
        // Still inside segment for turn=1, player=alice.
        assertEquals(3, h.diagnosticsForTest(GAME_A).framesThisSegment);
        // Turn advances → new segment, count resets to 1.
        h.observeTurnTransition(2, "alice", false, GAME_A);
        WebSocketCallbackHandler.AiSegmentDiagnostics d = h.diagnosticsForTest(GAME_A);
        assertEquals(2, d.lastSeenTurn);
        assertEquals(1, d.framesThisSegment);
    }

    @Test
    void activePlayerChangeResetsSegmentCountWithinSameTurn() {
        // Mid-turn priority handoffs (e.g. instant-speed exchanges)
        // shouldn't reset the counter — only the activePlayer change
        // does, and that's the segment we care about for AI-action
        // attribution.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(3, "alice", /* reset */ true, GAME_A);
        h.observeTurnTransition(3, "alice", false, GAME_A);
        h.observeTurnTransition(3, "alice", false, GAME_A);
        assertEquals(3, h.diagnosticsForTest(GAME_A).framesThisSegment);
        // Active player changes (turn shared in some multiplayer
        // edge cases isn't a concern for slice-49 1v1 scope, but the
        // observer treats it as a segment boundary regardless).
        h.observeTurnTransition(3, "bob", false, GAME_A);
        WebSocketCallbackHandler.AiSegmentDiagnostics d = h.diagnosticsForTest(GAME_A);
        assertEquals("bob", d.lastSeenActivePlayer);
        assertEquals(1, d.framesThisSegment);
    }

    @Test
    void resetReanchorsForGameTwoOfBestOfThree() {
        // Game-2 of a best-of-three resets turn numbering. The reset
        // path must NOT log "frames=N for turn=12" then suddenly jump
        // to turn=1 — the gameInit path passes reset=true to suppress
        // that bogus segment close-out.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", true, GAME_A);
        for (int i = 0; i < 5; i++) {
            h.observeTurnTransition(12, "bob", false, GAME_A);
        }
        // Game-2 begins.
        h.observeTurnTransition(1, "alice", /* reset */ true, GAME_A);
        WebSocketCallbackHandler.AiSegmentDiagnostics d = h.diagnosticsForTest(GAME_A);
        assertEquals(1, d.lastSeenTurn);
        assertEquals("alice", d.lastSeenActivePlayer);
        assertEquals(1, d.framesThisSegment);
    }

    @Test
    void thresholdConstantIsBelowEmptyTurnFloor() {
        // Sanity-pin: an empty turn produces ~10–12 phase updates
        // (untap/upkeep/draw/main1/begin-combat/declare-attackers/
        // declare-blockers/combat-damage/end-combat/main2/end/cleanup).
        // The threshold must sit clearly below that floor — anything
        // at or above 10 would WARN on every empty turn and burn the
        // signal.
        assertEquals(3, WebSocketCallbackHandler.LOW_FRAMES_THRESHOLD,
                "threshold pinned at 3 — clearly below the empty-turn "
                        + "phase-update floor (~10) so WARNs only "
                        + "surface pathological stalls");
    }

    // ---------- Slice 61 — Mad-AI no-plays fallback intervention ----------

    @Test
    void consecutiveLowCounter_incrementsOnEachLowSegment() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", /* reset */ true, GAME_A);
        // Drive 2 LOW segments (turn advance with only 1 frame each).
        // We stop short of the fallback threshold (3) so we can
        // observe the counter at 2 without it auto-resetting after
        // firing.
        h.observeTurnTransition(2, "ai", false, GAME_A); // closes turn=1 LOW (1 frame)
        assertEquals(1, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "1st LOW segment → counter = 1");
        h.observeTurnTransition(3, "ai", false, GAME_A); // closes turn=2 LOW (1 frame)
        assertEquals(2, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "2nd LOW segment → counter = 2");
    }

    @Test
    void consecutiveLowCounter_resetsOnNormalSegment() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", /* reset */ true, GAME_A);
        // 2 LOW segments.
        h.observeTurnTransition(2, "ai", false, GAME_A); // closes turn=1 (1 frame)
        h.observeTurnTransition(3, "ai", false, GAME_A); // closes turn=2 (1 frame)
        assertEquals(2, h.diagnosticsForTest(GAME_A).consecutiveLowSegments);
        // Now drive a NORMAL segment (>= LOW_FRAMES_THRESHOLD frames)
        // and close it: this should reset the counter to 0.
        for (int i = 0; i < WebSocketCallbackHandler.LOW_FRAMES_THRESHOLD; i++) {
            h.observeTurnTransition(3, "ai", false, GAME_A);
        }
        // Close the now-normal turn-3 segment by advancing turn.
        h.observeTurnTransition(4, "ai", false, GAME_A);
        assertEquals(0, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "a normal segment must break the LOW streak");
        // A subsequent LOW segment should land at 1, not pick up where
        // we left off.
        h.observeTurnTransition(5, "ai", false, GAME_A);
        assertEquals(1, h.diagnosticsForTest(GAME_A).consecutiveLowSegments);
    }

    @Test
    void consecutiveLowCounter_resetsOnGameInit() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", true, GAME_A);
        // 1 LOW segment.
        h.observeTurnTransition(2, "ai", false, GAME_A);
        assertEquals(1, h.diagnosticsForTest(GAME_A).consecutiveLowSegments);
        // gameInit (e.g. game-2 of best-of-three) → counter clears.
        h.observeTurnTransition(1, "ai", /* reset */ true, GAME_A);
        assertEquals(0, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "gameInit reset must clear the consecutive-LOW counter");
    }

    @Test
    void fallbackFiresAtThreshold() {
        // No embedded server → triggerStuckAiFallback() takes the
        // graceful no-op branch (embedded is null). We assert the
        // counter reset post-firing and that no exception escapes the
        // engine-thread call.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", true, GAME_A);
        // 3 LOW segments — third one trips the fallback threshold.
        h.observeTurnTransition(2, "ai", false, GAME_A); // counter → 1
        h.observeTurnTransition(3, "ai", false, GAME_A); // counter → 2
        h.observeTurnTransition(4, "ai", false, GAME_A); // counter → 3 → fires → reset to 0
        assertEquals(0, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "counter must reset to 0 after the fallback fires "
                        + "so we don't re-fire on the same stall");
        // Exactly LOW_FRAMES_FALLBACK_THRESHOLD pinned for this test.
        assertEquals(3, WebSocketCallbackHandler.LOW_FRAMES_FALLBACK_THRESHOLD);
    }

    @Test
    void consecutiveLowCounter_isolatedPerGame() {
        // Auditor-2 cross-game isolation regression test. A single
        // WebSocketCallbackHandler is 1:1 per WebSession (per
        // username), but a user can be in multiple games at once
        // (e.g. spectating one match while playing another). Before
        // the fix, the per-handler scalar diagnostic counters
        // cross-contaminated: a turn advance on game A would close
        // out the segment counter that was actually tracking game B,
        // and the slice-61 fallback could fire on the wrong game.
        //
        // The drive sequence below produces 3 LOW segments on GAME_A
        // (which would historically fire the fallback) interleaved
        // with 1 LOW segment on GAME_B. With per-game keying GAME_A's
        // counter must independently reach 3 (and reset to 0 after
        // firing), while GAME_B's stays at 1 — they don't share state.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", /* reset */ true, GAME_A);
        h.observeTurnTransition(1, "ai", /* reset */ true, GAME_B);

        // 1st LOW on A.
        h.observeTurnTransition(2, "ai", false, GAME_A);
        assertEquals(1, h.diagnosticsForTest(GAME_A).consecutiveLowSegments);

        // 2nd LOW on A.
        h.observeTurnTransition(3, "ai", false, GAME_A);
        assertEquals(2, h.diagnosticsForTest(GAME_A).consecutiveLowSegments);

        // 1 LOW on B — must NOT advance A's counter.
        h.observeTurnTransition(2, "ai", false, GAME_B);
        assertEquals(1, h.diagnosticsForTest(GAME_B).consecutiveLowSegments,
                "GAME_B's counter is independent");
        assertEquals(2, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "GAME_A's counter must be unchanged by activity on GAME_B");

        // 3rd LOW on A → fallback fires for GAME_A only, A's counter
        // resets, B's untouched.
        h.observeTurnTransition(4, "ai", false, GAME_A);
        assertEquals(0, h.diagnosticsForTest(GAME_A).consecutiveLowSegments,
                "GAME_A's counter resets after fallback fires");
        assertEquals(1, h.diagnosticsForTest(GAME_B).consecutiveLowSegments,
                "GAME_B unaffected by GAME_A's fallback firing");
    }
}
