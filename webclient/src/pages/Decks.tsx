/**
 * Slice DB-1a — the Decks page is now the deck-builder workbench
 * (lobby-themed full-page editor). The legacy paste-import form +
 * saved-list-with-Edit-button page is gone; its functionality moves
 * into the workbench's My Decks rail + New Deck modal + header.
 *
 * <p>Re-exports {@link DecksWorkbench} under the {@code Decks} name
 * so App.tsx's existing import path stays unchanged.
 */
export { DecksWorkbench as Decks } from './DecksWorkbench';
