/**
 * Saved decks store. Locally-persisted via Zustand; the WebApi has no
 * deck-storage service (per ADR 0006 D4) so decks live on the client
 * and are submitted at table-join time.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { WebDeckCardInfo, WebDeckCardLists } from '../api/schemas';

export interface SavedDeck {
  /** Client-generated UUID. */
  id: string;
  /** User-supplied display name. */
  name: string;
  /** ISO timestamp set on creation. */
  createdAt: string;
  /** Mainboard entries already resolved to set+number per ADR 0006 D4. */
  cards: WebDeckCardInfo[];
}

interface DecksState {
  decks: SavedDeck[];
  add: (name: string, cards: WebDeckCardInfo[]) => SavedDeck;
  remove: (id: string) => void;
  /** Reset the entire list (testing convenience). */
  clear: () => void;
}

function uuid(): string {
  // crypto.randomUUID is available in jsdom + every modern browser.
  return crypto.randomUUID();
}

export const useDecksStore = create<DecksState>()(
  persist(
    (set) => ({
      decks: [],

      add: (name, cards) => {
        const deck: SavedDeck = {
          id: uuid(),
          name: name.trim() || 'Untitled deck',
          createdAt: new Date().toISOString(),
          cards,
        };
        set((s) => ({ decks: [deck, ...s.decks] }));
        return deck;
      },

      remove: (id) => set((s) => ({ decks: s.decks.filter((d) => d.id !== id) })),

      clear: () => set({ decks: [] }),
    }),
    {
      name: 'mage-decks',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * Build a {@link WebDeckCardLists} request body from a saved deck.
 * The wire format is the JSON shape the WebApi expects on /join.
 */
export function toRequestBody(deck: SavedDeck, author: string): WebDeckCardLists {
  return {
    name: deck.name,
    author,
    cards: deck.cards,
    sideboard: [],
  };
}
