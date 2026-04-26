package mage.webapi.ws;

import mage.constants.PlayerAction;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Snapshot-locks the server-relevant subset of {@link PlayerAction}
 * that the WebSocket inbound {@code playerAction} handler accepts
 * (ADR 0007 D6). When upstream adds a new enum value, this test
 * fails so the include/exclude decision is deliberate.
 */
class PlayerActionAllowListTest {

    /**
     * The exact 40-name allow-list, sorted alphabetically. Adding or
     * removing an entry MUST be a deliberate decision — update both
     * this snapshot and {@link PlayerActionAllowList} together, and
     * bump the schema CHANGELOG.
     */
    private static final Set<String> EXPECTED = new TreeSet<>(Set.of(
            "ADD_PERMISSION_TO_ROLLBACK_TURN",
            "ADD_PERMISSION_TO_SEE_HAND_CARDS",
            "CONCEDE",
            "DENY_PERMISSION_TO_ROLLBACK_TURN",
            "HOLD_PRIORITY",
            "MANA_AUTO_PAYMENT_OFF",
            "MANA_AUTO_PAYMENT_ON",
            "MANA_AUTO_PAYMENT_RESTRICTED_OFF",
            "MANA_AUTO_PAYMENT_RESTRICTED_ON",
            "PASS_PRIORITY_CANCEL_ALL_ACTIONS",
            "PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN",
            "PASS_PRIORITY_UNTIL_MY_NEXT_TURN",
            "PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE",
            "PASS_PRIORITY_UNTIL_NEXT_TURN",
            "PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK",
            "PASS_PRIORITY_UNTIL_STACK_RESOLVED",
            "PASS_PRIORITY_UNTIL_TURN_END_STEP",
            "PERMISSION_REQUESTS_ALLOWED_OFF",
            "PERMISSION_REQUESTS_ALLOWED_ON",
            "REQUEST_AUTO_ANSWER_ID_NO",
            "REQUEST_AUTO_ANSWER_ID_YES",
            "REQUEST_AUTO_ANSWER_RESET_ALL",
            "REQUEST_AUTO_ANSWER_TEXT_NO",
            "REQUEST_AUTO_ANSWER_TEXT_YES",
            "REQUEST_PERMISSION_TO_ROLLBACK_TURN",
            "REQUEST_PERMISSION_TO_SEE_HAND_CARDS",
            "RESET_AUTO_SELECT_REPLACEMENT_EFFECTS",
            "REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS",
            "ROLLBACK_TURNS",
            "TRIGGER_AUTO_ORDER_ABILITY_FIRST",
            "TRIGGER_AUTO_ORDER_ABILITY_LAST",
            "TRIGGER_AUTO_ORDER_NAME_FIRST",
            "TRIGGER_AUTO_ORDER_NAME_LAST",
            "TRIGGER_AUTO_ORDER_RESET_ALL",
            "UNDO",
            "UNHOLD_PRIORITY",
            "USE_FIRST_MANA_ABILITY_OFF",
            "USE_FIRST_MANA_ABILITY_ON",
            "VIEW_LIMITED_DECK",
            "VIEW_SIDEBOARD"
    ));

    @Test
    void allowList_locksExactSet() {
        Set<String> actual = new TreeSet<>();
        for (PlayerAction a : PlayerActionAllowList.ALLOWED) {
            actual.add(a.name());
        }
        assertEquals(EXPECTED, actual,
                "PlayerActionAllowList drifted from the snapshot. "
                        + "Update both this test AND the CHANGELOG when adding "
                        + "or removing entries — slice 6 ships exactly 40.");
    }

    @Test
    void allowList_doesNotIncludeClientOnlyEnums() {
        // Sanity guard: every CLIENT_* and the debug toggle must NOT
        // be in the allow-list. The snapshot above already enforces
        // this implicitly, but a direct assertion is harder to
        // accidentally break.
        for (PlayerAction a : PlayerAction.values()) {
            String name = a.name();
            if (name.startsWith("CLIENT_") || name.equals("TOGGLE_RECORD_MACRO")) {
                assertFalse(PlayerActionAllowList.contains(a),
                        "client-only / debug enum leaked into allow-list: " + name);
            }
        }
    }

    @Test
    void allowList_includesAllPassPriorityModes() {
        for (PlayerAction a : PlayerAction.values()) {
            if (a.name().startsWith("PASS_PRIORITY_")) {
                assertTrue(PlayerActionAllowList.contains(a),
                        "PASS_PRIORITY mode missing from allow-list: " + a);
            }
        }
    }
}
