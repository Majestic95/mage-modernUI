/**
 * Bucketed grid of cards rendered by DeckEditor. Extracted from
 * DeckEditor.tsx during slice DB-0 (mechanical split). Behavior
 * preserved verbatim — see DeckEditor.tsx for the comments that
 * motivate the content-keyed bucketing + commander-flag inference.
 */
import { useMemo } from 'react';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { CardRow } from './CardRow';
import {
  bucketFor,
  TYPE_BUCKET_ORDER,
  type Lane,
  type TypeBucket,
} from './deckEditorHelpers';

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
                const isDisplayCard =
                  displayCard !== null
                  && entry.cardName === displayCard.cardName
                  && entry.setCode === displayCard.setCode
                  && entry.cardNumber === displayCard.cardNumber;
                return (
                  <li key={key}>
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
