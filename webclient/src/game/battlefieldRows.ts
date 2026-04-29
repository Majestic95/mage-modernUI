import type { WebPermanentView } from '../api/schemas';

/**
 * Slice 53 — battlefield row classification.
 *
 * <p>MTGA / MTGO render permanents in three type-grouped rows
 * (creatures, other, lands) rather than a single flowing line of
 * tiles. The grouping makes a glance read-out of board state much
 * faster: "what attacks me, what mana do they have, what static
 * effects are running" maps cleanly onto the three lanes.
 *
 * <p>Precedence for multi-type permanents:
 * <ul>
 *   <li>{@code CREATURE} wins outright — animated lands (Mutavault,
 *   Treetop Village) live in the creatures row while the
 *   animation is active.</li>
 *   <li>Anything that is not a creature but is also not a pure land
 *   (e.g. land artifacts, the rare land enchantment) goes to
 *   {@code other} — these need their own slot for clarity.</li>
 *   <li>Pure lands fall through to the {@code lands} row.</li>
 * </ul>
 */
export type BattlefieldRow = 'creatures' | 'other' | 'lands';

const NON_LAND_PERMANENT_TYPES = [
  'ARTIFACT',
  'ENCHANTMENT',
  'PLANESWALKER',
  'BATTLE',
] as const;

export function classifyPermanent(perm: WebPermanentView): BattlefieldRow {
  const types = perm.card.types;
  if (types.includes('CREATURE')) return 'creatures';
  if (
    types.includes('LAND') &&
    !types.some((t) =>
      (NON_LAND_PERMANENT_TYPES as readonly string[]).includes(t),
    )
  ) {
    return 'lands';
  }
  // Anything left (artifact, enchantment, planeswalker, battle, or a
  // land that's also one of those) goes to the "other" row. Pure lands
  // already returned above; reaching this line means it has at least
  // one non-land non-creature type, which dominates land-row placement.
  return 'other';
}

/**
 * Bucket a flat list of permanents into the three rows, preserving
 * insertion order within each row. Empty buckets stay empty arrays
 * so the caller can decide whether to render the row container or
 * skip it.
 */
export function bucketBattlefield(
  permanents: WebPermanentView[],
): Record<BattlefieldRow, WebPermanentView[]> {
  const buckets: Record<BattlefieldRow, WebPermanentView[]> = {
    creatures: [],
    other: [],
    lands: [],
  };
  for (const perm of permanents) {
    buckets[classifyPermanent(perm)].push(perm);
  }
  return buckets;
}

/**
 * Top-to-bottom row order for a given perspective.
 *
 * <p>Self has lands at the bottom (closest to the hand below);
 * opponent is mirrored so lands sit at the top (closest to their
 * hand above) and creatures sit at the bottom (closest to combat
 * against you). This matches MTGA / MTGO convention.
 */
export function rowOrder(
  perspective: 'self' | 'opponent',
): readonly BattlefieldRow[] {
  return perspective === 'self'
    ? (['creatures', 'other', 'lands'] as const)
    : (['lands', 'other', 'creatures'] as const);
}
