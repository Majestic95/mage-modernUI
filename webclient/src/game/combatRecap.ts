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
 * <p><b>Local-player filter (A.6, 2026-05-09):</b> recap shows only
 * the LOCAL player's attackers and blockers. Filter is by
 * {@code permanent.controllerName === myName} because
 * {@code WebPermanentView} doesn't carry {@code controllerId} on the
 * wire today (only name); duplicate-name seats are an edge case the
 * engine prevents at the lobby boundary, so name comparison is safe.
 *
 * <p><b>Attacker dedup:</b> attackers can appear across multiple
 * combat groups when the engine groups by defender. We dedupe by
 * permanent id, not by name — a player can have two creatures of
 * the same name and we want both to count.
 *
 * <p><b>Blocker copy (B.6, 2026-05-09):</b> the wire schema doesn't
 * expose per-blocker pairing today — blockers are listed at the
 * group level, not assigned to a specific attacker. So the recap
 * only writes "X blocks Y" when the group has exactly one attacker
 * (unambiguous pairing). Multi-attacker groups render bare blocker
 * names so we never assert a wrong assignment.
 *
 * <p><b>Empty + overflow copy (A.1, A.3, 2026-05-09):</b>
 * {@link formatRecap} returns passive prose ("No attackers chosen")
 * for the empty case rather than the empty string, so the banner
 * can render the row unconditionally (callers no longer gate on
 * {@code recapText.length}). Overflow uses "…and N more" with the
 * U+2026 ellipsis character to match the brief's prescribed copy.
 */

const RECAP_HEAD_LIMIT = 4;

function nameOf(permanent: {
  card: { name: string; displayName: string };
}): string {
  return permanent.card.displayName || permanent.card.name;
}

export function buildAttackerRecap(
  combat: ReadonlyArray<WebCombatGroupView>,
  myName: string,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const group of combat) {
    for (const [permanentId, permanent] of Object.entries(group.attackers)) {
      if (seen.has(permanentId)) continue;
      // A.6 — only the local player's attackers. When myName is
      // empty (gameView not yet hydrated), filter out everything so
      // the empty-state copy fires from formatRecap.
      if (permanent.controllerName !== myName) continue;
      seen.add(permanentId);
      names.push(nameOf(permanent));
    }
  }
  return names;
}

export function buildBlockerRecap(
  combat: ReadonlyArray<WebCombatGroupView>,
  myName: string,
): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const group of combat) {
    const attackerNames = Object.values(group.attackers).map(nameOf);
    // B.6 — only assert "blocks X" when the group has exactly one
    // attacker (unambiguous pairing). Multi-attacker groups don't
    // expose per-blocker assignment on the wire, so we render bare
    // blocker names instead of guessing.
    const unambiguousTarget =
      attackerNames.length === 1 ? attackerNames[0] : undefined;
    for (const [permanentId, blocker] of Object.entries(group.blockers)) {
      if (seen.has(permanentId)) continue;
      if (blocker.controllerName !== myName) continue;
      seen.add(permanentId);
      const blockerName = nameOf(blocker);
      entries.push(
        unambiguousTarget
          ? `${blockerName} blocks ${unambiguousTarget}`
          : blockerName,
      );
    }
  }
  return entries;
}

export function formatRecap(
  items: string[],
  unit: 'attacker' | 'blocker',
): string {
  if (items.length === 0) {
    return `No ${unit}s chosen`;
  }
  const head = items.slice(0, RECAP_HEAD_LIMIT);
  const overflow = items.length - RECAP_HEAD_LIMIT;
  const summary = `${items.length} ${unit}${items.length === 1 ? '' : 's'}`;
  const tail =
    overflow > 0
      ? `${head.join(', ')}, …and ${overflow} more`
      : head.join(', ');
  return `${summary} — ${tail}`;
}
