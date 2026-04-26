package mage.webapi.dto.stream;

import java.util.Map;

/**
 * Carries the {@code data} payload of {@code gameChooseAbility}
 * frames. Mirrors upstream {@code mage.view.AbilityPickerView} —
 * three fields, no further nesting.
 *
 * <p>Fires when a permanent has multiple activated abilities to pick
 * from (most cards with two abilities), or when ordering a stack of
 * simultaneously-fired triggers ({@code chooseTriggeredAbility}). The
 * player picks an ability UUID; the response goes back as
 * {@code playerResponse{kind:"uuid", value: <chosen-id>}}.
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
