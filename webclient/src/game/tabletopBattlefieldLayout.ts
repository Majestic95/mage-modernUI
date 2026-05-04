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

export function partitionForTabletop(
  permanents: readonly WebPermanentView[],
): TabletopBuckets {
  const lands: WebPermanentView[] = [];
  const creatures: WebPermanentView[] = [];
  const artifactsEnchantments: WebPermanentView[] = [];

  for (const perm of permanents) {
    const types = perm.card.types;

    // Hybrid "creature wins" — any permanent currently carrying
    // the CREATURE type tag goes to Creatures, regardless of any
    // other types (artifact, enchantment, land, etc.) it also has.
    if (types.includes('CREATURE')) {
      creatures.push(perm);
      continue;
    }
    // Planeswalkers also go to Creatures (per element #4 spec)
    // because they share the attack/block affordance space.
    if (types.includes('PLANESWALKER')) {
      creatures.push(perm);
      continue;
    }
    // Lands AFTER the CREATURE check so animated manlands route to
    // Creatures while inanimate lands stay here.
    if (types.includes('LAND')) {
      lands.push(perm);
      continue;
    }
    // Artifacts, Enchantments, Battles all share this bucket.
    if (
      types.includes('ARTIFACT') ||
      types.includes('ENCHANTMENT') ||
      types.includes('BATTLE')
    ) {
      artifactsEnchantments.push(perm);
      continue;
    }
    // Unknown type tag — fall back to Artifacts-Enchantments rather
    // than dropping the permanent. Defensive: a future engine
    // upgrade with a new type tag won't make permanents disappear
    // from the rendering until tabletop's partition catches up.
    artifactsEnchantments.push(perm);
  }

  return { lands, creatures, artifactsEnchantments };
}
