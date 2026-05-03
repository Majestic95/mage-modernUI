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
import { useEffect, useMemo, useState } from 'react';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { ArtPickerModal } from '../decks/ArtPickerModal';
import { CardSearchPanel } from '../decks/CardSearchPanel';
import { useDeckCardData } from '../decks/useDeckCardData';
import { useDecksStore } from '../decks/store';

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
  onSetQty: (
    lane: Lane,
    cardName: string,
    setCode: string,
    cardNumber: string,
    nextAmount: number,
  ) => void;
  onSwapArt: (lane: Lane, entry: WebDeckCardInfo) => void;
}) {
  // Audit fix (HIGH #6) — bucket entries by content, NOT by index.
  // Index-based bucketing meant cards re-mounted whenever a prior
  // entry got filtered out (qty=0), churning React state. The
  // commander-flag is computed by content match against sideboard[0]
  // so it survives reorder + post-filter index shifts.
  const commanderEntry = commanderHint ? entries[0] ?? null : null;
  const grouped = useMemo(() => {
    const buckets = new Map<TypeBucket, Array<{ entry: WebDeckCardInfo }>>();
    for (const b of TYPE_BUCKET_ORDER) buckets.set(b, []);
    entries.forEach((entry) => {
      const card = byName.get(entry.cardName) ?? null;
      const isCommander =
        commanderEntry !== null
        && entry.cardName === commanderEntry.cardName
        && entry.setCode === commanderEntry.setCode
        && entry.cardNumber === commanderEntry.cardNumber;
      const bucket: TypeBucket = isCommander ? 'Commander' : bucketFor(card);
      buckets.get(bucket)?.push({ entry });
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
  }, [entries, byName, commanderEntry]);

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
              {items.map(({ entry }) => {
                // Audit fix (HIGH #6) — stable content key. Index-based
                // keys caused CardRow re-mount churn when adjacent rows
                // got deleted (filter shifts every following index).
                const isCommanderSlot =
                  commanderEntry !== null
                  && entry.cardName === commanderEntry.cardName
                  && entry.setCode === commanderEntry.setCode
                  && entry.cardNumber === commanderEntry.cardNumber;
                const key = `${entry.cardName}|${entry.setCode}|${entry.cardNumber}`;
                return (
                  <li key={key}>
                    <CardRow
                      entry={entry}
                      card={byName.get(entry.cardName) ?? null}
                      isCommanderSlot={isCommanderSlot}
                      onIncrement={() =>
                        onSetQty(
                          lane, entry.cardName, entry.setCode,
                          entry.cardNumber, entry.amount + 1,
                        )
                      }
                      onDecrement={() =>
                        onSetQty(
                          lane, entry.cardName, entry.setCode,
                          entry.cardNumber,
                          Math.max(isCommanderSlot ? 1 : 0, entry.amount - 1),
                        )
                      }
                      onDelete={() => {
                        if (isCommanderSlot) return;  // guard
                        onSetQty(
                          lane, entry.cardName, entry.setCode,
                          entry.cardNumber, 0,
                        );
                      }}
                      onSwapArt={() => onSwapArt(lane, entry)}
                    />
                  </li>
                );
              })}
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
  isCommanderSlot,
  onIncrement,
  onDecrement,
  onDelete,
  onSwapArt,
}: {
  entry: WebDeckCardInfo;
  card: WebCardInfo | null;
  isCommanderSlot: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onDelete: () => void;
  onSwapArt: () => void;
}) {
  const artUrl = scryfallArtCropUrl(entry.setCode, entry.cardNumber);
  // Audit fix (LOW) — Scryfall doesn't have art for some xmage promo
  // sets / non-standard collector numbers. Track per-row image-fail
  // state so we can render a placeholder instead of a broken icon.
  const [imgFailed, setImgFailed] = useState(false);
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
        {artUrl && !imgFailed ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] text-zinc-500 px-1 text-center">
            {entry.setCode || '—'}
          </span>
        )}
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
          aria-label={isCommanderSlot ? 'Cannot remove commander' : 'Remove card'}
          disabled={isCommanderSlot}
          onClick={onDelete}
          title={
            isCommanderSlot
              ? 'Commander cannot be removed — swap art instead'
              : 'Remove card'
          }
          className="ml-1 w-6 h-6 rounded text-zinc-400 bg-zinc-800 enabled:hover:bg-status-danger enabled:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
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
