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
  /**
   * Sideboard entries (slice 33). Migration from store v1 defaults
   * this to {@code []} so older saves continue to load.
   */
  sideboard: WebDeckCardInfo[];
}

interface DeckUpdatePatch {
  name?: string;
  cards?: WebDeckCardInfo[];
  sideboard?: WebDeckCardInfo[];
}

interface DecksState {
  decks: SavedDeck[];
  add: (
    name: string,
    cards: WebDeckCardInfo[],
    sideboard?: WebDeckCardInfo[],
  ) => SavedDeck;
  /**
   * Patch an existing deck. Used by DeckEditor for qty +/-, delete,
   * art swap, and rename. No-op when the id doesn't match. Pass only
   * the fields that change — undefined fields preserve their current
   * value. {@code createdAt} stays put (rename / edit doesn't reset
   * the deck's identity-of-origin).
   */
  update: (id: string, patch: DeckUpdatePatch) => void;
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

      add: (name, cards, sideboard = []) => {
        const deck: SavedDeck = {
          id: uuid(),
          name: name.trim() || 'Untitled deck',
          createdAt: new Date().toISOString(),
          cards,
          sideboard,
        };
        set((s) => ({ decks: [deck, ...s.decks] }));
        return deck;
      },

      update: (id, patch) => {
        // Audit fix — early-return on no-op patch so callers that pass
        // {} (or only undefined fields) don't trigger a spurious
        // re-render with a new array identity. Prior behavior allocated
        // a new decks[] every call.
        if (
          patch.name === undefined
          && patch.cards === undefined
          && patch.sideboard === undefined
        ) {
          return;
        }
        set((s) => ({
          decks: s.decks.map((d) => {
            if (d.id !== id) return d;
            return {
              ...d,
              name: patch.name === undefined
                ? d.name
                : (patch.name.trim() || 'Untitled deck'),
              cards: patch.cards ?? d.cards,
              sideboard: patch.sideboard ?? d.sideboard,
            };
          }),
        }));
      },

      remove: (id) => set((s) => ({ decks: s.decks.filter((d) => d.id !== id) })),

      clear: () => set({ decks: [] }),
    }),
    {
      name: 'mage-decks',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Migration v1 → v2: backfill sideboard:[] on every existing deck.
      migrate: (persisted, version) => {
        if (!persisted || typeof persisted !== 'object') return persisted;
        if (version >= 2) return persisted as DecksState;
        const state = persisted as { decks?: Partial<SavedDeck>[] };
        const decks = (state.decks ?? []).map((d) => ({
          id: d.id ?? uuid(),
          name: d.name ?? 'Untitled deck',
          createdAt: d.createdAt ?? new Date().toISOString(),
          cards: d.cards ?? [],
          sideboard: d.sideboard ?? [],
        }));
        return { ...state, decks } as DecksState;
      },
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
    sideboard: deck.sideboard ?? [],
  };
}
