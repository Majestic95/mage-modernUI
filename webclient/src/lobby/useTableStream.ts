/**
 * Slice L7 — WebSocket stream for a single lobby table. Replaces
 * {@link useLobbyTable}'s 5s polling with push-based updates: ready
 * toggles, deck swaps, seat join/leave, and settings PATCH all
 * propagate &lt;100ms.
 *
 * <p>Wire shape: server pushes {@link WebStreamFrame}s with
 * {@code method = 'tableUpdate'} and {@code data = WebTable}. We
 * parse incoming frames through the existing schemas, replace the
 * cached table, and re-render.
 *
 * <p>Reconnect strategy: bounded exponential backoff with a 30s cap.
 * Falls back to a final 5s polling tick on hard failure so a busted
 * tunnel still gives the user *some* state, just delayed. The
 * fallback also kicks in when the auth gate or close codes (4404
 * "table not found") indicate a permanent failure — at that point
 * we show an error state and stop trying.
 */
import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from '../api/client';
import {
  webStreamFrameSchema,
  webTableListingSchema,
  webTableSchema,
  type WebRoomRef,
  type WebTable,
  webRoomRefSchema,
} from '../api/schemas';
import { useAuthStore } from '../auth/store';

interface State {
  table: WebTable | null;
  error: string | null;
  loading: boolean;
  /**
   * Slice L8 review fix — true when the WS hit a permanent close
   * code (4404 table-not-found, 4001 auth, 4003 visibility/origin).
   * The lobby renders a "Return to main menu" affordance instead of
   * leaving the user stuck staring at "Table closed." with no way
   * out. The activeLobbyId in localStorage still points at the dead
   * table on reload; the parent's onLeave clears it.
   */
  permanentFailure: boolean;
}

const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const FALLBACK_POLL_MS = 5_000;

const httpBase = (
  (import.meta.env['VITE_XMAGE_WEBAPI_URL'] as string | undefined) ??
  ''
).replace(/\/+$/, '');

function toWsBase(http: string): string {
  if (http.startsWith('https://')) return 'wss://' + http.slice('https://'.length);
  if (http.startsWith('http://')) return 'ws://' + http.slice('http://'.length);
  return 'ws://' + http;
}

const wsBase = toWsBase(httpBase);

export function useTableStream(tableId: string): State {
  const session = useAuthStore((s) => s.session);
  const [room, setRoom] = useState<WebRoomRef | null>(null);
  const [state, setState] = useState<State>({
    table: null,
    error: null,
    loading: true,
    permanentFailure: false,
  });

  // Resolve the room once. Same one-shot as useLobbyTable.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await request('/api/server/main-room', webRoomRefSchema, {
          token: session.token,
        });
        if (!cancelled) setRoom(r);
      } catch (err) {
        if (!cancelled) {
          setState({
            table: null,
            error: err instanceof ApiError ? err.message : 'Failed to load room.',
            loading: false,
            permanentFailure: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  // The actual WS connect + reconnect loop runs once per session/
  // room/tableId triple. Refs hold the live socket + backoff state
  // so the cleanup can tear them down without re-subscribing.
  const socketRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(BACKOFF_INITIAL_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!session || !room || !tableId) return;
    stoppedRef.current = false;
    backoffRef.current = BACKOFF_INITIAL_MS;
    const token = session.token;
    const url =
      `${wsBase}/api/rooms/${room.roomId}/tables/${tableId}/stream`
      + `?token=${encodeURIComponent(token)}`;

    function startFallbackPoll() {
      // Only fires on hard WS failure paths. Same listing-filter shape
      // as useLobbyTable so the lobby still shows *something* while the
      // user tries to reconnect by reloading.
      const tick = async () => {
        try {
          const listing = await request(
            `/api/rooms/${room!.roomId}/tables`,
            webTableListingSchema,
            { token },
          );
          if (stoppedRef.current) return;
          const found =
            listing.tables.find((t) => t.tableId === tableId) ?? null;
          setState({
            table: found,
            error: found
              ? '(reconnecting...)'
              : 'Table not found in the lobby listing — it may have been closed.',
            loading: false,
            permanentFailure: false,
          });
        } catch {
          if (stoppedRef.current) return;
          // Swallow — keep retrying.
        } finally {
          if (!stoppedRef.current) {
            fallbackTimerRef.current = setTimeout(tick, FALLBACK_POLL_MS);
          }
        }
      };
      void tick();
    }

    function clearFallback() {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    }

    function scheduleReconnect() {
      if (stoppedRef.current) return;
      const delay = Math.min(BACKOFF_MAX_MS, backoffRef.current);
      backoffRef.current = Math.min(BACKOFF_MAX_MS, backoffRef.current * 2);
      reconnectTimerRef.current = setTimeout(connect, delay);
    }

    function connect() {
      if (stoppedRef.current) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'WebSocket open failed',
          loading: false,
        }));
        startFallbackPoll();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        backoffRef.current = BACKOFF_INITIAL_MS;
        clearFallback();
      };

      socket.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        if (!raw) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }
        const frameResult = webStreamFrameSchema.safeParse(parsed);
        if (!frameResult.success) return;
        const frame = frameResult.data;
        if (frame.method !== 'tableUpdate') return;
        const tableResult = webTableSchema.safeParse(frame.data);
        if (!tableResult.success) return;
        setState({
          table: tableResult.data,
          error: null,
          loading: false,
          permanentFailure: false,
        });
      };

      socket.onclose = (ev) => {
        socketRef.current = null;
        // Permanent failure codes — stop reconnecting. 4404 means the
        // table got removed; auth codes mean the token is bad.
        if (ev.code === 4404) {
          setState({
            table: null,
            error: 'Table closed.',
            loading: false,
            permanentFailure: true,
          });
          stoppedRef.current = true;
          return;
        }
        if (ev.code === 4001 || ev.code === 4003) {
          setState({
            table: null,
            error: 'Connection rejected: ' + (ev.reason || 'auth failed'),
            loading: false,
            permanentFailure: true,
          });
          stoppedRef.current = true;
          return;
        }
        if (stoppedRef.current) return;
        scheduleReconnect();
      };

      socket.onerror = () => {
        // onerror always fires before onclose; let onclose drive the
        // reconnect to avoid double-scheduling.
      };
    }

    connect();

    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      clearFallback();
      const sock = socketRef.current;
      if (sock) {
        socketRef.current = null;
        try {
          sock.close(1000, 'cleanup');
        } catch {
          // best-effort
        }
      }
    };
  }, [session, room, tableId]);

  return state;
}
