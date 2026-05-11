package mage.webapi.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import mage.constants.PlayerAction;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Unit tests for {@code GameStreamHandler.decodeActionData} — the
 * per-action {@code playerAction.data} shape resolver. Slice 27
 * (ADR 0009) added the four {@code TRIGGER_AUTO_ORDER_*_FIRST/_LAST}
 * cases; these tests lock the contract.
 */
class GameStreamHandlerDecodeTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static JsonNode parse(String json) throws Exception {
        return JSON.readTree(json);
    }

    @Test
    void rollbackTurns_objectShape_returnsInt() throws Exception {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.ROLLBACK_TURNS,
                parse("{\"turns\": 3}"));
        assertEquals(3, out);
    }

    @Test
    void triggerAutoOrderAbilityFirst_objectShape_returnsUuid() throws Exception {
        UUID id = UUID.fromString("11111111-1111-1111-1111-111111111111");
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_FIRST,
                parse("{\"abilityId\":\"" + id + "\"}"));
        assertEquals(id, out);
    }

    @Test
    void triggerAutoOrderAbilityLast_objectShape_returnsUuid() throws Exception {
        UUID id = UUID.fromString("22222222-2222-2222-2222-222222222222");
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_LAST,
                parse("{\"abilityId\":\"" + id + "\"}"));
        assertEquals(id, out);
    }

    @Test
    void triggerAutoOrderAbility_malformedUuid_returnsNull() throws Exception {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_FIRST,
                parse("{\"abilityId\":\"not-a-uuid\"}"));
        assertNull(out);
    }

    @Test
    void triggerAutoOrderNameFirst_objectShape_returnsRuleText() throws Exception {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_NAME_FIRST,
                parse("{\"ruleText\":\"When Soul Warden enters, you gain 1 life.\"}"));
        assertEquals("When Soul Warden enters, you gain 1 life.", out);
    }

    @Test
    void triggerAutoOrderNameLast_objectShape_returnsRuleText() throws Exception {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_NAME_LAST,
                parse("{\"ruleText\":\"trigger\"}"));
        assertEquals("trigger", out);
    }

    @Test
    void triggerAutoOrderResetAll_returnsNull() throws Exception {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_RESET_ALL,
                parse("null"));
        assertNull(out);
    }

    @Test
    void unrelatedAction_alwaysReturnsNull() throws Exception {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.CONCEDE,
                parse("{\"abilityId\":\"11111111-1111-1111-1111-111111111111\"}"));
        assertNull(out);
    }

    @Test
    void nullDataNode_returnsNull() {
        Object out = GameStreamHandler.decodeActionData(
                PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_FIRST, null);
        assertNull(out);
    }

    // -------------------------------------------------------------
    // parsePlayerResponseUuidOrSkip — Scry/Surveil Skip contract.
    // -------------------------------------------------------------
    //
    // The webclient encodes "skip / done with no selection" on
    // playerResponse{kind:"uuid"} as the all-zeros UUID, because the
    // wire schema rejects JSON null. The engine's chooseTarget /
    // choose loops terminate only on responseId == null. This helper
    // is the bridge — pin its contract so any future refactor that
    // accidentally removes the sentinel-to-null translation fails
    // loud here. Sister test on the webclient side
    // (SelectDialog.test.tsx) locks the encoding contract.

    @Test
    void parsePlayerResponseUuidOrSkip_allZerosSentinel_returnsNull() {
        UUID out = GameStreamHandler.parsePlayerResponseUuidOrSkip(
                "00000000-0000-0000-0000-000000000000");
        assertNull(out, "all-zeros sentinel must map to null so the "
                + "engine's chooseTarget loop terminates the prompt "
                + "(scry/surveil Skip flow)");
    }

    @Test
    void parsePlayerResponseUuidOrSkip_realUuid_returnsParsedUuid() {
        UUID expected = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID out = GameStreamHandler.parsePlayerResponseUuidOrSkip(
                expected.toString());
        assertEquals(expected, out);
    }

    @Test
    void parsePlayerResponseUuidOrSkip_malformed_throwsIllegalArgument() {
        // Caller turns IllegalArgumentException into BAD_REQUEST; the
        // existing malformed-UUID test in GameStreamHandlerTest pins
        // that outer contract. Here we just lock the helper's behavior.
        assertThrows(
                IllegalArgumentException.class,
                () -> GameStreamHandler.parsePlayerResponseUuidOrSkip(
                        "definitely-not-a-uuid"));
    }
}
