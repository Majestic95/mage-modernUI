package mage.webapi.dto.stream;

import java.util.List;

/**
 * Slice 70-X.14 Wave 3 (schema 1.25) — wire payload for
 * {@code gameSelectMultiAmount}. Distribute amount X across N labeled
 * rows, with per-row min/max/default constraints AND a total-sum
 * constraint.
 *
 * <p>Concrete uses (verified against
 * {@code mage/util/MultiAmountMessage.java} + {@code CombatGroup.java}
 * + {@code HumanPlayer.java:2161+}):
 *
 * <ul>
 *   <li><b>Trample damage assignment</b> — N+1 rows (N blockers + the
 *     defending player). {@code totalMin = sum-of-lethals} (CR 702.19b
 *     enforced via total, not per-row); {@code totalMax = damage}.
 *     Each row's {@code defaultValue} pre-encodes lethal-per-blocker
 *     (with deathtouch → 1, CR 702.2c).</li>
 *   <li><b>Counter removal</b> — distribute counter removals across
 *     multiple permanents (Hex Parasite, Power Conduit).</li>
 *   <li><b>Mana allocation</b> — split mana across colors when the
 *     engine offers a {@code Choice} of "any combination of {C}{U}{R}"
 *     etc.</li>
 * </ul>
 *
 * <p>UI must initialize each input to {@code defaultValue} (engine
 * pre-computes lethal-per-blocker for the trample case). Submitting
 * a sum below {@code totalMin} or above {@code totalMax} re-prompts.
 *
 * <p>Response shape: {@code playerResponse{kind:"string", value:"3,2,1"}}
 * — comma-separated integers in row order.
 */
public record WebMultiAmountInfo(
        /**
         * Optional banner title — distinguishes "Assign combat damage"
         * vs "Remove counters" vs "Distribute mana" so the user knows
         * what they're allocating without reading every row label.
         * Sourced from upstream's {@code MultiAmountType.title} via
         * {@code HumanPlayer.fireGetMultiAmountEvent} options. Empty
         * string when upstream supplied none.
         */
        String title,
        /**
         * Optional banner header / subtitle. Same source as
         * {@code title}. Empty string when absent.
         */
        String header,
        /** Per-row constraints, in display + response order. */
        List<WebMultiAmountRow> rows,
        /** Inclusive lower bound on the sum of all rows' values. */
        int totalMin,
        /** Inclusive upper bound on the sum of all rows' values. */
        int totalMax
) {
    public static final WebMultiAmountInfo EMPTY = new WebMultiAmountInfo(
            "", "", List.of(), 0, 0
    );
}
