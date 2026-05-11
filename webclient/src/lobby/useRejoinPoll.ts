import { useEffect, useState } from 'react';
import { request } from '../api/client';
import { webMyGamesResponseSchema, type WebMyGame } from '../api/schemas';

interface Args {
  /** Auth token; null disables polling. */
  token: string | null | undefined;
  /**
   * When false, polling is skipped entirely and the returned list is
   * always empty. Used by callers that don't wire a rejoin handler —
   * the banner is hidden, so the network round-trip is waste.
   */
  enabled: boolean;
  /**
   * Bumping this triggers an immediate refresh (a new effect cycle).
   * Matches the existing {@code pollNonce} pattern in {@code Lobby.tsx}'s
   * tables-list poll so the two lists refresh together on user actions.
   */
  refreshKey: number;
  /** Poll interval in ms. Should match the tables-list cadence. */
  intervalMs: number;
}

/**
 * Polls {@code GET /api/games/mine} at the supplied cadence and
 * returns the list of games the authenticated user can rejoin. Errors
 * are swallowed silently and the list resets to empty (fail-closed) —
 * the rejoin surface is enhancement, not a feature whose failure
 * should surface a red error string to the lobby.
 *
 * <p>Extracted from {@code Lobby.tsx} in slice REJOIN-A to keep the
 * page component under the project's 500 LOC hard cap. The state and
 * effect together are ~50 LOC; isolating them here also makes them
 * trivially mockable in tests.
 */
export function useRejoinPoll({
  token,
  enabled,
  refreshKey,
  intervalMs,
}: Args): ReadonlyArray<WebMyGame> {
  const [rejoinable, setRejoinable] = useState<ReadonlyArray<WebMyGame>>([]);

  useEffect(() => {
    if (!token || !enabled) {
      // Banner hidden ⇒ no need to poll.
      setRejoinable([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchRejoinable = async () => {
      try {
        const result = await request(
          '/api/games/mine',
          webMyGamesResponseSchema,
          { token },
        );
        if (cancelled) return;
        setRejoinable(result.games);
      } catch {
        if (cancelled) return;
        setRejoinable([]);
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchRejoinable, intervalMs);
        }
      }
    };

    void fetchRejoinable();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [token, enabled, refreshKey, intervalMs]);

  return rejoinable;
}
