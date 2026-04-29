package mage.webapi.ws;

import mage.webapi.SchemaVersion;
import mage.webapi.dto.stream.WebStreamFrame;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 68b (ADR 0010 v2 D6) — buffer eviction priority unit tests.
 *
 * <p>Drives the per-handler resume buffer to capacity with synthetic
 * frames and asserts the eviction policy: chat frames go first;
 * state / dialog frames are preserved as long as any droppable frame
 * exists; last-resort fallback is oldest-first when every frame is
 * essential. Locks the slice 68b contract so a future refactor can't
 * silently revert to the slice-3 naive {@code removeFirst()} that
 * would drop replay-worthy state under load.
 *
 * <p>Uses {@link WebSocketCallbackHandler#appendBufferForTest} +
 * {@link WebSocketCallbackHandler#bufferSnapshotForTest} — the same
 * test-helper pattern as {@code AiActionDiagnosticTest}'s
 * {@code observeTurnTransition} accessor.
 */
class BufferEvictionPriorityTest {

    private WebSocketCallbackHandler h;

    @BeforeEach
    void setUp() {
        h = new WebSocketCallbackHandler("alice");
        // Slice 70 — counter state is process-wide; reset so this
        // test class's overflow drops don't leak into a later
        // MetricsRegistryTest run.
        mage.webapi.metrics.MetricsRegistry.resetForTest();
    }

    private static WebStreamFrame frame(String method, int messageId) {
        return new WebStreamFrame(
                SchemaVersion.CURRENT, method, messageId, null, null);
    }

    private void fillWith(String method, int count) {
        for (int i = 0; i < count; i++) {
            h.appendBufferForTest(frame(method, i));
        }
    }

    @Test
    void isDroppable_chatAndGameInformYes_everythingElseNo() {
        // Lock the v2 droppable set: chat + gameInform. ADR D6
        // says "chat, pulse, informational" — gameInform is the
        // canonical "informational" frame upstream emits via
        // GAME_UPDATE_AND_INFORM (the engine's free-text "alice
        // plays Forest" log stream). Replay-safe to drop because
        // every subsequent gameInform/gameUpdate carries cumulative
        // state. Cost: slice-18 game-log strip may miss one
        // descriptive entry on overflow. Dialog kinds + state
        // updates + dialogClear all preserved.
        assertTrue(WebSocketCallbackHandler.isDroppable("chatMessage"));
        assertTrue(WebSocketCallbackHandler.isDroppable("gameInform"));
        assertFalse(WebSocketCallbackHandler.isDroppable("gameInit"));
        assertFalse(WebSocketCallbackHandler.isDroppable("gameUpdate"));
        assertFalse(WebSocketCallbackHandler.isDroppable("gameAsk"));
        assertFalse(WebSocketCallbackHandler.isDroppable("gameTarget"));
        assertFalse(WebSocketCallbackHandler.isDroppable("gameSelect"));
        assertFalse(WebSocketCallbackHandler.isDroppable("dialogClear"));
        assertFalse(WebSocketCallbackHandler.isDroppable("streamHello"));
        assertFalse(WebSocketCallbackHandler.isDroppable("gameOver"));
        assertFalse(WebSocketCallbackHandler.isDroppable("endGameInfo"));
        // Defensive — null / unknown method name should NOT trigger
        // a default-droppable. Better to keep the unknown frame
        // (preserve replay correctness) than evict it preferentially.
        assertFalse(WebSocketCallbackHandler.isDroppable(null));
        assertFalse(WebSocketCallbackHandler.isDroppable("unknownMethod"));
    }

    @Test
    void underCapacity_addAppendsWithoutEvicting() {
        fillWith("gameUpdate", 10);
        h.appendBufferForTest(frame("gameUpdate", 100));
        assertEquals(11, h.bufferSize(),
                "under-capacity append must NOT evict");
    }

    @Test
    void atCapacity_addEvictsOneFrame_sizeStaysAtCapacity() {
        // Fill to exactly BUFFER_CAPACITY=64 with all-essential
        // frames (no chat). One more push must evict exactly one
        // frame — the size stays clamped at capacity.
        fillWith("gameUpdate", 64);
        assertEquals(64, h.bufferSize());
        h.appendBufferForTest(frame("gameUpdate", 1000));
        assertEquals(64, h.bufferSize(),
                "at-capacity append clamps to BUFFER_CAPACITY=64");
    }

    @Test
    void overflowEvicts_chatBeforeStateFrames_whenAnyChatPresent() {
        // 60 state frames (msgIds 0..59) + 4 chat frames (msgIds
        // 60..63) interleaved at the END so the chat is NEWER than
        // the state. The eviction policy walks oldest → newest and
        // picks the first chat regardless of position — confirms
        // priority overrides recency.
        for (int i = 0; i < 60; i++) {
            h.appendBufferForTest(frame("gameUpdate", i));
        }
        for (int i = 60; i < 64; i++) {
            h.appendBufferForTest(frame("chatMessage", i));
        }
        assertEquals(64, h.bufferSize());

        // Push another state frame — overflows. Should evict a chat
        // (the first one, msgId=60), not the oldest state (msgId=0).
        h.appendBufferForTest(frame("gameUpdate", 1000));

        List<WebStreamFrame> snap = h.bufferSnapshotForTest();
        assertEquals(64, snap.size());
        // Oldest state frame (msgId=0) is still there — confirms
        // priority eviction did NOT touch state.
        assertEquals(0, snap.get(0).messageId());
        assertEquals("gameUpdate", snap.get(0).method());
        // Only 3 chat frames remain (one was evicted).
        long chatCount = snap.stream()
                .filter(f -> "chatMessage".equals(f.method()))
                .count();
        assertEquals(3, chatCount,
                "exactly one chat should have been evicted");
        // The evicted chat was the oldest one (msgId=60). The
        // remaining chats are msgIds 61, 62, 63.
        long oldestSurvivingChatId = snap.stream()
                .filter(f -> "chatMessage".equals(f.method()))
                .mapToLong(WebStreamFrame::messageId)
                .min()
                .orElse(-1L);
        assertEquals(61L, oldestSurvivingChatId,
                "eviction picked the OLDEST chat (priority + recency)");
    }

    @Test
    void overflowEvicts_earliestDroppable_whenChatScattered() {
        // Critic N3 — the iteration order matters when droppable
        // frames are scattered, not clustered. Set chat at indices
        // 5 AND 50, state everywhere else. The eviction must pick
        // the EARLIEST droppable (the chat at index 5), not just
        // any droppable. Locks the iteration direction.
        for (int i = 0; i < 64; i++) {
            if (i == 5 || i == 50) {
                h.appendBufferForTest(frame("chatMessage", i));
            } else {
                h.appendBufferForTest(frame("gameUpdate", i));
            }
        }
        h.appendBufferForTest(frame("gameUpdate", 1000));

        List<WebStreamFrame> snap = h.bufferSnapshotForTest();
        // Chat at messageId=5 was evicted; chat at messageId=50 remains.
        long chatCount = snap.stream()
                .filter(f -> "chatMessage".equals(f.method()))
                .count();
        assertEquals(1, chatCount,
                "exactly one chat (the EARLIEST one) should be evicted");
        long surviving = snap.stream()
                .filter(f -> "chatMessage".equals(f.method()))
                .mapToLong(WebStreamFrame::messageId)
                .findFirst()
                .orElse(-1L);
        assertEquals(50L, surviving,
                "the chat at index 50 must survive; the iteration "
                        + "picks oldest droppable, not arbitrary droppable");
    }

    @Test
    void overflowEvicts_chatBeforeGameInform_whenBothPresent() {
        // Both chat and gameInform are droppable per slice-68b
        // expansion. Iteration walks oldest → newest and picks the
        // first droppable — whichever happens to be older. With
        // chat at the start and gameInform later, chat goes.
        h.appendBufferForTest(frame("chatMessage", 0));
        for (int i = 1; i < 32; i++) {
            h.appendBufferForTest(frame("gameUpdate", i));
        }
        for (int i = 32; i < 64; i++) {
            h.appendBufferForTest(frame("gameInform", i));
        }
        h.appendBufferForTest(frame("gameUpdate", 1000));

        List<WebStreamFrame> snap = h.bufferSnapshotForTest();
        // Chat (msgId=0) was the oldest droppable → evicted. All
        // 32 gameInforms remain.
        long chatCount = snap.stream()
                .filter(f -> "chatMessage".equals(f.method()))
                .count();
        assertEquals(0, chatCount, "the only chat should be evicted");
        long gameInformCount = snap.stream()
                .filter(f -> "gameInform".equals(f.method()))
                .count();
        assertEquals(32, gameInformCount,
                "gameInform survives when older chat is available to drop");
    }

    @Test
    void overflowEvicts_oldestState_whenNoChatPresent() {
        // All-essential buffer: 64 state frames (no chat, no
        // gameInform). One more push has no droppable to find —
        // falls back to last-resort oldest-first eviction. This is
        // the throttled WARN-log path.
        fillWith("gameUpdate", 64);
        h.appendBufferForTest(frame("gameAsk", 1000));

        List<WebStreamFrame> snap = h.bufferSnapshotForTest();
        assertEquals(64, snap.size());
        // Oldest (msgId=0) was evicted; the new oldest is msgId=1.
        assertEquals(1, snap.get(0).messageId(),
                "fallback eviction drops the OLDEST when no chat present");
        // The newest entry is the just-appended frame.
        assertEquals(1000, snap.get(snap.size() - 1).messageId());
        assertEquals("gameAsk", snap.get(snap.size() - 1).method());
    }

    @Test
    void overflowEvicts_chatBeforeDialogClear() {
        // dialogClear (slice 69c D11b) is intentionally NON-droppable
        // even though the ADR D11b reconnect ordering caveat says a
        // missed dialogClear can be inferred from the next
        // hasLeft=true gameUpdate. Lock the contract: chat goes
        // first, dialogClear is preserved.
        for (int i = 0; i < 30; i++) {
            h.appendBufferForTest(frame("chatMessage", i));
        }
        for (int i = 30; i < 64; i++) {
            h.appendBufferForTest(frame("dialogClear", i));
        }
        h.appendBufferForTest(frame("gameUpdate", 1000));

        List<WebStreamFrame> snap = h.bufferSnapshotForTest();
        // All 34 dialogClears must still be present — only chat
        // gets evicted.
        long dialogClearCount = snap.stream()
                .filter(f -> "dialogClear".equals(f.method()))
                .count();
        assertEquals(34, dialogClearCount,
                "dialogClear must be preserved against chat eviction");
        long chatCount = snap.stream()
                .filter(f -> "chatMessage".equals(f.method()))
                .count();
        assertEquals(29, chatCount,
                "exactly one chat evicted (we had 30, 1 dropped)");
    }

    @Test
    void overflow_incrementsBufferDropsCounter() {
        // Slice 70 wiring sanity-check: every overflow eviction (chat
        // or essential-fallback) bumps the metrics counter by 1.
        fillWith("gameUpdate", 64);
        long before = mage.webapi.metrics.MetricsRegistry.get(
                mage.webapi.metrics.MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL);

        h.appendBufferForTest(frame("gameUpdate", 1000));
        h.appendBufferForTest(frame("gameUpdate", 1001));
        h.appendBufferForTest(frame("gameUpdate", 1002));

        long after = mage.webapi.metrics.MetricsRegistry.get(
                mage.webapi.metrics.MetricsRegistry.BUFFER_OVERFLOW_DROPS_TOTAL);
        assertEquals(3L, after - before,
                "every overflow append should bump the drop counter");
    }

    @Test
    void framesSince_afterEviction_returnsRemainingFramesInOrder() {
        // End-to-end sanity: after eviction reshuffles the buffer,
        // framesSince() — the public reconnect surface — still
        // returns the surviving frames in arrival order. This is the
        // load-bearing client contract.
        for (int i = 0; i < 32; i++) {
            h.appendBufferForTest(frame("chatMessage", i));
        }
        for (int i = 32; i < 64; i++) {
            h.appendBufferForTest(frame("gameUpdate", i));
        }
        // Add one more — evicts a chat (msgId=0).
        h.appendBufferForTest(frame("gameUpdate", 64));

        // Reconnect with since=10 — should get frames 11..64 minus
        // the evicted chat 0 (which was already < 10 anyway, no
        // observable difference here, but lock the order).
        List<WebStreamFrame> replay = h.framesSince(10);
        // Verify monotonic messageId order.
        for (int i = 1; i < replay.size(); i++) {
            assertTrue(
                    replay.get(i).messageId() > replay.get(i - 1).messageId(),
                    "framesSince must return frames in messageId order");
        }
    }
}
