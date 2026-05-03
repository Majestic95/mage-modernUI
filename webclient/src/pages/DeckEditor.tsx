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
 */
import { useMemo, useState } from 'react';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { ArtPickerModal } from '../decks/ArtPickerModal';
import { useDeckCardData } from '../decks/useDeckCardData';
import { useDecksStore, type SavedDeck } from '../decks/store';

interface Props {
  deckId: string;
  onClose: () => void;
}

type Lane = 'cards' | 'sideboard';

const TYPE_BUCKET_ORDER = [
  'Commander',
  'Creature',
  'Planeswalker',
  'Instant/Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other',
] as const;
type TypeBucket = (typeof TYPE_BUCKET_ORDER)[number];

function bucketFor(card: WebCardInfo | null): TypeBucket {
  if (!card) return 'Other';
  // Wire types are UPPERCASE per CardInfoMapper.toDto. Normalize once.
  const types = card.types.map((t) => t.toUpperCase());
  if (types.includes('LAND')) return 'Land';
  if (types.includes('CREATURE')) return 'Creature';
  if (types.includes('PLANESWALKER')) return 'Planeswalker';
  if (types.includes('INSTANT') || types.includes('SORCERY')) {
    return 'Instant/Sorcery';
  }
  if (types.includes('ARTIFACT')) return 'Artifact';
  if (types.includes('ENCHANTMENT')) return 'Enchantment';
  return 'Other';
}

export function DeckEditor({ deckId, onClose }: Props) {
  const deck = useDecksStore((s) =>
    s.decks.find((d) => d.id === deckId) ?? null,
  );
  const updateDeck = useDecksStore((s) => s.update);
  const { byName, loading } = useDeckCardData(deck);

  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [artPicker, setArtPicker] = useState<
    | { lane: Lane; index: number; entry: WebDeckCardInfo }
    | null
  >(null);

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

  const setQty = (lane: Lane, index: number, nextAmount: number) => {
    const list = lane === 'cards' ? deck.cards : deck.sideboard;
    const updated = list
      .map((c, i) => (i === index ? { ...c, amount: nextAmount } : c))
      .filter((c) => c.amount > 0);
    updateDeck(deck.id, { [lane]: updated });
  };

  const swapArt = (
    lane: Lane,
    index: number,
    setCode: string,
    cardNumber: string,
  ) => {
    const list = lane === 'cards' ? deck.cards : deck.sideboard;
    const updated = list.map((c, i) =>
      i === index ? { ...c, setCode, cardNumber } : c,
    );
    updateDeck(deck.id, { [lane]: updated });
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
        onSwapArt={(lane, index, entry) =>
          setArtPicker({ lane, index, entry })
        }
      />

      <DeckLane
        title="Sideboard"
        lane="sideboard"
        entries={deck.sideboard}
        byName={byName}
        // Commander format convention: sideboard slot 0 IS the commander.
        // Tag it visually so users don't try to remove it like a regular
        // sideboard slot. (We don't enforce — user can still delete.)
        commanderHint={true}
        onSetQty={setQty}
        onSwapArt={(lane, index, entry) =>
          setArtPicker({ lane, index, entry })
        }
      />

      {artPicker && (
        <ArtPickerModal
          cardName={artPicker.entry.cardName}
          currentSetCode={artPicker.entry.setCode}
          currentCardNumber={artPicker.entry.cardNumber}
          onClose={() => setArtPicker(null)}
          onSelect={(setCode, cardNumber) =>
            swapArt(artPicker.lane, artPicker.index, setCode, cardNumber)
          }
        />
      )}
    </div>
  );
}

