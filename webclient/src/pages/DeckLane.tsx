/**
 * Bucketed grid of cards rendered by DeckEditor. Extracted from
 * DeckEditor.tsx during slice DB-0 (mechanical split). Behavior
 * preserved verbatim — see DeckEditor.tsx for the comments that
 * motivate the content-keyed bucketing + commander-flag inference.
 */
import { useMemo, useState } from 'react';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { CardRow } from './CardRow';
import {
  bucketFor,
  TYPE_BUCKET_ORDER,
  type Lane,
  type TypeBucket,
} from './deckEditorHelpers';

type SortOrder = 'cmc-asc' | 'cmc-desc' | 'name-asc' | 'name-desc';

const SORT_LABELS: Record<SortOrder, string> = {
  'cmc-asc': 'CMC ↑',
  'cmc-desc': 'CMC ↓',
  'name-asc': 'Name A→Z',
  'name-desc': 'Name Z→A',
};

export function DeckLane({
  title,
  lane,
  entries,
  byName,
  commanderHint,
  onSetQty,
  onSwapArt,
  displayCard,
  onSetDisplayCard,
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
  displayCard: WebDeckCardInfo | null;
  onSetDisplayCard: (entry: WebDeckCardInfo) => void;
}) {
  // Audit fix (HIGH #6) — bucket entries by content, NOT by index.
  // Index-based bucketing meant cards re-mounted whenever a prior
  // entry got filtered out (qty=0), churning React state. The
  // commander-flag is computed by content match against sideboard[0]
  // so it survives reorder + post-filter index shifts.
  const commanderEntry = commanderHint ? entries[0] ?? null : null;
  // fix-11 — sort order is per-lane state; default CMC ascending
  // (matches the prior hardcoded behavior). User can flip via the
  // dropdown in the lane header.
  const [sortOrder, setSortOrder] = useState<SortOrder>('cmc-asc');
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
        const nameAsc = a.entry.cardName.localeCompare(b.entry.cardName);
        switch (sortOrder) {
          case 'cmc-asc':
            return mvA !== mvB ? mvA - mvB : nameAsc;
          case 'cmc-desc':
            return mvA !== mvB ? mvB - mvA : nameAsc;
          case 'name-asc':
            return nameAsc;
          case 'name-desc':
            return -nameAsc;
        }
      });
    }
    return buckets;
  }, [entries, byName, commanderEntry, sortOrder]);

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
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          {title}
        </h3>
        {/* fix-11 — sort dropdown applies to every bucket in this
            lane. Mainboard and Sideboard sort independently. */}
        <label className="flex items-center gap-1.5 text-[10px] uppercase text-zinc-500" style={{ letterSpacing: '0.08em' }}>
          <span>Sort</span>
          <select
            data-testid={`deck-lane-${lane}-sort`}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
            aria-label={`Sort ${title} cards`}
          >
            {(Object.keys(SORT_LABELS) as SortOrder[]).map((opt) => (
              <option key={opt} value={opt}>
                {SORT_LABELS[opt]}
              </option>
            ))}
          </select>
        </label>
      </header>
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
                // fix-3 → fix-4 → fix-11 — min raised 340→400 so
                // the name area gets ~135px (after art + buttons +
                // gaps + padding) — enough for the full setCode +
                // cardNumber + CMC text line on every card without
                // truncation. Trade-off: ~1 fewer column per row at
                // common viewport widths.
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(400px, 1fr))',
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
                const isDisplayCard =
                  displayCard !== null
                  && entry.cardName === displayCard.cardName
                  && entry.setCode === displayCard.setCode
                  && entry.cardNumber === displayCard.cardNumber;
                return (
                  // fix-3 — `w-full` so the grid item explicitly
                  // stretches to fill its cell. Without this, on the
                  // post-fix-1 full-bleed editor column the cells get
                  // 300-400px wide but the `<li>` sized to content
                  // (~250px), leaving the workbench nebula bleeding
                  // through to the right of each card row.
                  <li key={key} className="w-full">
                    <CardRow
                      entry={entry}
                      card={byName.get(entry.cardName) ?? null}
                      isCommanderSlot={isCommanderSlot}
                      isDisplayCard={isDisplayCard}
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
                      onSetDisplayCard={() => onSetDisplayCard(entry)}
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
