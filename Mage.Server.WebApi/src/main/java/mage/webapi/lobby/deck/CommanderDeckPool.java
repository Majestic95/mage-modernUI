package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardLists;

/**
 * One difficulty tier's worth of mono-color Commander decks. Three
 * implementations: {@link CommanderDecksHard}, {@link CommanderDecksMedium},
 * and {@link CommanderDecksEasy}. Each owns the per-color card lists for
 * its tier and exposes a uniform {@link #build(int)} method that the
 * dispatcher in {@code AiDeckLibrary} calls with a rotation index in
 * {@code [0, 5)} (W=0, U=1, B=2, R=3, G=4).
 *
 * <p>Stateless on purpose — instantiated per dispatch so simulation
 * cloning is automatic and helper state can never leak between
 * unrelated AI fills.
 */
public interface CommanderDeckPool {

    /**
     * @param rotationIdx 0=White, 1=Blue, 2=Black, 3=Red, 4=Green
     * @return a 99-mainboard, 1-sideboard Commander deck for the given color
     */
    DeckCardLists build(int rotationIdx);
}
