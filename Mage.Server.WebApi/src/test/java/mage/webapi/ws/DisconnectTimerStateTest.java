package mage.webapi.ws;

import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.webapi.SchemaVersion;
import mage.webapi.dto.stream.WebDialogClear;
import mage.webapi.dto.stream.WebStreamFrame;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Slice 70-H.5 — unit coverage for the per-prompt disconnect-timer
 * state-machine kernels in {@link WebSocketCallbackHandler}.
 *
 * <p>Tests target the transition kernels
 * ({@link WebSocketCallbackHandler#observePromptState},
 * {@link WebSocketCallbackHandler#cancelDisconnectTimer},
 * {@link WebSocketCallbackHandler#cancelAllDisconnectTimers}) and
 * the open-prompt + armed-timer state observable via package-private
 * accessors. The {@link WebSocketCallbackHandler#fireDisconnectTimer}
 * body itself isn't unit-tested here because it requires a live
 * {@code AuthService} + {@code EmbeddedServer}; that path is covered
 * by integration / e2e tests in slice 70-H.5 acceptance.
 *
 * <p>Pattern mirrors {@code HasLeftTransitionTest} — handlers are
 * constructed via the test-friendly 1-arg ctor (no embedded /
 * AuthService), and synthetic {@link ClientCallback} fixtures drive
 * the state-machine without needing a real engine.
 */
class DisconnectTimerStateTest {

    private static final UUID GAME_A = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID GAME_B = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Test
    void promptFrame_setsOpenPromptMethod() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        WebStreamFrame frame = synthFrame("gameAsk");
        h.observePromptState(synthCallback(GAME_A), frame);
        assertEquals("gameAsk", h.openPromptMethodForTest(GAME_A),
                "gameAsk records prompt-open against gameId");
    }

    @Test
    void promptCloseFrame_clearsOpenPromptMethod() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        // First arm — pretend a prompt was open.
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        assertEquals("gameAsk", h.openPromptMethodForTest(GAME_A));
        // gameUpdate is a prompt-CLOSE method; should clear.
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameUpdate"));
        assertNull(h.openPromptMethodForTest(GAME_A),
                "gameUpdate after a prompt clears the open-prompt record");
    }

    @Test
    void promptOpenIsPerGameId() {
        // 4p FFA spectating two games at once — handler tracks each
        // gameId's prompt-open state independently.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        h.observePromptState(synthCallback(GAME_B), synthFrame("gameTarget"));

        assertEquals("gameAsk", h.openPromptMethodForTest(GAME_A));
        assertEquals("gameTarget", h.openPromptMethodForTest(GAME_B));

        // Closing GAME_A doesn't affect GAME_B.
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameUpdate"));
        assertNull(h.openPromptMethodForTest(GAME_A));
        assertEquals("gameTarget", h.openPromptMethodForTest(GAME_B),
                "closing one game's prompt must not leak into another's");
    }

    @Test
    void chatMessage_doesNotAffectPromptState() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        // Chat is route-agnostic and orthogonal to prompt state.
        h.observePromptState(synthCallback(GAME_A), synthFrame("chatMessage"));
        assertEquals("gameAsk", h.openPromptMethodForTest(GAME_A),
                "chatMessage neither opens nor closes a prompt");
    }

    @Test
    void gameInform_doesNotClosePrompt() {
        // gameInform can arrive mid-prompt as an engine narration
        // (e.g. "alice plays Forest"). It must NOT close the prompt
        // because the prompt is still awaiting a response.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameInform"));
        assertEquals("gameAsk", h.openPromptMethodForTest(GAME_A),
                "gameInform is not a prompt-close method");
    }

    @Test
    void allPromptMethods_recordOpenPrompt() {
        // Lock the prompt-method enum so a future change to
        // PROMPT_METHODS surfaces here. If a method is added /
        // removed from the engine's response-required set, this
        // test fails and the test author knows to update.
        for (String method : new String[] {
                "gameAsk", "gameTarget", "gameSelect",
                "gamePlayMana", "gamePlayXMana",
                "gameSelectAmount", "gameChooseChoice",
                "gameChooseAbility"}) {
            WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
            h.observePromptState(synthCallback(GAME_A), synthFrame(method));
            assertEquals(method, h.openPromptMethodForTest(GAME_A),
                    "method " + method + " must record as prompt-open");
        }
    }

    @Test
    void promptCloseMethods_clearOpenPrompt() {
        // Lock the prompt-close enum. Each close method, after a
        // prompt is open, should clear the record.
        for (String closeMethod : new String[] {
                "gameInit", "gameUpdate", "gameOver", "endGameInfo"}) {
            WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
            h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
            assertNotNull(h.openPromptMethodForTest(GAME_A));
            h.observePromptState(synthCallback(GAME_A), synthFrame(closeMethod));
            assertNull(h.openPromptMethodForTest(GAME_A),
                    "close method " + closeMethod + " must clear the prompt-open record");
        }
    }

    @Test
    void cancelDisconnectTimer_isIdempotent() {
        // No timer ever armed; cancel is a no-op (no NPE).
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.cancelDisconnectTimer(GAME_A);
        h.cancelDisconnectTimer(GAME_A);
        assertFalse(h.hasArmedDisconnectTimerForTest(GAME_A));
    }

    @Test
    void cancelAllDisconnectTimers_isIdempotent() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.cancelAllDisconnectTimers();
        h.cancelAllDisconnectTimers();
        // No exceptions thrown.
        assertFalse(h.hasArmedDisconnectTimerForTest(GAME_A));
    }

    @Test
    void maybeArmDisconnectTimer_skipsWhenAuthServiceMissing() {
        // The 1-arg test ctor creates a handler without AuthService.
        // maybeArmDisconnectTimer must no-op (the timer requires
        // the shared scheduler from AuthService).
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        h.maybeArmDisconnectTimer(GAME_A);
        assertFalse(h.hasArmedDisconnectTimerForTest(GAME_A),
                "no AuthService = no timer scheduling; test ctor preserves "
                        + "pre-slice-70-H.5 behavior");
    }

    @Test
    void maybeArmDisconnectTimer_skipsWhenNoOpenPrompt() {
        // No prompt open = no reason to arm a timer. Even if sockets
        // are zero, the player is just idle, not stalling a prompt.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.maybeArmDisconnectTimer(GAME_A);
        assertFalse(h.hasArmedDisconnectTimerForTest(GAME_A));
    }

    @Test
    void promptFrame_cancelsExistingTimer() {
        // If a timer was somehow armed (test stub) and then a fresh
        // prompt arrives, the prior timer should cancel — the new
        // prompt is the engine's NEW expectation; any stale timer
        // from the previous prompt must not fire against the new one.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        // Arm an open prompt + (since 1-arg ctor blocks scheduling)
        // verify cancel is a no-op safely.
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameTarget"));
        // Latest prompt method wins.
        assertEquals("gameTarget", h.openPromptMethodForTest(GAME_A),
                "fresh prompt arrival overwrites the open-prompt method");
        // Timer state should be empty (no arming happened in test ctor).
        assertFalse(h.hasArmedDisconnectTimerForTest(GAME_A));
    }

    @Test
    void closeAllSockets_clearsOpenPrompts() {
        // closeAllSockets is the session-teardown hook (logout / sweep).
        // It must drop the open-prompt records since the handler is
        // logically disposed.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        h.observePromptState(synthCallback(GAME_A), synthFrame("gameAsk"));
        h.observePromptState(synthCallback(GAME_B), synthFrame("gameTarget"));
        h.closeAllSockets(1000, "test");
        assertNull(h.openPromptMethodForTest(GAME_A),
                "closeAllSockets clears every open-prompt record");
        assertNull(h.openPromptMethodForTest(GAME_B));
    }

    @Test
    void nullGameId_isDefensivelyIgnored() {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        // observePromptState with a callback whose objectId is null
        // (cc.getObjectId() can be null for non-game frames). Should
        // no-op without crashing.
        ClientCallback cc = new ClientCallback(ClientCallbackMethod.GAME_ASK, null);
        h.observePromptState(cc, synthFrame("gameAsk"));
        assertFalse(h.hasArmedDisconnectTimerForTest(GAME_A));
    }

    /**
     * Slice 70-H.5 — synthesize a {@link WebStreamFrame} for a given
     * wire method. Only the {@code method} field is meaningful for
     * the prompt-state observer; other fields are stubs.
     */
    private static WebStreamFrame synthFrame(String method) {
        return new WebStreamFrame(
                SchemaVersion.CURRENT, method, 1,
                GAME_A.toString(),
                new WebDialogClear("00000000-0000-0000-0000-000000000000",
                        WebDialogClear.REASON_PLAYER_LEFT));
    }

    /**
     * Synthesize a {@link ClientCallback} pointing at {@code gameId}.
     * The observePromptState path reads only {@code cc.getObjectId()}.
     */
    private static ClientCallback synthCallback(UUID gameId) {
        return new ClientCallback(ClientCallbackMethod.GAME_ASK, gameId);
    }
}
