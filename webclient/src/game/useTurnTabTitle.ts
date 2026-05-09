import { useEffect } from 'react';
import { useGameStore } from './store';

/**
 * Browser-tab title indicator. When the local player has priority
 * (engine is waiting on them), the document title flips to a "Your
 * turn" prefix so a player who has tabbed away to another tab sees
 * the change in the browser tab bar.
 *
 * <p>Reverts to the captured original title (set by index.html / any
 * upstream code) when priority leaves OR the hook unmounts. We
 * capture the original on first mount instead of hardcoding a
 * fallback so a future tab-title rewrite (e.g., per-game name) keeps
 * working seamlessly.
 *
 * <p>Per user direction 2026-05-09: helps players who are missing
 * their own turns because they've tabbed away during a long opponent
 * turn or AI think-time. Pairs with the priority audio chime
 * (audioSettingsStore default flipped to ON) and the
 * {@link PriorityEdgeGlow} on-screen ring.
 */
const PRIORITY_PREFIX = '🎲 Your turn — ';

export function useTurnTabTitle(): void {
  const hasPriority = useGameStore((s) => {
    const gv = s.gameView;
    if (!gv) return false;
    const me = gv.players.find((p) => p.playerId === gv.myPlayerId);
    return !!me?.hasPriority;
  });
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.title;
    if (hasPriority) {
      // Avoid double-prefixing if some other code swapped titles.
      if (!original.startsWith(PRIORITY_PREFIX)) {
        document.title = PRIORITY_PREFIX + original;
      }
    }
    return () => {
      // Cleanup on unmount OR before next effect run (when
      // hasPriority flips). Restore the captured original so the
      // tab title doesn't permanently carry the prefix.
      if (typeof document === 'undefined') return;
      if (document.title.startsWith(PRIORITY_PREFIX)) {
        document.title = document.title.slice(PRIORITY_PREFIX.length);
      }
    };
  }, [hasPriority]);
}
