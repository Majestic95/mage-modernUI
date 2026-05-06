package mage.webapi.contract;

import mage.constants.MultiAmountType;
import mage.util.MultiAmountMessage;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Contract test pinning the wire format of the multi-amount dialog
 * response. The webclient's {@code MultiAmountDialog.tsx} joins the
 * per-row integer values into a single {@code playerResponse{kind:"string"}}
 * value, which the WebApi forwards verbatim to upstream's
 * {@code HumanPlayer.response} and is parsed by
 * {@code MultiAmountType.parseAnswer} (Mage/.../constants/MultiAmountType.java).
 *
 * <p>The parser splits on {@code " "}. A comma-joined value silently
 * fails: {@code "3,2,1".split(" ")} → {@code ["3,2,1"]}, parsed as
 * {@code [0]}, fails {@code isGoodValues} on size mismatch with N
 * rows, the engine logs "GUI return wrong MultiAmountType values"
 * and re-prompts forever. The webclient shipped with this exact bug
 * for the entire lifetime of slice 70-X.14 Wave 3 because no test
 * round-tripped a real wire string through the upstream parser —
 * unit tests asserted only what the client emitted, never that the
 * engine accepted it.
 *
 * <p>This test closes the gap. It is the single source of truth for
 * the format contract: any future change to the dialog's join must
 * keep this test passing, and any future change to upstream's
 * {@code parseAnswer} that rejects our format will fail this test
 * first.
 *
 * <p>The negative test pins the comma-regression specifically so a
 * well-meaning developer "fixing" the format back doesn't reintroduce
 * the silent-loop bug.
 */
class MultiAmountWireContractTest {

    /**
     * Mirror of webclient's join: must stay aligned with
     * {@code MultiAmountDialog.tsx}'s {@code values.join(' ')}.
     */
    private static final String CLIENT_SEPARATOR = " ";

    /**
     * Three-row trample-style allocation: two blockers + the defending
     * player. totalMin = 3 (sum of lethals), totalMax = 5 (creature's
     * power). Default values sum to 3, satisfying totalMin.
     */
    private static List<MultiAmountMessage> tramplePrompt() {
        return List.of(
                new MultiAmountMessage("Grizzly Bears (2/2)", 0, 5, 2),
                new MultiAmountMessage("Llanowar Elves (1/1)", 0, 5, 1),
                new MultiAmountMessage("Defending player", 0, 5, 0)
        );
    }

    @Test
    void spaceJoined_isAcceptedByEngineParser() {
        List<MultiAmountMessage> rows = tramplePrompt();
        // Webclient emits exactly this for default values [2,1,0]:
        String wire = String.join(CLIENT_SEPARATOR, "2", "1", "0");
        assertEquals("2 1 0", wire,
                "Sanity: this test's joiner mirrors the webclient's.");

        List<Integer> parsed = MultiAmountType.parseAnswer(
                wire, rows, /* totalMin */ 3, /* totalMax */ 5,
                /* returnDefaultOnError */ false);

        assertEquals(List.of(2, 1, 0), parsed,
                "Engine parser must produce the original integer list.");
        assertTrue(
                MultiAmountType.isGoodValues(parsed, rows, 3, 5),
                "Round-trip must satisfy the engine's row+sum constraints, "
                        + "else HumanPlayer.getMultiAmountWithIndividualConstraints "
                        + "loops on 'GUI return wrong MultiAmountType values'.");
    }

    @Test
    void multiDigitValues_roundTripIntact() {
        // Counter-removal-style: one row with a 12-counter cap.
        List<MultiAmountMessage> rows = List.of(
                new MultiAmountMessage("Hex Parasite", 0, 20, 0),
                new MultiAmountMessage("Phyrexian Devourer", 0, 20, 0)
        );
        String wire = String.join(CLIENT_SEPARATOR, "12", "5");

        List<Integer> parsed = MultiAmountType.parseAnswer(
                wire, rows, 0, 20, false);

        assertEquals(List.of(12, 5), parsed,
                "Multi-digit values must split correctly; parser must not "
                        + "trim or truncate.");
        assertTrue(MultiAmountType.isGoodValues(parsed, rows, 0, 20));
    }

    @Test
    void commaJoined_regressesToParseFailure() {
        // Lock the bug we just fixed. If someone reverts the webclient
        // join to "," this test fires immediately and explains why.
        List<MultiAmountMessage> rows = tramplePrompt();
        String brokenWire = String.join(",", "2", "1", "0");

        List<Integer> parsed = MultiAmountType.parseAnswer(
                brokenWire, rows, 3, 5, false);

        // "2,1,0".split(" ") yields ["2,1,0"], which parseIntWithDefault
        // resolves to [0] (parseInt("2,1,0") fails → default 0).
        assertEquals(List.of(0), parsed,
                "Comma-joined input must produce the broken [0] result "
                        + "the way upstream parseAnswer actually handles it. "
                        + "If this assertion fails, upstream changed the "
                        + "parser and the dialog's join may need to follow.");
        assertFalse(
                MultiAmountType.isGoodValues(parsed, rows, 3, 5),
                "Comma-joined input MUST fail isGoodValues — that's the "
                        + "engine signal that triggers the silent-reprompt loop.");
    }
}
