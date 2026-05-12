/**
 * Visual deck editor. Opens a saved deck for inline editing:
 *
 * <ul>
 *   <li>Mainboard cards grouped by type (Commander → Creatures →
 *       Planeswalkers → Spells → Artifacts → Enchantments → Lands →
 *       Other), each group sorted by mana value then name.</li>
 *   <li>Per-card qty +/- and delete affordances.</li>
 *   <li>Per-card "swap art" button opens {@link ArtPickerModal}; the
 *       chosen setCode + cardNumber write back to the saved deck
 *       and propagate end-to-end (saved deck → seat preview →
 *       in-game card render — the wire emits the same
 *       expansionSetCode + cardNumber the engine instantiated from).</li>
 *   <li>Inline rename of the deck name.</li>
 *   <li>Sideboard rendered as a separate section below mainboard.</li>
 * </ul>
 *
 * <p>All mutations auto-save to the localStorage-backed Zustand store —
 * matches the existing "no explicit save button" convention.
 *
 * <p>Slice DB-0 (2026-05-12) — DeckLane / CardRow / pure helpers
 * extracted into sibling files to drop this file below the soft cap
 * before the lobby-themed workbench reskin (DB-1).
 */
import { useEffect, useState } from 'react';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { ArtPickerModal } from '../decks/ArtPickerModal';
import { CardSearchPanel } from '../decks/CardSearchPanel';
import { useDeckCardData } from '../decks/useDeckCardData';
import { useDecksStore } from '../decks/store';
import { DeckLane } from './DeckLane';
import { totalAmount, type Lane } from './deckEditorHelpers';
import { LobbyPortraitSummary } from './LobbyPortraitSummary';

interface Props {
  deckId: string;
  onClose: () => void;
}