function DeckLane({
  title,
  lane,
  entries,
  byName,
  commanderHint,
  onSetQty,
  onSwapArt,
}: {
  title: string;
  lane: Lane;
  entries: WebDeckCardInfo[];
  byName: ReadonlyMap<string, WebCardInfo | null>;
  commanderHint: boolean;
  onSetQty: (lane: Lane, index: number, nextAmount: number) => void;
  onSwapArt: (lane: Lane, index: number, entry: WebDeckCardInfo) => void;
}) {
  // Build [bucket -> [entry+originalIndex]] preserving original index
  // so qty / art swap mutations target the right element in the
  // original array (we sort + group for display only).
  const grouped = useMemo(() => {
    const buckets = new Map<TypeBucket, Array<{ entry: WebDeckCardInfo; index: number }>>();
    for (const b of TYPE_BUCKET_ORDER) buckets.set(b, []);
    entries.forEach((entry, index) => {
      const card = byName.get(entry.cardName) ?? null;
      // Sideboard slot 0 in Commander format is the commander — pull
      // it into its own bucket regardless of card type so the user
      // sees it labeled clearly.
      const bucket: TypeBucket =
        commanderHint && index === 0 ? 'Commander' : bucketFor(card);
      buckets.get(bucket)?.push({ entry, index });
    });
    for (const arr of buckets.values()) {
      arr.sort((a, b) => {
        const ca = byName.get(a.entry.cardName);
        const cb = byName.get(b.entry.cardName);
        const mvA = ca?.manaValue ?? 0;
        const mvB = cb?.manaValue ?? 0;
        if (mvA !== mvB) return mvA - mvB;
        return a.entry.cardName.localeCompare(b.entry.cardName);
      });
    }
    return buckets;
  }, [entries, byName, commanderHint]);

  if (entries.length === 0) {
    return (
      <section data-testid={`deck-lane-${lane}`}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400 mb-2">
          {title}
        </h3>
        <p className="text-xs text-zinc-500 italic">Empty.</p>
      </section>
    );
  }

  return (
    <section data-testid={`deck-lane-${lane}`} className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h3>
      {TYPE_BUCKET_ORDER.map((bucket) => {
        const items = grouped.get(bucket) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={bucket} data-testid={`deck-bucket-${bucket}`}>
            <h4 className="text-xs uppercase text-zinc-500 mb-1.5">
              {bucket} · {items.reduce((s, i) => s + i.entry.amount, 0)}
            </h4>
            <ul
              className="grid gap-2"
              style={{
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(220px, 1fr))',
              }}
            >
              {items.map(({ entry, index }) => (
                <li key={`${entry.cardName}-${entry.setCode}-${entry.cardNumber}-${index}`}>
                  <CardRow
                    entry={entry}
                    card={byName.get(entry.cardName) ?? null}
                    onIncrement={() => onSetQty(lane, index, entry.amount + 1)}
                    onDecrement={() =>
                      onSetQty(lane, index, Math.max(0, entry.amount - 1))
                    }
                    onDelete={() => onSetQty(lane, index, 0)}
                    onSwapArt={() => onSwapArt(lane, index, entry)}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function CardRow({
  entry,
  card,
  onIncrement,
  onDecrement,
  onDelete,
  onSwapArt,
}: {
  entry: WebDeckCardInfo;
  card: WebCardInfo | null;
  onIncrement: () => void;
  onDecrement: () => void;
  onDelete: () => void;
  onSwapArt: () => void;
}) {
  const artUrl = scryfallArtCropUrl(entry.setCode, entry.cardNumber);
  return (
    <div
      data-testid="deck-editor-card-row"
      data-card={entry.cardName}
      data-set={entry.setCode}
      data-number={entry.cardNumber}
      className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-1.5"
    >
      <button
        type="button"
        data-testid="deck-editor-swap-art"
        onClick={onSwapArt}
        className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-zinc-800 hover:ring-2 hover:ring-fuchsia-400 transition-shadow"
        title={`Swap art (currently ${entry.setCode} #${entry.cardNumber})`}
      >
        {artUrl ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100 truncate" title={entry.cardName}>
          {entry.cardName}
        </p>
        <p className="text-[11px] text-zinc-500 font-mono truncate">
          {entry.setCode} #{entry.cardNumber}
          {card ? ` · CMC ${card.manaValue}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          data-testid="deck-editor-decrement"
          aria-label="Decrease quantity"
          onClick={onDecrement}
          className="w-6 h-6 rounded text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
        >
          −
        </button>
        <span
          data-testid="deck-editor-amount"
          className="w-5 text-center text-sm tabular-nums text-zinc-200"
        >
          {entry.amount}
        </span>
        <button
          type="button"
          data-testid="deck-editor-increment"
          aria-label="Increase quantity"
          onClick={onIncrement}
          className="w-6 h-6 rounded text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
        >
          +
        </button>
        <button
          type="button"
          data-testid="deck-editor-delete"
          aria-label="Remove card"
          onClick={onDelete}
          className="ml-1 w-6 h-6 rounded text-zinc-400 bg-zinc-800 hover:bg-status-danger hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function totalAmount(entries: WebDeckCardInfo[]): number {
  let n = 0;
  for (const e of entries) n += e.amount;
  return n;
}

function scryfallArtCropUrl(setCode: string, cardNumber: string): string | null {
  if (!setCode || !cardNumber) return null;
  const set = setCode.toLowerCase();
  const num = encodeURIComponent(cardNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=art_crop`;
}
