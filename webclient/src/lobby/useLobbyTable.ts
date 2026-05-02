/**
 * Slice L2 — hook that polls the room's table listing every 5s and
 * returns the {@link WebTable} matching the given {@code tableId}.
 *
 * <p>Filters from the listing endpoint rather than calling a per-table
 * GET endpoint because the server doesn't expose one (per ADR 0006:
 * upstream is a singleton main lobby, listing is cheap, single-table
 * GET would be a new API). Slice L7 replaces this with a per-table
 * WebSocket stream.
 */
import { useEffect, useRef, useState } from 'react';
import { request, ApiError } from '../api/client';
import {
  webRoomRefSchema,
  webTableListingSchema,
  type WebRoomRef,
  type WebTable,
} from '../api/schemas';
import { useAuthStore } from '../auth/store';

const POLL_INTERVAL_MS = 5_000;

interface State {
  table: WebTable | null;
  error: string | null;
  /** {@code true} until the first poll completes (success or fail). */
  loading: boolean;
}

export function useLobbyTable(tableId: string): State {
  const session = useAuthStore((s) => s.session);
  const [room, setRoom] = useState<WebRoomRef | null>(null);
  const [state, setState] = useState<State>({
    table: null,
    error: null,
    loading: true,
  });
  const cancelledRef = useRef(false);

  // One-shot foundation load — discover the singleton main room ref.
  useEffect(() => {
    if (!session) return;
    cancelledRef.current = false;
    const token = session.token;
    void (async () => {
      try {
        const r = await request('/api/server/main-room', webRoomRefSchema, {
          token,
        });
        if (!cancelledRef.current) {
          setRoom(r);
        }
      } catch (err) {
        if (!cancelledRef.current) {
          setState({
            table: null,
            error: err instanceof ApiError ? err.message : 'Failed to load room.',
            loading: false,
          });
        }
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [session]);

  // Polling loop — fetches the table listing and selects the one
  // matching tableId. setTimeout chain (not setInterval) so a slow
  // request doesn't stack overlapping fetches.
  useEffect(() => {
    if (!session || !room || !tableId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const token = session.token;
    const path = `/api/rooms/${room.roomId}/tables`;

    const poll = async () => {
      try {
        const listing = await request(path, webTableListingSchema, { token });
        if (cancelled) return;
        const found = listing.tables.find((t) => t.tableId === tableId) ?? null;
        setState({
          table: found,
          error: found
            ? null
            : 'Table not found in the lobby listing — it may have been closed.',
          loading: false,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          table: null,
          error: err instanceof ApiError ? err.message : 'Failed to load table.',
          loading: false,
        });
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session, room, tableId]);

  return state;
}
