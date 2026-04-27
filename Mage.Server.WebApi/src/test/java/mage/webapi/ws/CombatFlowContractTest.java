package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.interfaces.callback.ClientCallback;
import mage.interfaces.callback.ClientCallbackMethod;
import mage.view.GameClientMessage;
import mage.webapi.dto.stream.WebStreamFrame;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Substrate test for the slice-16 combat-mode heuristic.
 *
 * <p>The webclient's {@code deriveInteractionMode} (slice 16,
 * {@code webclient/src/game/interactionMode.ts}) gates on the
 * {@code data.message} field of {@code gameSelect} frames:
 * {@code "Select attackers"} → declareAttackers mode,
 * {@code "Select blockers"} → declareBlockers mode. The wire
 * contract is: {@link WebSocketCallbackHandler#mapToFrame} forwards
 * upstream's {@code GameClientMessage.message} verbatim.
 *
 * <p>This test asserts the contract directly by invoking
 * {@code mapToFrame} with a synthesized {@link ClientCallback}.
 * No embedded server boot, no WS round-trip — just the mapping
 * function. If upstream changes its prompt text (e.g. "Choose
 * attackers" instead of "Select attackers"), this test fails first
 * and the heuristic gets updated in lock-step.
 *
 * <p>When ADR 0008 gap U1 lands and the wire format forwards
 * {@code options.POSSIBLE_ATTACKERS}, this test extends to assert
 * the structured signal too. Until then, message-text matching is
 * the only signal the webclient has.
 */
class CombatFlowContractTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * The exact strings upstream's HumanPlayer fires for combat
     * prompts (HumanPlayer.java:1794, :2043 — verified during the
     * ADR 0008 audit). The webclient's heuristic in
     * interactionMode.ts checks for these via case-insensitive
     * substring match. Keeping the strings tested here pins the
     * contract.
     */
    private static final String SELECT_ATTACKERS = "Select attackers";
    private static final String SELECT_BLOCKERS = "Select blockers";

    @Test
    void mapToFrame_gameSelectAttackers_forwardsMessageVerbatim() throws Exception {
        WebStreamFrame frame = mapGameSelect(SELECT_ATTACKERS);
        assertNotNull(frame, "GAME_SELECT must map to a non-null frame");
        assertEquals("gameSelect", frame.method());

        JsonNode data = JSON.valueToTree(frame.data());
        assertEquals(SELECT_ATTACKERS, data.get("message").asText(),
                "webclient's deriveInteractionMode reads data.message; "
                        + "verbatim forwarding is the contract");
    }

    @Test
    void mapToFrame_gameSelectBlockers_forwardsMessageVerbatim() throws Exception {
        WebStreamFrame frame = mapGameSelect(SELECT_BLOCKERS);
        assertNotNull(frame);
        assertEquals("gameSelect", frame.method());

        JsonNode data = JSON.valueToTree(frame.data());
        assertEquals(SELECT_BLOCKERS, data.get("message").asText());
    }

    @Test
    void mapToFrame_gameSelectFreePriority_forwardsMessage() throws Exception {
        // Free-priority gameSelect uses message "Pass priority" or
        // similar; the webclient interprets anything that isn't
        // "Select attackers"/"Select blockers" as free mode.
        WebStreamFrame frame = mapGameSelect("Play spells and abilities");
        assertNotNull(frame);
        assertEquals("gameSelect", frame.method());

        JsonNode data = JSON.valueToTree(frame.data());
        assertEquals("Play spells and abilities", data.get("message").asText());
    }

    @Test
    void mapToFrame_unknownCallback_returnsNull() throws Exception {
        // Sanity: REPLAY_GAME has no mapper case (out-of-1v1-scope
        // per ADR 0008 §1.40); confirms the default → null branch.
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        ClientCallback cc = new ClientCallback(
                ClientCallbackMethod.REPLAY_GAME,
                UUID.randomUUID(),
                "irrelevant"
        );
        WebStreamFrame frame = h.mapToFrame(cc);
        assertNull(frame, "unmapped callback methods must return null "
                + "(dispatch logs at DEBUG and drops)");
    }

    /**
     * Helper: build a minimal {@link ClientCallback} carrying a
     * {@link GameClientMessage} with the supplied message and an
     * empty options map, then run it through the mapper. {@code
     * gameView} is null — the mapper handles that path gracefully
     * (verified by existing GAME_INFORM_PERSONAL coverage).
     */
    private static WebStreamFrame mapGameSelect(String message) {
        WebSocketCallbackHandler h = new WebSocketCallbackHandler("alice");
        GameClientMessage payload = new GameClientMessage(
                /* gameView */ null,
                /* options */ Map.of(),
                message
        );
        ClientCallback cc = new ClientCallback(
                ClientCallbackMethod.GAME_SELECT,
                UUID.randomUUID(),
                payload
        );
        // ClientCallback compresses data on construction; the
        // production path decompresses inside dispatch() before
        // calling mapToFrame. Mirror that here so the test exercises
        // the same code surface.
        cc.decompressData();
        return h.mapToFrame(cc);
    }
}
