/**
 * Deck composition stats panel — fills the right half of the
 * workbench's bottom row. Surfaces stats Archidekt / Moxfield /
 * Manabox prominently show that the lobby's DeckPreviewPanel
 * doesn't:
 *
 * <ul>
 *   <li>Average mana value (excluding lands) — universal stat.</li>
 *   <li>Land vs non-land split — "37 lands · 63 spells".</li>
 *   <li>Full type breakdown including Planeswalkers / Sorceries /
 *       Lands separately (DeckPreviewPanel folds Planeswalkers into
 *       creatures and omits lands).</li>
 *   <li>Rarity distribution — Common / Uncommon / Rare / Mythic
 *       counts, essential for Pauper + useful for any format.</li>
 * </ul>
 *
 * <p>Deck-builder-specific per the separation directive; no lobby
 * file touch. Consumes the shared {@link useDeckCardData} cache so
 * no extra wire load.
 */
import { useMemo } from 'react';
import { useDeckCardData } from '../decks/useDeckCardData';
import type { SavedDeck } from '../decks/store';
import type { WebCardInfo } from '../api/schemas';

interface Props {
  deck: SavedDeck | null;
}

type Bucket = 'Creature' | 'Planeswalker' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Land' | 'Other';
const TYPE_ORDER: Bucket[] = [
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other',
];

type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Mythic' | 'Other';
const RARITY_ORDER: Rarity[] = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Other'];
const RARITY_COLOR: Record<Rarity, string> = {
  Common: 'var(--color-text-secondary)',
  Uncommon: '#9aa9b5',
  Rare: '#c9a96b',
  Mythic: '#c75a2e',
  Other: 'var(--color-text-muted)',
};

interface Stats {
  totalCount: number;
  landCount: number;
  nonLandCount: number;
  avgMv: number;
  resolvedCount: number;
  typeCounts: Record<Bucket, number>;
  rarityCounts: Record<Rarity, number>;
}

const EMPTY_STATS: Stats = {
  totalCount: 0,
  landCount: 0,
  nonLandCount: 0,
  avgMv: 0,
  resolvedCount: 0,
  typeCounts: {
    Creature: 0, Planeswalker: 0, Instant: 0, Sorcery: 0,
    Artifact: 0, Enchantment: 0, Land: 0, Other: 0,
  },
  rarityCounts: { Common: 0, Uncommon: 0, Rare: 0, Mythic: 0, Other: 0 },
};

function bucketForCard(card: WebCardInfo): Bucket {
  const types = card.types.map((t) => t.toUpperCase());
  if (types.includes('LAND')) return 'Land';
  if (types.includes('CREATURE')) return 'Creature';
  if (types.includes('PLANESWALKER')) return 'Planeswalker';
  if (types.includes('INSTANT')) return 'Instant';
  if (types.includes('SORCERY')) return 'Sorcery';
  if (types.includes('ARTIFACT')) return 'Artifact';
  if (types.includes('ENCHANTMENT')) return 'Enchantment';
  return 'Other';
}

function rarityForCard(card: WebCardInfo): Rarity {
  const r = (card.rarity ?? '').toUpperCase();
  if (r === 'COMMON') return 'Common';
  if (r === 'UNCOMMON') return 'Uncommon';
  if (r === 'RARE') return 'Rare';
  if (r === 'MYTHIC') return 'Mythic';
  return 'Other';
}

