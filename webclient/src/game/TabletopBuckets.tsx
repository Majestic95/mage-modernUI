/**
 * Slice B-13-B — three-bucket layout for the tabletop variant's
 * battlefield content area (element #4 of variant-tabletop.md).
 *
 * <p>Each pod's colored zone subdivides into three vertically-stacked
 * bucket boxes:
 * <ul>
 *   <li><b>Lands</b> — 25% of pod's colored-zone height</li>
 *   <li><b>Creatures</b> — 50% (largest, contains Creatures + Planeswalkers)</li>
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
 * <p>This slice (B-13-B) ships the bucket SHELL only — labels and
 * fixed sizes are visible; card rendering inside each bucket is
 * deferred to B-13-C.
 */
import type { TabletopBuckets as TabletopBucketsData } from './tabletopBattlefieldLayout';

const BUCKET_LABELS = {
  lands: 'Lands',
  creatures: 'Creatures',
  artifactsEnchantments: 'Artifacts & Enchantments',
} as const;

export function TabletopBuckets({
  buckets,
}: {
  buckets: TabletopBucketsData;
}) {
  return (
    <div
      data-testid="tabletop-buckets"
      className="flex flex-col h-full w-full gap-1 min-h-0 min-w-0"
    >
      <BucketBox
        kind="lands"
        label={BUCKET_LABELS.lands}
        count={buckets.lands.length}
        flexBasis="25%"
      />
      <BucketBox
        kind="creatures"
        label={BUCKET_LABELS.creatures}
        count={buckets.creatures.length}
        flexBasis="50%"
      />
      <BucketBox
        kind="artifactsEnchantments"
        label={BUCKET_LABELS.artifactsEnchantments}
        count={buckets.artifactsEnchantments.length}
        flexBasis="25%"
      />
    </div>
  );
}

function BucketBox({
  kind,
  label,
  count,
  flexBasis,
}: {
  kind: 'lands' | 'creatures' | 'artifactsEnchantments';
  label: string;
  count: number;
  flexBasis: string;
}) {
  // Fixed flex-basis pinned to the percentage; flex-grow:0 +
  // flex-shrink:0 lock the bucket to that height regardless of
  // content (T1 compliance).
  return (
    <div
      data-testid={`tabletop-bucket-${kind}`}
      data-bucket-kind={kind}
      data-card-count={count}
      className="flex-shrink-0 flex-grow-0 min-h-0 min-w-0 relative rounded border border-zinc-700/50 bg-zinc-900/30 overflow-hidden"
      style={{ flexBasis }}
    >
      {/* Label sits at the top-left corner of the bucket. Faint by
          default; full-saturation on empty buckets so the box
          structure reads even without cards. Future B-13-C card
          render will sit beneath/around the label. */}
      <span
        data-testid={`tabletop-bucket-${kind}-label`}
        className={
          'absolute top-1 left-2 text-[10px] uppercase tracking-wider font-semibold pointer-events-none ' +
          (count === 0 ? 'text-zinc-400' : 'text-zinc-500/60')
        }
      >
        {label}
      </span>
    </div>
  );
}
