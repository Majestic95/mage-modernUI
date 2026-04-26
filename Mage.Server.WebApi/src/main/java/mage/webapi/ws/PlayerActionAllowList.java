package mage.webapi.ws;

import mage.constants.PlayerAction;

import java.util.EnumSet;
import java.util.Set;

/**
 * Static set of {@link PlayerAction} values the WebSocket inbound
 * {@code playerAction} handler accepts. Per ADR 0007 D6, the upstream
 * 59-value enum mixes truly-game-affecting actions with client-only
 * preferences (download symbols, exit-app, etc.); the latter must
 * never reach {@code MageServerImpl.sendPlayerAction} because their
 * upstream behavior assumes a Swing client is in the loop.
 *
 * <p>The allow-list is locked by a snapshot test; when upstream adds
 * a new enum value, the test fails so we make a deliberate
 * include / exclude decision rather than letting unknown enums slip
 * through silently.
 *
 * <p>Excluded categories:
 * <ul>
 *   <li>{@code CLIENT_*} — client-side UI state (download images,
 *       quit tournament, exit app, remove-table, reconnect,
 *       replay-action). The Swing client uses these for local
 *       handling; nothing the server needs to know.</li>
 *   <li>{@code TOGGLE_RECORD_MACRO} — debug-only feature.</li>
 * </ul>
 */
public final class PlayerActionAllowList {

    public static final Set<PlayerAction> ALLOWED = EnumSet.of(
            // Pass-priority modes (8)
            PlayerAction.PASS_PRIORITY_UNTIL_MY_NEXT_TURN,
            PlayerAction.PASS_PRIORITY_UNTIL_TURN_END_STEP,
            PlayerAction.PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE,
            PlayerAction.PASS_PRIORITY_UNTIL_NEXT_TURN,
            PlayerAction.PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK,
            PlayerAction.PASS_PRIORITY_UNTIL_STACK_RESOLVED,
            PlayerAction.PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN,
            PlayerAction.PASS_PRIORITY_CANCEL_ALL_ACTIONS,

            // Trigger ordering (5)
            PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_FIRST,
            PlayerAction.TRIGGER_AUTO_ORDER_NAME_FIRST,
            PlayerAction.TRIGGER_AUTO_ORDER_ABILITY_LAST,
            PlayerAction.TRIGGER_AUTO_ORDER_NAME_LAST,
            PlayerAction.TRIGGER_AUTO_ORDER_RESET_ALL,

            // Game lifecycle (3)
            PlayerAction.ROLLBACK_TURNS,
            PlayerAction.UNDO,
            PlayerAction.CONCEDE,

            // Mana auto-payment toggles (4)
            PlayerAction.MANA_AUTO_PAYMENT_ON,
            PlayerAction.MANA_AUTO_PAYMENT_OFF,
            PlayerAction.MANA_AUTO_PAYMENT_RESTRICTED_ON,
            PlayerAction.MANA_AUTO_PAYMENT_RESTRICTED_OFF,

            // First-mana-ability toggles (2)
            PlayerAction.USE_FIRST_MANA_ABILITY_ON,
            PlayerAction.USE_FIRST_MANA_ABILITY_OFF,

            // Replacement-effect auto-select reset (1)
            PlayerAction.RESET_AUTO_SELECT_REPLACEMENT_EFFECTS,

            // Hand-share / rollback social features (8)
            PlayerAction.REVOKE_PERMISSIONS_TO_SEE_HAND_CARDS,
            PlayerAction.REQUEST_PERMISSION_TO_SEE_HAND_CARDS,
            PlayerAction.REQUEST_PERMISSION_TO_ROLLBACK_TURN,
            PlayerAction.ADD_PERMISSION_TO_SEE_HAND_CARDS,
            PlayerAction.ADD_PERMISSION_TO_ROLLBACK_TURN,
            PlayerAction.DENY_PERMISSION_TO_ROLLBACK_TURN,
            PlayerAction.PERMISSION_REQUESTS_ALLOWED_ON,
            PlayerAction.PERMISSION_REQUESTS_ALLOWED_OFF,

            // Auto-answer toggles (5)
            PlayerAction.REQUEST_AUTO_ANSWER_ID_YES,
            PlayerAction.REQUEST_AUTO_ANSWER_ID_NO,
            PlayerAction.REQUEST_AUTO_ANSWER_TEXT_YES,
            PlayerAction.REQUEST_AUTO_ANSWER_TEXT_NO,
            PlayerAction.REQUEST_AUTO_ANSWER_RESET_ALL,

            // Priority hold (2)
            PlayerAction.HOLD_PRIORITY,
            PlayerAction.UNHOLD_PRIORITY,

            // Limited / sideboard view (2)
            PlayerAction.VIEW_LIMITED_DECK,
            PlayerAction.VIEW_SIDEBOARD
    );

    private PlayerActionAllowList() {
    }

    public static boolean contains(PlayerAction action) {
        return ALLOWED.contains(action);
    }
}