export function DeckCompositionPanel({ deck }: Props) {
  const { byName, loading } = useDeckCardData(deck);

  const stats = useMemo<Stats>(() => {
    if (!deck) return EMPTY_STATS;
    const s: Stats = {
      totalCount: 0, landCount: 0, nonLandCount: 0, avgMv: 0, resolvedCount: 0,
      typeCounts: {
        Creature: 0, Planeswalker: 0, Instant: 0, Sorcery: 0,
        Artifact: 0, Enchantment: 0, Land: 0, Other: 0,
      },
      rarityCounts: { Common: 0, Uncommon: 0, Rare: 0, Mythic: 0, Other: 0 },
    };
    let mvSum = 0;
    let mvCount = 0;
    for (const entry of deck.cards) {
      s.totalCount += entry.amount;
      const card = byName.get(entry.cardName) ?? null;
      if (!card) continue;
      s.resolvedCount += entry.amount;
      const bucket = bucketForCard(card);
      s.typeCounts[bucket] += entry.amount;
      const rarity = rarityForCard(card);
      s.rarityCounts[rarity] += entry.amount;
      if (bucket === 'Land') {
        s.landCount += entry.amount;
      } else {
        s.nonLandCount += entry.amount;
        mvSum += card.manaValue * entry.amount;
        mvCount += entry.amount;
      }
    }
    s.avgMv = mvCount > 0 ? mvSum / mvCount : 0;
    return s;
  }, [deck, byName]);

  if (!deck) {
    return (
      <section
        data-testid="deck-composition-panel"
        className="flex h-full min-h-0 items-center justify-center rounded-xl border border-card-frame-default/60 p-3 text-sm text-text-muted"
        style={{
          background: 'rgba(21, 34, 41, 0.85)',
          boxShadow: 'var(--shadow-low)',
        }}
      >
        Pick a deck to see composition stats.
      </section>
    );
  }

  return (
    <section
      data-testid="deck-composition-panel"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-card-frame-default/60 p-4"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          className="text-xs font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.14em' }}
        >
          Composition
        </h2>
        {loading && (
          <span
            className="text-[10px] uppercase text-text-muted"
            style={{ letterSpacing: '0.1em' }}
          >
            Calculating…
          </span>
        )}
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Avg CMC"
          value={stats.avgMv > 0 ? stats.avgMv.toFixed(2) : '—'}
          hint="excludes lands"
        />
        <StatTile
          label="Lands"
          value={stats.landCount.toString()}
        />
        <StatTile
          label="Spells"
          value={stats.nonLandCount.toString()}
        />
      </div>

      <div>
        <h3
          className="mb-1.5 text-[10px] font-semibold uppercase text-text-secondary"
          style={{ letterSpacing: '0.12em' }}
        >
          Type breakdown
        </h3>
        <ul data-testid="deck-composition-types" className="grid grid-cols-2 gap-x-3 gap-y-1">
          {TYPE_ORDER.map((bucket) => {
            const count = stats.typeCounts[bucket];
            if (count === 0) return null;
            return (
              <li
                key={bucket}
                className="flex items-center justify-between text-xs text-text-secondary"
              >
                <span>{bucket}</span>
                <span className="font-mono text-text-primary">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3
          className="mb-1.5 text-[10px] font-semibold uppercase text-text-secondary"
          style={{ letterSpacing: '0.12em' }}
        >
          Rarity
        </h3>
        <ul data-testid="deck-composition-rarities" className="grid grid-cols-2 gap-x-3 gap-y-1">
          {RARITY_ORDER.map((rarity) => {
            const count = stats.rarityCounts[rarity];
            if (count === 0) return null;
            return (
              <li
                key={rarity}
                className="flex items-center justify-between text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ background: RARITY_COLOR[rarity] }}
                  />
                  <span className="text-text-secondary">{rarity}</span>
                </span>
                <span className="font-mono text-text-primary">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {stats.resolvedCount < stats.totalCount && (
        <p
          className="mt-auto text-[10px] italic text-text-muted"
          style={{ letterSpacing: '0.04em' }}
        >
          Stats based on {stats.resolvedCount}/{stats.totalCount} resolved cards.
        </p>
      )}
    </section>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="flex flex-col items-center rounded-md border px-2 py-2"
      style={{
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-card-frame-default)',
      }}
    >
      <span className="text-lg font-semibold text-text-primary tabular-nums">
        {value}
      </span>
      <span
        className="text-[10px] uppercase text-text-secondary"
        style={{ letterSpacing: '0.1em' }}
      >
        {label}
      </span>
      {hint && (
        <span
          className="mt-0.5 text-[9px] uppercase text-text-muted"
          style={{ letterSpacing: '0.06em' }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
