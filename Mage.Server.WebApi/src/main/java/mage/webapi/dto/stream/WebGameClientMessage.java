package mage.webapi.dto.stream;

import java.util.List;
import java.util.Map;

/**
 * Wrapper around {@link WebGameView} + status string + dialog metadata.
 *
 * <p>Carried as the {@code data} payload for every {@code Game*} frame
 * whose upstream payload is {@code mage.view.GameClientMessage}:
 *
 * <ul>
 *   <li>{@code gameInform} — state change with feedback text (slice 5)</li>
 *   <li>{@code gameOver} — single game in the match has ended (slice 5)</li>
 *   <li>{@code gameAsk} — yes/no question (slice 6); answered with
 *       {@code playerResponse{kind:"boolean"}}</li>
 *   <li>{@code gameTarget} — pick from {@code cardsView1} respecting
 *       {@code targets}/{@code flag} (slice 6); answered with
 *       {@code playerResponse{kind:"uuid"}}</li>
 *   <li>{@code gameSelect} — pick a selectable (slice 6); answered
 *       with {@code playerResponse{kind:"uuid"}}</li>
 *   <li>{@code gamePlayMana} — mana payment dialog (slice 6); answered
 *       with {@code playerResponse{kind:"boolean"}}</li>
 *   <li>{@code gameSelectAmount} — pick an integer in
 *       {@code [min, max]} (slice 6); answered with
 *       {@code playerResponse{kind:"integer"}}</li>
 *   <li>{@code gameInformPersonal} — personal status text (slice 6);
 *       no response</li>
 *   <li>{@code gameError} — game-rules error text (slice 6); no
 *       response. Special case — upstream sends a bare String, not a
 *       GameClientMessage; the mapper synthesizes one with only
 *       {@code message} populated</li>
 *   <li>{@code gamePlayXMana} — X-mana payment prompt (slice 7);
 *       answered with {@code playerResponse{kind:"boolean"}} like
 *       {@code gamePlayMana}</li>
 *   <li>{@code gameChooseChoice} — modal-spell / replacement-effect
 *       picker (slice 7). The {@code choice} field carries the key→
 *       label map; answered with {@code playerResponse{kind:"string",
 *       value:<chosen-key>}}</li>
 * </ul>
 *
 * <p>Optional fields default to empty / 0 / false when the underlying
 * frame doesn't use them. The wire format always includes all fields
 * for shape stability — the webclient Zod schema needs a fixed shape.
 *
 * @param gameView    the snapshot at the moment of dispatch — null
 *     for {@code gameError} (text-only) and any other frame whose
 *     upstream payload doesn't carry a GameView
 * @param message     human-friendly status text; empty if upstream
 *     supplied none
 * @param targets     eligible target IDs for {@code gameTarget};
 *     empty list otherwise
 * @param cardsView1  card pile rendered as the picker UI for
 *     {@code gameTarget}; empty map otherwise
 * @param min         lower bound on {@code gameSelectAmount} input;
 *     0 otherwise
 * @param max         upper bound on {@code gameSelectAmount} input;
 *     0 otherwise
 * @param flag        upstream's "required" / boolean flag — for
 *     {@code gameTarget} this means the target is mandatory; false
 *     otherwise
 * @param choice      modal-choice payload for {@code gameChooseChoice};
 *     {@code null} for every other frame method
 */
public record WebGameClientMessage(
        WebGameView gameView,
        String message,
        List<String> targets,
        Map<String, WebCardView> cardsView1,
        int min,
        int max,
        boolean flag,
        WebChoice choice
) {
}
