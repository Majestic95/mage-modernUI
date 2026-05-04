/**
 * Slice B-13-B (refined in B-13-B.1) — three-bucket layout for the
 * tabletop variant's battlefield content area (element #4 of
 * variant-tabletop.md).
 *
 * <p>Each pod's colored zone subdivides into three bucket boxes
 * arranged along the pod's LONG axis (mirrors the per-pod cluster
 * orientation rule from element #6):
 * <ul>
 *   <li><b>TOP / BOTTOM pods</b> (horizontal-layout pods): buckets
 *       stack <i>horizontally</i> (left-to-right). Each bucket is a
 *       vertical column within the wide pod.</li>
 *   <li><b>LEFT / RIGHT pods</b> (vertical-layout pods): buckets
 *       stack <i>vertically</i> (top-to-bottom). Each bucket is a
 *       horizontal strip within the tall pod.</li>
 * </ul>
 *
 * <p>Size ratios are uniform across orientations:
 * <ul>
 *   <li><b>Lands</b> — 25%</li>
 *   <li><b>Creatures</b> — 50% (largest; contains Creatures +
 *       Planeswalkers)</li>
 *   <li><b>Artifacts &amp; Enchantments</b> — 25% (incl Battles)</li>
 * </ul>
 *
 * <p>Bucket boxes are FIXED-SIZE — they don't shrink/expand based on
 * how many cards they hold. This enforces tabletop's load-bearing
 * rule T1 ("zones are fixed dimensional anchors; cards inside
 * adapt"). Cards adapt via the shrink → stack → scroll sequence
 * (element #11), which lands in slice B-13-C.
 *
 * <p>Empty buckets render with a faint label inside the empty
 * colored region (per user direction during element #6 walkthrough:
 * "labels can be visible for empty bucket zones").
 *
 * <p>This slice (B-13-B + B-13-B.1) ships the bucket SHELL only —
 * orientation-aware layout + labels + fixed sizes are visible;
 * card rendering inside each bucket is deferred to B-13-C.
 */
import type { PlayerAreaPosition } from './PlayerArea';
import type { TabletopBuckets as TabletopBucketsData } from './tabletopBattlefieldLayout';
import type { WebPermanentView } from '../api/schemas';
import { CardFace } from './CardFace';

const BUCKET_LABELS = {
  lands: 'Lands',
  creatures: 'Creatures',
  artifactsEnchantments: 'Artifacts & Enchantments',
} as const;

export function TabletopBuckets({
  buckets,
  position,
}: {
  buckets: TabletopBucketsData;
  position: PlayerAreaPosition;
}) {
  // Buckets stack along the pod's LONG axis. Top/bottom pods are
  // wide-horizontal so buckets line up left-to-right (flex-row).
  // Left/right pods are tall-vertical so buckets stack top-to-
  // bottom (flex-col). Same percentage size ratios in either case.
  const isHorizontalArrangement = position === 'top' || position === 'bottom';
  const flexDirClass = isHorizontalArrangement
    ? 'flex flex-row'
    : 'flex flex-col';
  return (
    <div
      data-testid="tabletop-buckets"
      data-bucket-orientation={isHorizontalArrangement ? 'horizontal' : 'vertical'}
      className={`${flexDirClass} h-full w-full gap-1 min-h-0 min-w-0`}
    >
      <BucketBox
        kind="lands"
        label={BUCKET_LABELS.lands}
        cards={buckets.lands}
        flexBasis="25%"
      />
      <BucketBox
        kind="creatures"
        label={BUCKET_LABELS.creatures}
        cards={buckets.creatures}
        flexBasis="50%"
      />
      <BucketBox
        kind="artifactsEnchantments"
        label={BUCKET_LABELS.artifactsEnchantments}
        cards={buckets.artifactsEnchantments}
        flexBasis="25%"
      />
    </div>
  );
}

function BucketBox({
  kind,
  label,
  cards,
  flexBasis,
}: {
  kind: 'lands' | 'creatures' | 'artifactsEnchantments';
  label: string;
  cards: readonly WebPermanentView[];
  flexBasis: string;
}) {
  // Fixed flex-basis pinned to the percentage; flex-grow:0 +
  // flex-shrink:0 lock the bucket to that height regardless of
  // content (T1 compliance).
  const count = cards.length;
  return (
    <div
      data-testid={`tabletop-bucket-${kind}`}
      data-bucket-kind={kind}
      data-card-count={count}
      // Slice B-13-E — visual tuning. Border bumped from
      // border-zinc-700/50 (very dim) → border-zinc-500/70 so the
      // bucket boundaries read clearly against the colored zone.
      // Dropped the bucket's own bg-zinc-900/30 so the underlying
      // commander-identity gradient shows through (eliminates a
      // dim-overlay-on-color muddying the zone color).
      className="flex-shrink-0 flex-grow-0 min-h-0 min-w-0 relative rounded border border-zinc-500/70 overflow-hidden"
      style={{ flexBasis }}
    >
      {/* Label sits at the top-left corner of the bucket. Faint when
          populated, full-saturation when empty so the box structure
          reads even without cards. */}
      <span
        data-testid={`tabletop-bucket-${kind}-label`}
        className={
          'absolute top-1 left-2 z-10 text-[10px] uppercase tracking-wider font-semibold pointer-events-none ' +
          (count === 0 ? 'text-zinc-400' : 'text-zinc-500/60')
        }
      >
        {label}
      </span>
      {/* Slice B-13-D — card stacking with 10% peek per element #4.
          Cards after the first get `margin-left: -72px` (= -90% of
          --card-size-medium 80px), so each subsequent card shows
          only its leftmost 10% behind the next card. Total visible
          width for N cards = 80 + (N-1) × 8 px. The first card
          fully visible; deeper cards stack like a hand-fan but
          horizontal. T1 ✓ — bucket box stays fixed-size; cards
          adapt by overlapping. */}
      {count > 0 && (
        <div
          data-testid={`tabletop-bucket-${kind}-cards`}
          className="flex flex-row items-center h-full pl-12 pr-2 py-2 min-h-0 min-w-0 [&>*+*]:-ml-[72px]"
        >
          {cards.map((p) => (
            <CardFace
              key={p.card.id}
              card={p.card}
              size="battlefield"
              perm={p}
              tapped={p.tapped}
            />
          ))}
        </div>
      )}
    </div>
  );
}
