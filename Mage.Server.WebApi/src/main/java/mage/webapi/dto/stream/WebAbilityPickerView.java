package mage.webapi.dto.stream;

import java.util.Map;

/**
 * Carries the {@code data} payload of {@code gameChooseAbility}
 * frames. Mirrors upstream {@code mage.view.AbilityPickerView} —
 * three fields, no further nesting.
 *
 * <p>Fires when a permanent has multiple activated abilities to pick
 * from (most cards with two abilities) and when picking a modal
 * spell's mode (the {@code chooseMode} path is funneled through
 * {@code GameController}'s switch into the same {@code chooseAbility}
 * dispatch). The player picks a UUID / mode key; the response goes
 * back as {@code playerResponse{kind:"uuid", value: <chosen-id>}}.
 *
 * <p>Triggered ability ordering is a SEPARATE path despite the
 * shared semantics — see ADR 0009. Trigger ordering arrives on
 * {@code gameTarget} (via {@code QueryType.PICK_ABILITY}), not here.
 * ADR 0008 §1.29 misattributed it to this frame; ADR 0009 corrects.
 *
 * <p>Distinct from the {@link WebGameClientMessage} wrapper because
 * upstream's {@code AbilityPickerView} is a separate class (not a
 * {@code GameClientMessage}); the wire format reflects that. The
 * webclient {@code PendingDialog} type discriminates on
 * {@code method == 'gameChooseAbility'} to know it's getting this
 * shape rather than {@link WebGameClientMessage}.
 *
 * @param gameView the snapshot at the moment of dispatch — non-null;
 *     upstream populates the embedded view in every constructor
 * @param message  prompt text ("Choose spell or ability to play")
 * @param choices  ability UUID → display label. Insertion-ordered;
 *     mapped from upstream's {@code LinkedHashMap<UUID, String>}
 *     traversal so the renderer gets a stable list order.
 */
public record WebAbilityPickerView(
        WebGameView gameView,
        String message,
        Map<String, String> choices
) {
}
