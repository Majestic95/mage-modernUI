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
 *
 * <p>Slice 70-Y / Bug 3 — attachments re-locate to their host's row.
 * An aura attached to a creature normally classifies as
 * {@code artifacts} (enchantment), but visually it should travel
 * with the creature on the battlefield. Pass 2 re-buckets any perm
 * with {@code attachedTo} pointing to a host present in the same
 * battlefield. The host's row is the destination. When the host
 * isn't present (cross-controller / mid-resolve race / wire blip),
 * the perm falls back to its own type-based row.
 */
export function bucketBattlefield(
  permanents: WebPermanentView[],
): Record<BattlefieldRow, WebPermanentView[]> {
  const buckets: Record<BattlefieldRow, WebPermanentView[]> = {
    creatures: [],
    artifacts: [],
    lands: [],
  };
  const permById = new Map<string, WebPermanentView>();
  for (const perm of permanents) {
    permById.set(perm.card.id, perm);
  }
  for (const perm of permanents) {
    let row = classifyPermanent(perm);
    if (perm.attachedTo) {
      const host = permById.get(perm.attachedTo);
      if (host) {
        row = classifyPermanent(host);
      }
    }
    buckets[row].push(perm);
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

/**
 * Slice 70-Y / Bug 3 — host-with-attachments grouping for a single
 * row. Pairs each "main" permanent (not attached, OR attached to a
 * permanent NOT in this row) with the list of permanents attached to
 * it that ARE in this row. Caller renders each entry as a visual
 * group (stacked-on-host or adjacent-to-host per the user setting).
 *
 * <p>Order: main permanents preserve their input order; each main's
 * attachments preserve THEIR input order. Detached permanents (any
 * with {@code attachedTo} pointing to a perm not in this row) appear
 * as standalone entries — same as if they had no attachment.
 *
 * <p>Pure function. No engine logic; just a data-shape transform
 * driven by the wire's {@code attachedTo} field.
 */
export interface AttachmentGroup {
  readonly host: WebPermanentView;
  readonly attachments: readonly WebPermanentView[];
}

export function groupWithAttachments(
  perms: readonly WebPermanentView[],
): AttachmentGroup[] {
  const inRow = new Map<string, WebPermanentView>();
  for (const p of perms) inRow.set(p.card.id, p);

  // Pre-compute attachments: for each host id (in this row), list of
  // perms (in this row) attached to it. Preserves attachment input
  // order so multiple auras on one host stay in stable order.
  const attachmentsByHost = new Map<string, WebPermanentView[]>();
  const attachedIds = new Set<string>();
  for (const p of perms) {
    if (!p.attachedTo) continue;
    if (!inRow.has(p.attachedTo)) continue;
    attachedIds.add(p.card.id);
    const list = attachmentsByHost.get(p.attachedTo) ?? [];
    list.push(p);
    attachmentsByHost.set(p.attachedTo, list);
  }

  const out: AttachmentGroup[] = [];
  for (const p of perms) {
    if (attachedIds.has(p.card.id)) continue; // rendered under its host
    out.push({
      host: p,
      attachments: attachmentsByHost.get(p.card.id) ?? [],
    });
  }
  return out;
}

/**
 * Slice 70-Y / Issue (2026-05-01) — collapse functionally identical
 * permanents into a single visual stack to save board real estate.
 *
 * <p>Use cases (per playtest 2026-05-01):
 * <ul>
 *   <li>Multiple basic lands of the same name (5 Forests).</li>
 *   <li>Multiple identical tokens (3 1/1 Goblin tokens).</li>
 * </ul>
 *
 * <p>Stack key = name + set + cardNumber + tapped state. Permanents
 * with state-divergent properties never stack:
 * <ul>
 *   <li>has attachments (auras / equipment) → renders with its
 *     own attachment fan, not stackable</li>
 *   <li>is itself attached → already rendered under its host</li>
 *   <li>damage marked > 0</li>
 *   <li>any non-zero counter</li>
 *   <li>goading state (any goading player)</li>
 *   <li>summoning sickness differs</li>
 * </ul>
 *
 * <p>Returns null stack-key for any non-stackable perm; the caller
 * treats those as singletons. For stackable perms, the FIRST perm
 * with a given key becomes the "front" of the stack and accumulates
 * the others as {@code stackedDuplicates}.
 *
 * <p>This is a DEFENSIVE CONSERVATIVE rule. When in doubt, don't
 * stack — board state ambiguity is worse than wasted space.
 */
export interface StackedGroup {
  /** The "front" permanent of the visual stack (top of z-axis). */
  readonly host: WebPermanentView;
  /** Other identical perms behind the front. Empty for singletons. */
  readonly stackedDuplicates: readonly WebPermanentView[];
  /** Auras / equipment from groupWithAttachments. Empty if none. */
  readonly attachments: readonly WebPermanentView[];
}

function stackKey(perm: WebPermanentView): string | null {
  if (perm.attachedTo) return null;
  if (perm.attachments && perm.attachments.length > 0) return null;
  if (perm.damage > 0) return null;
  const counterTotals = Object.values(perm.card.counters ?? {});
  if (counterTotals.some((n) => n > 0)) return null;
  if ((perm.goadingPlayerIds ?? []).length > 0) return null;
  return [
    perm.card.name,
    perm.card.expansionSetCode,
    perm.card.cardNumber,
    perm.tapped ? 'T' : 'U',
    perm.summoningSickness ? 'S' : 'N',
  ].join('|');
}

/**
 * Combine attachment grouping + identical-perm stacking. Pipes:
 * {@code groupWithAttachments → stackIdenticalGroups}.
 *
 * <p>An AttachmentGroup whose host is stackable AND has no
 * attachments can merge with sibling groups sharing the same
 * stackKey. Groups WITH attachments stay as singletons regardless
 * (they're visually distinct already).
 */
export function groupWithAttachmentsAndStacks(
  perms: readonly WebPermanentView[],
): StackedGroup[] {
  const groups = groupWithAttachments(perms);
  const out: StackedGroup[] = [];
  // Map keys → index into `out` so subsequent identical perms append
  // to the existing entry's stackedDuplicates.
  const keyToIdx = new Map<string, number>();
  for (const g of groups) {
    if (g.attachments.length > 0) {
      // Has attachments → never stacks; render alone.
      out.push({
        host: g.host,
        stackedDuplicates: [],
        attachments: g.attachments,
      });
      continue;
    }
    const key = stackKey(g.host);
    if (key === null) {
      out.push({ host: g.host, stackedDuplicates: [], attachments: [] });
      continue;
    }
    const existingIdx = keyToIdx.get(key);
    if (existingIdx === undefined) {
      const idx = out.length;
      keyToIdx.set(key, idx);
      out.push({ host: g.host, stackedDuplicates: [], attachments: [] });
    } else {
      const existing = out[existingIdx];
      out[existingIdx] = {
        host: existing.host,
        stackedDuplicates: [...existing.stackedDuplicates, g.host],
        attachments: existing.attachments,
      };
    }
  }
  return out;
}
