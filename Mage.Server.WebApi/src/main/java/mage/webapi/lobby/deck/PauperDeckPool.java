package mage.webapi.lobby.deck;

import mage.cards.decks.DeckCardLists;

/**
 * One difficulty tier's worth of Pauper AI fallback decks. Each
 * implementation owns 10 distinct AI-friendly archetypes and exposes
 * a uniform {@link #build(int)} method that the dispatcher in
 * {@link mage.webapi.lobby.AiDeckLibrary} calls with a rotation index
 * in {@code [0, 10)}.
 *
 * <p>Stateless on purpose — instantiated per dispatch so simulation
 * cloning is automatic. Mirrors {@link CommanderDeckPool}.
 */
public interface PauperDeckPool {
    /**
     * @param rotationIdx 0-9, predictably rotated by AiDeckLibrary
     * @return a 60-card mainboard, 0-sideboard Pauper-legal deck
     */
    DeckCardLists build(int rotationIdx);
}
