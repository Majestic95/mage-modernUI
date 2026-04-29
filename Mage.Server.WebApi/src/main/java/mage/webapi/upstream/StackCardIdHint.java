package mage.webapi.upstream;

import mage.game.Game;
import mage.game.stack.Spell;
import mage.game.stack.StackObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Build the SpellAbility-UUID → underlying-Card-UUID map used to
 * populate {@code WebCardView.cardId} for stack entries.
 *
 * <p><b>Why this matters:</b> for every zone except the stack, the
 * {@code CardView.getId()} the WebApi mapper sees is already the
 * underlying {@code Card.getId()} (stable across zones). On the
 * stack, however, upstream constructs the {@code CardView} from a
 * {@link Spell} where {@code Spell.getId() == SpellAbility.getId()}
 * (a fresh UUID minted at cast time) — the link back to the
 * physical card UUID is {@code Spell.getCard().getId()}. By the time
 * the mapper sees the {@code CardView} the {@code Spell} reference
 * is already gone, so we recover it directly from
 * {@code Game.getStack()}.
 *
 * <p>For non-{@link Spell} stack objects (e.g. {@code StackAbility}
 * for triggered abilities), no entry is added; the caller falls back
 * to {@code cv.getId()} which is fine because triggered abilities
 * don't participate in cross-zone animation (they aren't physical
 * cards).
 */
public final class StackCardIdHint {

    private static final Logger LOG = LoggerFactory.getLogger(StackCardIdHint.class);

    private StackCardIdHint() {
    }

    /**
     * Snapshot the current stack and produce a hint map mapping each
     * {@link Spell}'s {@code SpellAbility} UUID (the wire-format key)
     * to the underlying {@code Card} UUID.
     *
     * <p>Returns an empty map when {@code game} is null, the stack is
     * empty, or iteration throws (the engine could be mid-mutation
     * since this is read off-thread). Defensive: a hint failure only
     * costs cross-zone animation polish — it must never propagate to
     * the engine callback path.
     */
    public static Map<UUID, UUID> extract(Game game) {
        if (game == null) {
            return Map.of();
        }
        try {
            var stack = game.getStack();
            if (stack == null || stack.isEmpty()) {
                return Map.of();
            }
            Map<UUID, UUID> out = new HashMap<>(stack.size());
            for (StackObject so : stack) {
                if (so instanceof Spell spell) {
                    UUID abilityId = spell.getId();
                    var card = spell.getCard();
                    if (abilityId != null && card != null && card.getId() != null) {
                        out.put(abilityId, card.getId());
                    }
                }
                // StackAbility (triggered/activated) intentionally skipped —
                // not a physical card, no cross-zone animation target.
            }
            return out.isEmpty() ? Map.of() : out;
        } catch (RuntimeException ex) {
            // Engine mid-mutation, concurrent stack modification, etc.
            // Better to drop the animation hint than to crash a frame.
            LOG.debug("StackCardIdHint.extract failed; returning empty hint: {}",
                    ex.toString());
            return Map.of();
        }
    }
}
