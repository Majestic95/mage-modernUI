/**
 * Slice B (2026-05-05) — extracted from {@link TabletopBuckets} when
 * the parent file's incremental growth pushed past the 500-LOC hard
 * cap. Houses the gap-vs-peek decision for the per-bucket card row.
 *
 * <p>Peek-stacking (negative margin between sibling cards) is a
 * fallback for the documented {@code shrink → stack → scroll}
 * adaptation chain, NOT the default. Below a per-bucket threshold the
 * row has room to render edge-to-edge with a small positive gap; only
 * past the threshold does negative-margin peek kick in.
 *
 * <p>Thresholds derived from the 1440p target (T4):
 * <ul>
 *   <li>Top/bottom pod long axis ≈ 1500px → bucket(50%) ≈ 750px /
 *       80px card ≈ 9 cards. Conservative cap at 8.</li>
 *   <li>Top/bottom lands/A&E (25%) ≈ 375px → 4 cards.</li>
 *   <li>Left/right pods: cards flow horizontally within the bucket
 *       strip; pod width ≈ 640px → ~7 cards across all buckets.</li>
 * </ul>
 *
 * <p>Past the threshold the original peek (-60% of card width per
 * sibling) kicks in — same behavior as before this change. The
 * {@code data-stacking} + {@code data-no-peek-threshold} attributes
 * are the test hooks.
 */
import type { ReactNode } from 'react';

export type BucketKind = 'lands' | 'creatures' | 'artifactsEnchantments';

export const NO_PEEK_THRESHOLD: Record<
  'horizontal' | 'vertical',
  Record<BucketKind, number>
> = {
  horizontal: { lands: 4, creatures: 8, artifactsEnchantments: 4 },
  vertical: { lands: 7, creatures: 7, artifactsEnchantments: 7 },
};

export function BucketCardsRow({
  kind,
  orientation,
  visibleCount,
  children,
}: {
  kind: BucketKind;
  orientation: 'horizontal' | 'vertical';
  visibleCount: number;
  children: ReactNode;
}) {
  const threshold = NO_PEEK_THRESHOLD[orientation][kind];
  const stackingMode: 'gap' | 'peek' = visibleCount <= threshold ? 'gap' : 'peek';
  // F1 (audit H4, 2026-05-04) — overflow-x-auto so cards beyond the
  // bucket's intrinsic width are reachable via horizontal scroll.
  // Spec-prescribed adaptation chain (shrink → stack → scroll); scroll
  // is the last fallback when peek-stacking still overflows.
  //
  // Peek is scaled to the active card-size token so `--card-size-medium`
  // overrides from podShrink keep a proportional 40% visible-strip per
  // card instead of a hardcoded -48px that turns into 100% overlap when
  // the card itself shrinks below 48px.
  const baseClass =
    'flex flex-row items-center h-full pl-12 pr-2 py-2 min-h-0 min-w-0 overflow-x-auto';
  const stackingClass =
    stackingMode === 'gap'
      ? // Positive gap — small breathing room between distinct cards
        // when the bucket has room. 0.375rem ≈ 6px.
        'gap-1.5'
      : // Negative-margin peek — previous default; 60% overlap per sibling.
        '[&>*+*]:[margin-left:calc(-1*var(--card-size-medium,80px)*0.6)]';
  return (
    <div
      data-testid={`tabletop-bucket-${kind}-cards`}
      data-stacking={stackingMode}
      data-no-peek-threshold={threshold}
      className={`${baseClass} ${stackingClass}`}
    >
      {children}
    </div>
  );
}
