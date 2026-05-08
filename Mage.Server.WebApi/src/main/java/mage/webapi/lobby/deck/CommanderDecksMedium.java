package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardLists;

/**
 * Bracket 2-3 Commander pool. Spec lives at
 * {@code docs/decisions/ai-commander-rebalance-2026-05.md}.
 *
 * <p><b>Slice B status:</b> stub — delegates to {@link CommanderDecksHard}
 * so the dispatcher returns a buildable deck while the rebalance is
 * staged. Slice C populates this class with the per-color decks
 * authored by the spec (one global anthem per deck, no exponential
 * snowball engines, no board-locking finishers, no Bracket 4 game-
 * enders).
 *
 * <p>Until Slice C lands, "Medium" is observationally identical to
 * "Hard" — by design, so the difficulty plumbing can be exercised end-
 * to-end before the card-list edits ship.
 */
public final class CommanderDecksMedium implements CommanderDeckPool {

    private final CommanderDecksHard hardFallback = new CommanderDecksHard();

    @Override
    public DeckCardLists build(int rotationIdx) {
        return hardFallback.build(rotationIdx);
    }
}
