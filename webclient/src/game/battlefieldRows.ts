import type { WebPermanentView } from '../api/schemas';

/**
 * Slice 53 / 70-Z.1 — battlefield row classification.
 *
 * <p>MTGA / MTGO render permanents in distinct type-grouped lanes
 * rather than a single flowing line of tiles. The grouping makes a
 * glance read-out of board state much faster: "what attacks me,
 * what static effects are running, what mana do they have" maps
 * cleanly onto separate lanes.
 *
 * <p>Slice 70-Z.1 (user direction 2026-04-30) reshapes the buckets
 * around three categories that match the redesigned per-pod layout
 * (lands at the screen-edge, creatures facing the focal zone,
 * artifacts in a side box):
 * <ul>
 *   <li>{@code creatures} — anything with type {@code CREATURE} OR
 *       {@code PLANESWALKER}. Planeswalkers were previously in the
 *       "other" lane; they now live with creatures because both
 *       categories are "battle participants" and read together as
 *       the pod's threat surface.</li>
 *   <li>{@code lands} — pure lands (LAND type, with no other
 *       non-land permanent type stacked).</li>
 *   <li>{@code artifacts} — everything else: artifacts, enchantments,
 *       battles, land-artifacts (treasures-as-lands), land-enchant-
 *       ments (Urza's Saga), AND any unknown type the engine emits
 *       in the future. Default fallback so a card never renders
 *       in a wrong row when the engine introduces a new type.</li>
 * </ul>
 *
 * <p>Multi-type precedence (top to bottom): CREATURE > PLANESWALKER >
 * pure LAND > everything else (artifacts).
 */
export type BattlefieldRow = 'creatures' | 'artifacts' | 'lands';

const NON_LAND_PERMANENT_TYPES = [
  'ARTIFACT',
  'ENCHANTMENT',
  'PLANESWALKER',
  'BATTLE',
] as const;

export function classifyPermanent(perm: WebPermanentView): BattlefieldRow {
  const types = perm.card.types;
  // Creature precedence wins over everything (animated lands,
  // artifact-creatures, enchantment-creatures, etc.).
  if (types.includes('CREATURE')) return 'creatures';
  // Slice 70-Z.1 — planeswalkers join the creatures lane (user
  // direction: "Planeswalkers and commanders should be in the
  // 'creature' zone since they are creatures"). Commanders fall
  // through naturally — most are creatures (caught above) or
  // planeswalkers (caught here).
  if (types.includes('PLANESWALKER')) return 'creatures';
  if (
    types.includes('LAND') &&
    !types.some((t) =>
      (NON_LAND_PERMANENT_TYPES as readonly string[]).includes(t),
    )
  ) {
    return 'lands';
  }
  // Default fallback — artifacts, enchantments, battles, land-
  // artifacts, land-enchantments, AND unknown types. Per slice
  // 70-Z.1 user direction: "If there is any question about a card
  // type, it would, by default, go into the artifact zone."
  return 'artifacts';
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
    artifacts: [],
    lands: [],
  };
  for (const perm of permanents) {
    buckets[classifyPermanent(perm)].push(perm);
  }
  return buckets;
}

/**
 * Slice 70-Z.1 — main-row order per perspective. The MAIN ROWS are
 * creatures + lands; the artifact box renders separately as a side
 * element (positioned per pod by {@link PlayerArea}). This function
 * returns the order in which the two main rows stack along the
 * pod's "facing axis" — perpendicular to the line between the
 * player's portrait and the central focal zone.
 *
 * <p>Self has lands at the bottom (closest to the hand below);
 * opponents are mirrored so lands sit at the top (closest to their
 * "side of the table") and creatures sit closest to the focal zone
 * (the threat surface). Matches MTGA / MTGO convention.
 */
export function rowOrder(
  perspective: 'self' | 'opponent',
): readonly BattlefieldRow[] {
  return perspective === 'self'
    ? (['creatures', 'lands'] as const)
    : (['lands', 'creatures'] as const);
}