export function DeckEditor({ deckId, onClose }: Props) {
  const deck = useDecksStore((s) =>
    s.decks.find((d) => d.id === deckId) ?? null,
  );
  const updateDeck = useDecksStore((s) => s.update);
  const { byName, loading } = useDeckCardData(deck);

  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  // Audit fix (HIGH #5 + #4) — store the entry's CONTENT (cardName +
  // setCode + cardNumber), not its array index, in the picker state.
  // Index goes stale across cross-tab mutations and after qty=0 filter
  // shifts indices; targeting by content survives both.
  const [artPicker, setArtPicker] = useState<
    | {
        lane: Lane;
        cardName: string;
        setCode: string;
        cardNumber: string;
        // Optimistic-revert target for swapArt failure surfaces.
        previousAmount: number;
      }
    | null
  >(null);

  // Audit fix — cross-tab delete: if the deck disappears while we're
  // editing it, route back to the list automatically. Without this the
  // editor sat on "Deck not found" until the user clicked Back.
  useEffect(() => {
    if (!deck) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck === null]);

  if (!deck) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-zinc-400 hover:text-zinc-100"
        >
          ← Back to decks
        </button>
        <p className="text-zinc-500 italic">Deck not found.</p>
      </div>
    );
  }

  const commitName = () => {
    if (renameDraft === null) return;
    updateDeck(deck.id, { name: renameDraft });
    setRenameDraft(null);
  };

  // Audit fix (HIGH #5) — read fresh state via getState so cross-tab
  // mutations don't get clobbered. Find the entry by content (cardName
  // + setCode + cardNumber) instead of by array index — index is fragile
  // because a prior qty=0 filter or a cross-tab delete shifts indices
  // out from under us.
  const setQty = (
    lane: Lane,
    cardName: string,
    setCode: string,
    cardNumber: string,
    nextAmount: number,
  ) => {
    const fresh = useDecksStore.getState().decks.find((d) => d.id === deck.id);
    if (!fresh) return;
    const list = lane === 'cards' ? fresh.cards : fresh.sideboard;
    // Audit fix — guard against stranding the Commander. In the
    // sideboard's slot 0 (Commander format convention), refuse to
    // delete to 0 — the user can still swap art / replace the entry
    // outright via Option-1 search (when shipped). For now just block
    // the destructive path.
    const isCommanderSlot =
      lane === 'sideboard'
      && list[0]?.cardName === cardName
      && list[0]?.setCode === setCode
      && list[0]?.cardNumber === cardNumber;
    const minAmount = isCommanderSlot ? 1 : 0;
    const clamped = Math.max(minAmount, nextAmount);
    const updated = list
      .map((c) =>
        c.cardName === cardName
        && c.setCode === setCode
        && c.cardNumber === cardNumber
          ? { ...c, amount: clamped }
          : c,
      )
      .filter((c) => c.amount > 0);
    updateDeck(deck.id, { [lane]: updated });
  };

  const swapArt = (
    lane: Lane,
    cardName: string,
    fromSetCode: string,
    fromCardNumber: string,
    toSetCode: string,
    toCardNumber: string,
  ) => {
    const fresh = useDecksStore.getState().decks.find((d) => d.id === deck.id);
    if (!fresh) return;
    const list = lane === 'cards' ? fresh.cards : fresh.sideboard;
    const updated = list.map((c) =>
      c.cardName === cardName
      && c.setCode === fromSetCode
      && c.cardNumber === fromCardNumber
        ? { ...c, setCode: toSetCode, cardNumber: toCardNumber }
        : c,
    );
    updateDeck(deck.id, { [lane]: updated });
  };

  const setDisplayCard = (entry: WebDeckCardInfo) => {
    updateDeck(deck.id, { displayCard: entry });
  };

  // Add a card from the search panel into the mainboard. Bumps an
  // existing entry's qty if the same printing is already there;
  // otherwise inserts a new entry with amount=1. Reads fresh state
  // via getState so a cross-tab mutation between search-render and
  // add-click doesn't get clobbered.
  const addFromSearch = (card: WebCardInfo) => {
    const fresh = useDecksStore.getState().decks.find((d) => d.id === deck.id);
    if (!fresh) return;
    const existingIdx = fresh.cards.findIndex(
      (c) =>
        c.cardName === card.name
        && c.setCode === card.setCode
        && c.cardNumber === card.cardNumber,
    );
    let updated: WebDeckCardInfo[];
    if (existingIdx >= 0) {
      updated = fresh.cards.map((c, i) =>
        i === existingIdx ? { ...c, amount: c.amount + 1 } : c,
      );
    } else {
      updated = [
        ...fresh.cards,
        {
          cardName: card.name,
          setCode: card.setCode,
          cardNumber: card.cardNumber,
          amount: 1,
        },
      ];
    }
    updateDeck(deck.id, { cards: updated });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            data-testid="deck-editor-back"
            className="text-sm text-zinc-400 hover:text-zinc-100 flex-shrink-0"
          >
            ← Back
          </button>
          {renameDraft === null ? (
            <button
              type="button"
              data-testid="deck-editor-rename"
              onClick={() => setRenameDraft(deck.name)}
              className="text-xl font-semibold truncate hover:bg-zinc-800 rounded px-2 py-0.5"
              title="Rename deck"
            >
              {deck.name}
            </button>
          ) : (
            <input
              type="text"
              autoFocus
              data-testid="deck-editor-rename-input"
              value={renameDraft}
              maxLength={64}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitName();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenameDraft(null);
                }
              }}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xl font-semibold text-zinc-100 max-w-md"
            />
          )}
        </div>
        <p className="text-xs text-zinc-500 flex-shrink-0">
          {totalAmount(deck.cards)} mainboard · {totalAmount(deck.sideboard)}{' '}
          sideboard
        </p>
      </header>

      <LobbyPortraitSummary displayCard={deck.displayCard} />

      <CardSearchPanel onAdd={addFromSearch} />

      {loading && (
        <p
          data-testid="deck-editor-loading"
          className="text-xs text-zinc-500 italic"
        >
          Loading card data…
        </p>
      )}

      <DeckLane
        title="Mainboard"
        lane="cards"
        entries={deck.cards}
        byName={byName}
        commanderHint={false}
        onSetQty={setQty}
        onSwapArt={(lane, entry) =>
          setArtPicker({
            lane,
            cardName: entry.cardName,
            setCode: entry.setCode,
            cardNumber: entry.cardNumber,
            previousAmount: entry.amount,
          })
        }
        displayCard={deck.displayCard}
        onSetDisplayCard={setDisplayCard}
      />

      <DeckLane
        title="Sideboard"
        lane="sideboard"
        entries={deck.sideboard}
        byName={byName}
        // Commander format convention: sideboard slot 0 IS the commander.
        // Tag it visually so users don't try to remove it like a regular
        // sideboard slot. setQty enforces a min of 1 for that slot.
        commanderHint={true}
        onSetQty={setQty}
        onSwapArt={(lane, entry) =>
          setArtPicker({
            lane,
            cardName: entry.cardName,
            setCode: entry.setCode,
            cardNumber: entry.cardNumber,
            previousAmount: entry.amount,
          })
        }
        displayCard={deck.displayCard}
        onSetDisplayCard={setDisplayCard}
      />

      {artPicker && (
        <ArtPickerModal
          cardName={artPicker.cardName}
          currentSetCode={artPicker.setCode}
          currentCardNumber={artPicker.cardNumber}
          onClose={() => setArtPicker(null)}
          onSelect={(setCode, cardNumber) =>
            swapArt(
              artPicker.lane,
              artPicker.cardName,
              artPicker.setCode,
              artPicker.cardNumber,
              setCode,
              cardNumber,
            )
          }
        />
      )}
    </div>
  );
}
