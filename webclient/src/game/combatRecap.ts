import type { WebCombatGroupView } from '../api/schemas';

/**
 * Bundle 3-D (2026-05-09) — staged-action recap helpers.
 *
 * <p>Pure functions over the wire's {@code combat: WebCombatGroupView[]}
 * field. Build a flat, deduplicated list of staged attacker / blocker
 * names so the banner can render a one-line "what am I committing to"
 * summary above its Done button. The helpers are split out from
 * CombatBanner.tsx because they're pure and benefit from
 * fixture-driven unit tests; the banner just consumes the formatted
 * string.
 *
 * <p><b>Why staged actions live on the wire:</b> declare-attackers /
 * declare-blockers clicks round-trip through the engine via
 * {@code sendObjectClick} (clickRouter.ts:144-152), and the engine
 * re-emits a fresh {@code gameView} after every toggle. So
 * {@code gameView.combat} is the source of truth for "what have I
 * staged"; no client-side selection tracker is needed.
 *
 * <p><b>Attacker dedup:</b> attackers can appear across multiple
 * combat groups when the engine groups by defender (one group per
 * defender player + one per attacked planeswalker). We dedupe by
 * permanent id, not by name — a player can have two creatures of
 * the same name and we want both to count.
 *
 * <p><b>Blocker copy:</b> within a group, blockers are typically
 * assigned to a specific attacker. The wire schema doesn't expose
 * that per-blocker pairing today (group-level mapping only), so the
 * recap pairs each blocker with the FIRST attacker in the group as
 * a best-effort. This is a UI approximation; the engine still
 * resolves the actual block assignment correctly.
 */

const RECAP_HEAD_LIMIT = 4;

function nameOf(permanent: {
  card: { name: string; displayName: string };
}): string {
  return permanent.card.displayName || permanent.card.name;
}

export function buildAttackerRecap(
  combat: ReadonlyArray<WebCombatGroupView>,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const group of combat) {
    for (const [permanentId, permanent] of Object.entries(group.attackers)) {
      if (seen.has(permanentId)) continue;
      seen.add(permanentId);
      names.push(nameOf(permanent));
    }
  }
  return names;
}

export function buildBlockerRecap(
  combat: ReadonlyArray<WebCombatGroupView>,
): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const group of combat) {
    const attackerNames = Object.values(group.attackers).map(nameOf);
    for (const [permanentId, blocker] of Object.entries(group.blockers)) {
      if (seen.has(permanentId)) continue;
      seen.add(permanentId);
      const blockerName = nameOf(blocker);
      const target = attackerNames[0];
      entries.push(target ? `${blockerName} blocks ${target}` : blockerName);
    }
  }
  return entries;
}

export function formatRecap(items: string[], unit: 'attacker' | 'blocker'): string {
  if (items.length === 0) return '';
  const head = items.slice(0, RECAP_HEAD_LIMIT);
  const overflow = items.length - RECAP_HEAD_LIMIT;
  const summary = `${items.length} ${unit}${items.length === 1 ? '' : 's'}`;
  const tail =
    overflow > 0 ? `${head.join(', ')}, +${overflow} more` : head.join(', ');
  return `${summary} — ${tail}`;
}
