package mage.webapi.ws;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
 */
class AiActionDiagnosticTest {

    @Test
    void resetAnchorsWithoutLogging() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", /* reset */ true);
        assertEquals(1, h.lastSeenTurn());
        assertEquals("alice", h.lastSeenActivePlayer());
        assertEquals(1, h.framesThisSegment(),
                "first frame in a fresh segment counts as 1");
    }

    @Test
    void framesAccumulateWithinTheSameSegment() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", /* reset */ true);
        for (int i = 0; i < 9; i++) {
            h.observeTurnTransition(1, "alice", /* reset */ false);
        }
        assertEquals(10, h.framesThisSegment(),
                "10 same-(turn,player) frames → 10");
    }

    @Test
    void turnAdvanceResetsSegmentCount() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", /* reset */ true);
        h.observeTurnTransition(1, "alice", false);
        h.observeTurnTransition(1, "alice", false);
        // Still inside segment for turn=1, player=alice.
        assertEquals(3, h.framesThisSegment());
        // Turn advances → new segment, count resets to 1.
        h.observeTurnTransition(2, "alice", false);
        assertEquals(2, h.lastSeenTurn());
        assertEquals(1, h.framesThisSegment());
    }

    @Test
    void activePlayerChangeResetsSegmentCountWithinSameTurn() {
        // Mid-turn priority handoffs (e.g. instant-speed exchanges)
        // shouldn't reset the counter — only the activePlayer change
        // does, and that's the segment we care about for AI-action
        // attribution.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(3, "alice", /* reset */ true);
        h.observeTurnTransition(3, "alice", false);
        h.observeTurnTransition(3, "alice", false);
        assertEquals(3, h.framesThisSegment());
        // Active player changes (turn shared in some multiplayer
        // edge cases isn't a concern for slice-49 1v1 scope, but the
        // observer treats it as a segment boundary regardless).
        h.observeTurnTransition(3, "bob", false);
        assertEquals("bob", h.lastSeenActivePlayer());
        assertEquals(1, h.framesThisSegment());
    }

    @Test
    void resetReanchorsForGameTwoOfBestOfThree() {
        // Game-2 of a best-of-three resets turn numbering. The reset
        // path must NOT log "frames=N for turn=12" then suddenly jump
        // to turn=1 — the gameInit path passes reset=true to suppress
        // that bogus segment close-out.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "alice", true);
        for (int i = 0; i < 5; i++) {
            h.observeTurnTransition(12, "bob", false);
        }
        // Game-2 begins.
        h.observeTurnTransition(1, "alice", /* reset */ true);
        assertEquals(1, h.lastSeenTurn());
        assertEquals("alice", h.lastSeenActivePlayer());
        assertEquals(1, h.framesThisSegment());
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
        h.observeTurnTransition(1, "ai", /* reset */ true);
        // Drive 2 LOW segments (turn advance with only 1 frame each).
        // We stop short of the fallback threshold (3) so we can
        // observe the counter at 2 without it auto-resetting after
        // firing.
        h.observeTurnTransition(2, "ai", false); // closes turn=1 LOW (1 frame)
        assertEquals(1, h.consecutiveLowSegmentsForTest(),
                "1st LOW segment → counter = 1");
        h.observeTurnTransition(3, "ai", false); // closes turn=2 LOW (1 frame)
        assertEquals(2, h.consecutiveLowSegmentsForTest(),
                "2nd LOW segment → counter = 2");
    }

    @Test
    void consecutiveLowCounter_resetsOnNormalSegment() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", /* reset */ true);
        // 2 LOW segments.
        h.observeTurnTransition(2, "ai", false); // closes turn=1 (1 frame)
        h.observeTurnTransition(3, "ai", false); // closes turn=2 (1 frame)
        assertEquals(2, h.consecutiveLowSegmentsForTest());
        // Now drive a NORMAL segment (>= LOW_FRAMES_THRESHOLD frames)
        // and close it: this should reset the counter to 0.
        for (int i = 0; i < WebSocketCallbackHandler.LOW_FRAMES_THRESHOLD; i++) {
            h.observeTurnTransition(3, "ai", false);
        }
        // Close the now-normal turn-3 segment by advancing turn.
        h.observeTurnTransition(4, "ai", false);
        assertEquals(0, h.consecutiveLowSegmentsForTest(),
                "a normal segment must break the LOW streak");
        // A subsequent LOW segment should land at 1, not pick up where
        // we left off.
        h.observeTurnTransition(5, "ai", false);
        assertEquals(1, h.consecutiveLowSegmentsForTest());
    }

    @Test
    void consecutiveLowCounter_resetsOnGameInit() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", true);
        // 1 LOW segment.
        h.observeTurnTransition(2, "ai", false);
        assertEquals(1, h.consecutiveLowSegmentsForTest());
        // gameInit (e.g. game-2 of best-of-three) → counter clears.
        h.observeTurnTransition(1, "ai", /* reset */ true);
        assertEquals(0, h.consecutiveLowSegmentsForTest(),
                "gameInit reset must clear the consecutive-LOW counter");
    }

    @Test
    void fallbackFiresAtThreshold() {
        // No embedded server → triggerStuckAiFallback() takes the
        // graceful no-op branch (boundGameId is null + embedded is
        // null). We assert the counter reset post-firing and that no
        // exception escapes the engine-thread call.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observeTurnTransition(1, "ai", true);
        // 3 LOW segments — third one trips the fallback threshold.
        h.observeTurnTransition(2, "ai", false); // counter → 1
        h.observeTurnTransition(3, "ai", false); // counter → 2
        h.observeTurnTransition(4, "ai", false); // counter → 3 → fires → reset to 0
        assertEquals(0, h.consecutiveLowSegmentsForTest(),
                "counter must reset to 0 after the fallback fires "
                        + "so we don't re-fire on the same stall");
        // Exactly LOW_FRAMES_FALLBACK_THRESHOLD pinned for this test.
        assertEquals(3, WebSocketCallbackHandler.LOW_FRAMES_FALLBACK_THRESHOLD);
    }
}
