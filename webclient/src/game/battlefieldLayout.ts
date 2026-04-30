import type { WebPlayerView } from '../api/schemas';
import { KEEP_ELIMINATED } from '../featureFlags';

/**
 * Slice 69b (ADR 0010 v2 D11a) → 70-D (ADR 0011 D2, **amended**) —
 * pick the opponent seats to render. Drops the local player; the
 * {@code hasLeft} (eliminated) filter is now feature-flagged.
 *
 * <p>When {@link KEEP_ELIMINATED} is {@code false} (default — slice
 * 70-D ships behind the flag, slice 70-E flips it):
 * legacy behavior — eliminated opponents are dropped from the
 * layout. The {@code formatEliminationAnnouncement} aria-live
 * announcer below still fires so blind users get the signal that
 * was otherwise lost to layout collapse.
 *
 * <p>When {@link KEEP_ELIMINATED} is {@code true}: eliminated
 * opponents are KEPT in the layout. {@code PlayerFrame} renders the
 * elimination slash + permanent fade overlay against the kept seat
 * (per design-system §7.3 / spec screenshot precedent). The
 * announcer is silenced (the slash + persona aria-label convey the
 * same signal visually + via SR) — see
 * {@link #formatEliminationAnnouncement} below.
 *
 * <p>Order is preserved (turn order from upstream).
 */
export function selectOpponents(
  players: WebPlayerView[],
  myPlayerId: string,
): WebPlayerView[] {
  if (KEEP_ELIMINATED) {
    return players.filter((p) => p.playerId !== myPlayerId);
  }
  return players.filter((p) => p.playerId !== myPlayerId && !p.hasLeft);
}

/**
 * Slice 69d (ADR 0010 v2 D11a + D13) → 70-D (ADR 0011 D2 amended) —
 * aria-live announcement for eliminated players. Returns the empty
 * string under either of these conditions:
 *
 * <ul>
 *   <li>No player has {@code hasLeft=true}</li>
 *   <li>{@link KEEP_ELIMINATED} is on — the kept seat's
 *       {@code PlayerFrame} aria-label ("alice, 0 life, eliminated")
 *       conveys the same signal once at the seat level, and the
 *       slash overlay carries the visual cue. Double-firing produces
 *       SR spam.</li>
 * </ul>
 *
 * <p>Returns {@code "Eliminated: <names>"} when the legacy
 * layout-drop is in effect (flag off) AND one or more players have
 * left — that's the only path where the layout collapse leaves
 * blind users with no cue.
 */
export function formatEliminationAnnouncement(
  players: WebPlayerView[],
): string {
  if (KEEP_ELIMINATED) {
    return '';
  }
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
