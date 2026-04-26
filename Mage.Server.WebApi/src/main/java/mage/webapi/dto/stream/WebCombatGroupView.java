package mage.webapi.dto.stream;

import java.util.Map;

/**
 * One attacker → defender combat group, with any blockers attached.
 * Mirrors upstream {@code mage.view.CombatGroupView} (72 LOC).
 *
 * <p>The defender is either a player or a planeswalker permanent;
 * upstream resolves the display name in either case via
 * {@code defenderName}.
 *
 * @param defenderId   UUID of the attack target — player or
 *     planeswalker; empty if upstream had none
 * @param defenderName display name resolved by upstream (player name
 *     or permanent name)
 * @param attackers    permanents attacking this defender, keyed by
 *     UUID. Order is upstream-traversal-stable.
 * @param blockers     permanents blocking; empty when {@code blocked}
 *     is false
 * @param blocked      whether at least one legal blocker has been
 *     declared
 */
public record WebCombatGroupView(
        String defenderId,
        String defenderName,
        Map<String, WebPermanentView> attackers,
        Map<String, WebPermanentView> blockers,
        boolean blocked
) {
}
