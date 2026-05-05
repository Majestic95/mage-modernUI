/**
 * Slice B-13-A — type-bucket partitioning for the tabletop variant.
 *
 * <p>Per element #4 of {@code docs/design/variant-tabletop.md},
 * tabletop pods divide their colored battlefield zone into three
 * named buckets:
 * <ul>
 *   <li><b>Lands</b> — only {@code LAND} permanents.</li>
 *   <li><b>Creatures</b> — {@code CREATURE} + {@code PLANESWALKER}
 *       + creature tokens. Per user direction (slice B-0
 *       walkthrough), planeswalkers and creature tokens both go
 *       into the creatures bucket alongside ordinary creatures
 *       because they share the "things that attack/block" play
 *       affordance.</li>
 *   <li><b>Artifacts-Enchantments</b> — {@code ARTIFACT} +
 *       {@code ENCHANTMENT} + {@code BATTLE}. Battles are
 *       lumped here despite their flippable mechanic per user
 *       direction.</li>
 * </ul>
 *
 * <p><b>Hybrid types — "creature wins"</b> (slice B-0 user
 * direction): if a permanent has the {@code CREATURE} type tag
 * active <i>currently</i>, it goes to Creatures regardless of
 * other types it may carry. So:
 * <ul>
 *   <li>Walking Ballista (artifact creature) → Creatures</li>
 *   <li>Bestow creatures (enchantment creature) → Creatures</li>
 *   <li>Manlands while animated (land creature) → Creatures</li>
 *   <li>Battle that flipped to a creature → Creatures</li>
 * </ul>
 * Manlands while NOT animated (no CREATURE type tag) → Lands. The
 * partition reflects the permanent's <i>current</i> type tag, not
 * its base or printed type.
 *
 * <p>The function is pure — same input always yields the same
 * three arrays. Insertion order from the input is preserved within
 * each bucket (matches the engine's iteration order, which is the
 * source of truth for stack ordering / etc per the schema 1.30 wire
 * invariants).
 */
import type { WebPermanentView } from '../api/schemas';

export interface TabletopBuckets {
  readonly lands: readonly WebPermanentView[];
  readonly creatures: readonly WebPermanentView[];
  readonly artifactsEnchantments: readonly WebPermanentView[];
}

type Bucket = 'lands' | 'creatures' | 'artifactsEnchantments';

/**
 * Bucket placement for a single permanent based ONLY on its own
 * type tags. Used as the leaf decision in {@link partitionForTabletop}
 * AND as the host-resolution decision when re-bucketing an aura /
 * equipment to follow its host.
 */
function bucketByOwnType(perm: WebPermanentView): Bucket {
  const types = perm.card.types;
  if (types.includes('CREATURE')) return 'creatures';
  if (types.includes('PLANESWALKER')) return 'creatures';
  if (types.includes('LAND')) return 'lands';
  if (
    types.includes('ARTIFACT') ||
    types.includes('ENCHANTMENT') ||
    types.includes('BATTLE')
  ) {
    return 'artifactsEnchantments';
  }
  // Defensive default — a future engine type tag we don't know about
  // still appears somewhere instead of being dropped.
  return 'artifactsEnchantments';
}

export function partitionForTabletop(
  permanents: readonly WebPermanentView[],
): TabletopBuckets {
  // 2026-05-04 — attachment re-bucketing. Auras and equipment
  // that are attached to a host on the SAME battlefield route to
  // wherever the host went, so a creature with an aura renders
  // both in the creatures bucket (where TabletopBuckets' grouping
  // helper pairs them as host + attachments). Without this, auras
  // landed in the artifacts-enchantments bucket as disembodied
  // cards, disconnected from their host. Mirrors the legacy
  // `bucketBattlefield` re-bucketing in battlefieldRows.ts.
  // Auras attached to a permanent on a DIFFERENT battlefield
  // (enchant opponent) stay in the controller's artifacts bucket
  // — the host id won't be in the byId map for this player.
  const byId = new Map<string, WebPermanentView>(
    permanents.map((p) => [p.card.id, p]),
  );

  function rootBucket(perm: WebPermanentView): Bucket {
    let current = perm;
    const visited = new Set<string>();
    while (current.attachedTo && current.attachedToPermanent) {
      if (visited.has(current.card.id)) break;
      visited.add(current.card.id);
      const host = byId.get(current.attachedTo);
      if (!host) break;
      current = host;
    }
    return bucketByOwnType(current);
  }

  const lands: WebPermanentView[] = [];
  const creatures: WebPermanentView[] = [];
  const artifactsEnchantments: WebPermanentView[] = [];

  for (const perm of permanents) {
    const bucket = rootBucket(perm);
    if (bucket === 'lands') lands.push(perm);
    else if (bucket === 'creatures') creatures.push(perm);
    else artifactsEnchantments.push(perm);
  }

  return { lands, creatures, artifactsEnchantments };
}
