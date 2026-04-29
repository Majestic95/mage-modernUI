import type { WebPlayerView } from '../api/schemas';

/**
 * Slice 69b (ADR 0010 v2 D11a) — pick the opponent seats to render in
 * the opponents row. Drops the local player AND any eliminated
 * (`hasLeft`) opponent. v2 keeps this simple: an eliminated seat
 * disappears from layout entirely. The collapsed-stub variant
 * (name + final state, no glow, retained chat history) is tracked
 * for slice 69d polish — until then, the layout collapse is the
 * unambiguous visual signal of "this player is out."
 *
 * Order is preserved (turn order from upstream).
 */
export function selectOpponents(
  players: WebPlayerView[],
  myPlayerId: string,
): WebPlayerView[] {
  return players.filter((p) => p.playerId !== myPlayerId && !p.hasLeft);
}

/**
 * Slice 69d (ADR 0010 v2 D11a + D13) — elimination announcement text
 * for the Battlefield's secondary ARIA-live region. Returns the
 * empty string when no player has left (so the live region's
 * aria-atomic boundary doesn't fire). Returns "Eliminated: <names>"
 * when one or more players have `hasLeft=true`. Names use the
 * player's display name; missing names fall back to "unknown" rather
 * than crashing the announcement.
 *
 * <p>The visual surface (slice 69b's `selectOpponents` filter) drops
 * eliminated PlayerAreas from the layout entirely. Blind users would
 * otherwise have no cue that the game changed shape — this announcer
 * fills that gap.
 */
export function formatEliminationAnnouncement(
  players: WebPlayerView[],
): string {
  const leavers = players.filter((p) => p.hasLeft);
  if (leavers.length === 0) {
    return '';
  }
  return (
    'Eliminated: ' +
    leavers.map((p) => p.name || 'unknown').join(', ')
  );
}

/**
 * Slice 69b (ADR 0010 v2 D5) — opponent-row layout classname for N
 * players. Pure helper, kept in its own module so Battlefield.tsx can
 * stay component-only (react-refresh requires that to fast-reload
 * cleanly).
 *
 *   - 0 / 1 opponents: vertical stack (1v1 unchanged from pre-69b).
 *   - 2 opponents:     2-col grid (3p FFA, 2HG opp row).
 *   - 3+ opponents:    3-col grid (4p FFA + headroom for v3 5p+
 *                      formats — falls through rather than throwing
 *                      so an unsupported server-side format renders
 *                      sanely instead of crashing the page).
 *
 * Asymmetric grid-template-areas (12-o'clock / 9 / 3) for table-feel
 * is deferred to v3 polish per ADR D5 consequences.
 *
 * The base classes (flex-shrink-0, border-b, p-4) form the contract
 * the parent flex layout depends on; every branch carries them.
 */
export function opponentRowClassname(opponentCount: number): string {
  if (opponentCount <= 1) {
    return 'flex-shrink-0 border-b border-zinc-800 p-4 space-y-4';
  }
  if (opponentCount === 2) {
    return 'flex-shrink-0 border-b border-zinc-800 p-4 grid grid-cols-2 gap-4';
  }
  return 'flex-shrink-0 border-b border-zinc-800 p-4 grid grid-cols-3 gap-4';
}
