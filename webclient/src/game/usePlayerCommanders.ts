import { useGameStore } from './store';
import type { WebCommandObjectView, WebPlayerView } from '../api/schemas';
import { filterCommanders } from './commanderPredicates';

/**
 * Slice 70-X.14 (Wave A item 4 — Bug 4) — return the player's
 * commanders, surviving zone changes. Reads from the store's
 * accumulated {@code commanderSnapshots} (which retains any commander
 * ever seen in this game), falling back to the live
 * {@code player.commandList} for tests / pre-snapshot consumers /
 * non-commander formats where the snapshot may be empty.
 *
 * <p>Replaces the inline pattern
 * {@code player.commandList.find((co) => co.kind === 'commander')}
 * which empties when the commander leaves the command zone.
 *
 * <p>Returns an array (not a single entry) for Partner / Background
 * support — both commanders are present in the array when applicable.
 * Single-commander callers should read {@code [0]}.
 */
export function usePlayerCommanders(
  player: Pick<WebPlayerView, 'playerId' | 'commandList'>,
): WebCommandObjectView[] {
  // Defensive read — tests that mock the store with a stripped-down
  // shape (e.g. GameLog.test.tsx) don't include commanderSnapshots,
  // so guard against the field being undefined entirely.
  const snapshot = useGameStore(
    (s) => s.commanderSnapshots?.[player.playerId],
  );
  if (snapshot && snapshot.length > 0) {
    return snapshot;
  }
  // Fallback: live commandList filtered to commander entries. Used by
  // tests that mount a frame without going through applyFrame, by
  // non-commander formats, and by the first-frame seed before the
  // snapshot is populated.
  return filterCommanders(player.commandList);
}
