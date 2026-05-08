package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardLists;

/**
 * Bracket 1 Commander pool — vanilla creature pile, no anthems, no
 * engines, no synergy multipliers. Battlecruiser EDH feel.
 *
 * <p><b>Slice B status:</b> stub — delegates to {@link CommanderDecksHard}
 * so the dispatcher returns a buildable deck while the Easy spec is
 * being written. Slice C2 authors the per-color Easy decks inline and
 * replaces this delegation.
 *
 * <p>Until Slice C2 lands, "Easy" is observationally identical to
 * "Hard" — by design, so the difficulty plumbing can be exercised end-
 * to-end before the card-list edits ship.
 */
public final class CommanderDecksEasy implements CommanderDeckPool {

    private final CommanderDecksHard hardFallback = new CommanderDecksHard();

    @Override
    public DeckCardLists build(int rotationIdx) {
        return hardFallback.build(rotationIdx);
    }
}
