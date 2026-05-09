import { useMemo } from 'react';
import type { WebCardView } from '../../api/schemas';
import { CardFace } from '../CardFace';

/**
 * CMC-grouped card grid for {@link LibrarySearchModal}. Pure
 * presentational — selection / submit logic lives in the modal so the
 * grid can stay layout-only and re-render cheaply on filter changes.
 *
 * <p>Buckets are CMC 0..6, a "7+" bucket for high-cost spells, and a
 * separate Lands bucket pulled out regardless of mana value (lands
 * with off-the-wall costs like Dryad Arbor still bucket here for
 * scanability — players look for lands as a category, not a CMC).
 *
 * <p>Within a bucket, cards sort by name. Empty buckets are omitted
 * entirely so the modal doesn't waste vertical space on "CMC 5 (0)".
 *
 * <p>{@code ordered} renders a numbered fuchsia badge on picked cards
 * (sequential pick mode — scry / surveil ordering follow-ups). When
 * false, picked cards just get a fuchsia ring.
 */
interface Props {
  cards: ReadonlyArray<WebCardView>;
  eligibleIds: ReadonlySet<string> | null;
  pickedIds: readonly string[];
  ordered: boolean;
  onCardClick: (id: string) => void;
}

interface Bucket {
  label: string;
  testid: string;
  cards: WebCardView[];
}

const CMC_BUCKETS = [0, 1, 2, 3, 4, 5, 6] as const;

function buildBuckets(cards: ReadonlyArray<WebCardView>): Bucket[] {
  const lands: WebCardView[] = [];
  const byCmc = new Map<number, WebCardView[]>();
  const sevenPlus: WebCardView[] = [];
  for (const c of cards) {
    // Wire emits CardType.name() — uppercase enum constant. See
    // CardViewMapper.cardTypeNames + Mage/.../constants/CardType.java.
    if (c.types.includes('LAND')) {
      lands.push(c);
      continue;
    }
    if (c.manaValue >= 7) {
      sevenPlus.push(c);
      continue;
    }
    const bucket = byCmc.get(c.manaValue) ?? [];
    bucket.push(c);
    byCmc.set(c.manaValue, bucket);
  }
  const sortByName = (a: WebCardView, b: WebCardView) =>
    a.name.localeCompare(b.name);
  const out: Bucket[] = [];
  for (const cmc of CMC_BUCKETS) {
    const list = byCmc.get(cmc);
    if (!list || list.length === 0) continue;
    list.sort(sortByName);
    out.push({ label: `CMC ${cmc}`, testid: `library-search-cmc-${cmc}`, cards: list });
  }
  if (sevenPlus.length > 0) {
    sevenPlus.sort(sortByName);
    out.push({ label: 'CMC 7+', testid: 'library-search-cmc-7plus', cards: sevenPlus });
  }
  if (lands.length > 0) {
    lands.sort(sortByName);
    out.push({ label: 'Lands', testid: 'library-search-cmc-lands', cards: lands });
  }
  return out;
}

export function LibrarySearchGrid({
  cards,
  eligibleIds,
  pickedIds,
  ordered,
  onCardClick,
}: Props) {
  const buckets = useMemo(() => buildBuckets(cards), [cards]);
  const pickedIndex = useMemo(() => {
    const map = new Map<string, number>();
    pickedIds.forEach((id, i) => map.set(id, i));
    return map;
  }, [pickedIds]);
  const isEligible = (id: string): boolean => {
    if (!eligibleIds) return true;
    return eligibleIds.has(id);
  };
  return (
    <div
      data-testid="library-search-grid"
      className="flex-1 overflow-y-auto pr-1 -mr-1 space-y-4"
    >
      {buckets.map((bucket) => (
        <section key={bucket.testid} data-testid={bucket.testid}>
          <h3 className="text-xs uppercase tracking-wider text-text-secondary mb-2 sticky top-0 bg-zinc-900/95 backdrop-blur-sm py-1">
            {bucket.label}{' '}
            <span className="text-zinc-500 normal-case tracking-normal">
              ({bucket.cards.length})
            </span>
          </h3>
          {/* 5 cols is the cap — at the xl breakpoint with the modal
              clamped to 1100 px wide, 6 cols undershoots CardFace's
              native --card-size-large (180 px) and would force
              horizontal overflow. 5 cols at 1440p ≈ 200 px / tile,
              comfortably above the native size. */}
          <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
            {bucket.cards.map((card) => {
              const eligible = isEligible(card.id);
              const idx = pickedIndex.get(card.id);
              const isPicked = idx !== undefined;
              return (
                <li key={card.id} className="relative">
                  <button
                    type="button"
                    disabled={!eligible}
                    onClick={() => onCardClick(card.id)}
                    data-testid={`library-search-tile-${card.id}`}
                    data-eligible={eligible || undefined}
                    data-picked={isPicked || undefined}
                    aria-label={card.name + (isPicked ? ' (selected)' : '')}
                    className={
                      'block w-full rounded transition focus:outline-none focus:ring-2 focus:ring-fuchsia-400 ' +
                      (eligible
                        ? 'cursor-pointer hover:brightness-110 '
                        : 'cursor-not-allowed opacity-40 ') +
                      (isPicked ? 'ring-2 ring-fuchsia-400 brightness-110' : '')
                    }
                  >
                    <CardFace card={card} size="hand" />
                    {ordered && isPicked && (
                      <span
                        // Top-left so the badge doesn't collide with
                        // CardFace's mana-cost overlay (top-right).
                        className="absolute top-1 left-1 bg-fuchsia-500 text-zinc-950 rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold pointer-events-none"
                        aria-hidden="true"
                      >
                        {(idx ?? 0) + 1}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
