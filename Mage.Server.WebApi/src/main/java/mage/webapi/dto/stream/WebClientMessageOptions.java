package mage.webapi.dto.stream;

import java.util.List;

/**
 * Whitelisted projection of the upstream {@code GameClientMessage.options}
 * map onto the wire. Upstream uses a free-form
 * {@code Map<String, Serializable>} keyed by ad-hoc string constants —
 * forwarding it raw would expose internal engine state, lose Zod type
 * safety, and surface wire-instability whenever upstream renames a
 * key. We project to a closed record per ADR 0008 audit
 * (slice 17 substrate).
 *
 * <p>Five fields cover every {@code GameClientMessage}-shaped frame's
 * known consumers in 1v1 duel:
 *
 * <ul>
 *   <li>{@link #leftBtnText} / {@link #rightBtnText} — upstream
 *       {@code "UI.left.btn.text"} / {@code "UI.right.btn.text"}.
 *       Override the default Yes/No labels on {@code gameAsk} dialogs.
 *       Mulligan uses {@code "Mulligan"} / {@code "Keep"}; Proliferate
 *       and Time Travel use {@code "Done"}; etc.</li>
 *   <li>{@link #possibleAttackers} / {@link #possibleBlockers} —
 *       upstream {@code "POSSIBLE_ATTACKERS"} / {@code "POSSIBLE_BLOCKERS"}.
 *       UUID lists for combat — used by slice 20 (B1) to know which
 *       creatures the engine considers legal.</li>
 *   <li>{@link #specialButton} — upstream {@code "SPECIAL_BUTTON"}.
 *       Text for the "All attack" button during declare-attackers
 *       (slice 20).</li>
 * </ul>
 *
 * <p>All fields are always present; empty string / empty list signal
 * "upstream did not populate this key". The Zod schema on the
 * webclient relies on the fixed shape.
 *
 * <p>If upstream introduces a new key we want to forward, extend the
 * record + bump schema. Don't widen to a generic
 * {@code Map<String, ?>} — that's the loss-of-type-safety the audit
 * warned against.
 *
 * @param leftBtnText        override label for left/Yes button
 * @param rightBtnText       override label for right/No button
 * @param possibleAttackers  legal attacker permanent UUIDs (combat)
 * @param possibleBlockers   legal blocker permanent UUIDs (combat)
 * @param specialButton      text for the SPECIAL_BUTTON, e.g.
 *     "All attack" — empty when not applicable
 */
public record WebClientMessageOptions(
        String leftBtnText,
        String rightBtnText,
        List<String> possibleAttackers,
        List<String> possibleBlockers,
        String specialButton
) {

    /** Empty options instance — used when upstream's options map is null. */
    public static final WebClientMessageOptions EMPTY = new WebClientMessageOptions(
            "", "", List.of(), List.of(), ""
    );
}
