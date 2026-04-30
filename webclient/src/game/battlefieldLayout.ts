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
 * Slice 70-E (ADR 0011 D5) — replaces the slice-69b
 * {@code opponentRowClassname} flat-row helper with a grid-area
 * lookup. The new GameTable shell positions opponents at TOP / LEFT
 * / RIGHT positions of the battlefield grid (self stays at BOTTOM)
 * per design-system §3 / screens-game-table-commander-4p.md §2.
 *
 * <p>Mapping by opponent index (preserves the slice 69b clockwise
 * convention from {@code Battlefield.tsx:289-294} — opp-right (idx 0)
 * → opp-top (idx 1) → opp-left (idx 2) for 4p FFA):
 *
 * <ul>
 *   <li>1 opponent (1v1) → {@code top}</li>
 *   <li>2 opponents (3p FFA) → idx 0: {@code right}, idx 1: {@code top}
 *       (cross-table read: your opponent on the right + the third
 *       opposite — natural FFA flow)</li>
 *   <li>3 opponents (4p FFA) → idx 0: {@code right}, idx 1: {@code top},
 *       idx 2: {@code left}</li>
 *   <li>4+ opponents (5p+ — engine supports up to 10) → fall back to
 *       {@code top} for any overflow index. Spec only locks 4p; 5p+
 *       gets a degraded grid-area assignment until a future ADR
 *       defines the layout. Renders sanely; doesn't crash.</li>
 * </ul>
 *
 * <p>Pure helper, kept in its own module so Battlefield.tsx can stay
 * component-only (react-refresh requires that to fast-reload).
 */
export type OpponentGridArea = 'top' | 'left' | 'right';

export function gridAreaForOpponent(
  idx: number,
  count: number,
): OpponentGridArea {
  if (count <= 1) {
    return 'top';
  }
  if (count === 2) {
    return idx === 0 ? 'right' : 'top';
  }
  // 3+ opponents — full clockwise rotation. idx 3+ overflow falls
  // back to 'top' (sane render for unsupported 5p+ formats).
  if (idx === 0) return 'right';
  if (idx === 1) return 'top';
  if (idx === 2) return 'left';
  return 'top';
}
