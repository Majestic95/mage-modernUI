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
}
