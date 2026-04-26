import { useEffect, useState, useCallback } from 'react';
import { ApiError, request } from '../api/client';
import {
  webRoomRefSchema,
  webServerStateSchema,
  webTableListingSchema,
  type WebRoomRef,
  type WebServerState,
  type WebTableListing,
} from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { CreateTableModal } from './CreateTableModal';

const POLL_INTERVAL_MS = 5_000;

/**
 * Lobby — discovers the singleton main room once, fetches server state
 * for create-table dropdowns, polls the table list every 5 s. Hosts
 * the create-table modal when the user clicks "Create".
 */
export function Lobby() {
  const session = useAuthStore((s) => s.session);
  const [room, setRoom] = useState<WebRoomRef | null>(null);
  const [serverState, setServerState] = useState<WebServerState | null>(null);
  const [listing, setListing] = useState<WebTableListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const requestImmediateRefresh = useCallback(() => {
    setPollNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }
    const token = session.token;
    let cancelled = false;

    const loadFoundation = async () => {
      try {
        const [r, s] = await Promise.all([
          request('/api/server/main-room', webRoomRefSchema, { token }),
          request('/api/server/state', webServerStateSchema, { token }),
        ]);
        if (!cancelled) {
          setRoom(r);
          setServerState(s);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load lobby.');
        }
      }
    };

    void loadFoundation();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !room) {
      return;
    }
    const token = session.token;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchTables = async () => {
      try {
        const result = await request(
          `/api/rooms/${room.roomId}/tables`,
          webTableListingSchema,
          { token },
        );
        if (cancelled) {
          return;
        }
        setListing(result);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to load tables.');
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchTables, POLL_INTERVAL_MS);
        }
      }
    };

    void fetchTables();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [session, room, pollNonce]);

  if (!room) {
    return (
      <p className="text-zinc-400">Loading lobby…</p>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold">Tables</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            Room <code>{room.roomId.slice(0, 8)}…</code>
            &nbsp;·&nbsp;
            {listing?.tables.length ?? 0} active
          </span>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!serverState}
            className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded px-3 py-1.5"
          >
            + Create table
          </button>
        </div>
      </header>

      {createOpen && serverState && (
        <CreateTableModal
          roomId={room.roomId}
          serverState={serverState}
          onClose={() => setCreateOpen(false)}
          onCreated={requestImmediateRefresh}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      {listing && listing.tables.length === 0 && (
        <p className="text-zinc-500 italic">No active tables. Be the first.</p>
      )}

      {listing && listing.tables.length > 0 && (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded">
          {listing.tables.map((t) => (
            <li key={t.tableId} className="p-3 flex items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <p className="font-medium truncate">{t.tableName}</p>
                <p className="text-xs text-zinc-400 truncate">
                  {t.gameType} · {t.deckType} · {t.controllerName}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm">
                  <span className={stateColor(t.tableState)}>{t.tableState}</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {t.seats.filter((s) => s.occupied).length}/{t.seats.length} seated
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function stateColor(state: string): string {
  switch (state) {
    case 'WAITING':
      return 'text-emerald-400';
    case 'READY_TO_START':
      return 'text-amber-400';
    case 'STARTING':
    case 'DUELING':
      return 'text-fuchsia-400';
    case 'FINISHED':
      return 'text-zinc-500';
    default:
      return 'text-zinc-300';
  }
}
