import { useEffect, useState, useCallback } from 'react';
import { ApiError, request } from '../api/client';
import {
  webRoomRefSchema,
  webServerStateSchema,
  webTableListingSchema,
  type WebRoomRef,
  type WebServerState,
  type WebTable,
  type WebTableListing,
} from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { PreLobbyModal } from '../lobby/PreLobbyModal';
import { PasswordPromptModal } from './PasswordPromptModal';

const POLL_INTERVAL_MS = 5_000;

interface Props {
  /**
   * Slice L4 — when set, the lobby's "+ Create table" button opens
   * the slim {@link PreLobbyModal} and routes the resulting tableId
   * into the new full-page lobby screen. Without this prop the
   * button still works but the legacy table-list flow is the only
   * post-create state.
   *
   * <p>2026-05-02 (post-L9 polish) — guests Join the same way: clicking
   * Join on a non-passworded table calls this directly with no deck
   * pre-pick, mirroring the host's PreLobbyModal flow. They pick deck
   * inside the lobby. Passworded tables route through a slim password
   * modal first; the entered password is threaded as the second arg
   * so the lobby's first {@code PUT /seat/deck} can include it.
   */
  onEnterLobby?: (tableId: string, joinPassword?: string) => void;
}

/**
 * Lobby — discovers the singleton main room once, fetches server state
 * for create-table dropdowns, polls the table list every 5 s. Hosts
 * the create-table modal when the user clicks "Create".
 */
export function Lobby({ onEnterLobby }: Props = {}) {
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

  const [joinTarget, setJoinTarget] = useState<WebTable | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Audit fix (HIGH #2) — in-flight tableId for the Join action.
  // Without this, double-click on Join fired onEnterLobby twice;
  // PasswordPromptModal could re-mount overtop itself, and the
  // non-passworded path triggered two routings + two refresh
  // requests in rapid succession.
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const onLeave = useCallback(
    async (table: WebTable) => {
      if (!session || !room) return;
      setActionError(null);
      try {
        await request(
          `/api/rooms/${room.roomId}/tables/${table.tableId}/seat`,
          null,
          { token: session.token, method: 'DELETE' },
        );
        requestImmediateRefresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Leave failed.');
      }
    },
    [session, room, requestImmediateRefresh],
  );

  const onStart = useCallback(
    async (table: WebTable) => {
      if (!session || !room) return;
      setActionError(null);
      try {
        await request(
          `/api/rooms/${room.roomId}/tables/${table.tableId}/start`,
          null,
          { token: session.token, method: 'POST' },
        );
        requestImmediateRefresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Start failed.');
      }
    },
    [session, room, requestImmediateRefresh],
  );

  const onDelete = useCallback(
    async (table: WebTable) => {
      if (!session || !room) return;
      // P2 audit fix — server-controlled tableName interpolated into a
      // confirm() dialog. confirm() text-escapes (XSS-safe) but a
      // malicious player could still craft a name with embedded
      // newlines / very long text that floods the dialog. Truncate to
      // 80 visible chars and replace newlines with spaces so the
      // dialog stays readable.
      const safeName = String(table.tableName ?? '')
        .replace(/[\r\n\t]/g, ' ')
        .slice(0, 80);
      if (!window.confirm(`Delete table "${safeName}"? This cannot be undone.`)) {
        return;
      }
      setActionError(null);
      try {
        await request(
          `/api/rooms/${room.roomId}/tables/${table.tableId}`,
          null,
          { token: session.token, method: 'DELETE' },
        );
        requestImmediateRefresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Delete failed.');
      }
    },
    [session, room, requestImmediateRefresh],
  );

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
            data-testid="create-table-button"
            className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded px-3 py-1.5"
          >
            + Create table
          </button>
        </div>
      </header>

      {createOpen && serverState && (
        <PreLobbyModal
          roomId={room.roomId}
          serverState={serverState}
          onClose={() => setCreateOpen(false)}
          onCreated={(tableId) => {
            // Slice L4 — refresh the table list (so others see the
            // new entry on poll) and route the host into the new
            // full-page lobby. If onEnterLobby isn't wired (e.g.
            // standalone Lobby usage in tests), fall back to the
            // legacy stay-on-table-list behavior.
            requestImmediateRefresh();
            onEnterLobby?.(tableId);
          }}
        />
      )}

      {joinTarget && joinTarget.passworded && (
        // 2026-05-02 polish — passworded tables prompt for password
        // first; non-passworded tables skip this entirely (Join button
        // routes directly into the lobby below). Deck selection happens
        // inside the lobby for both, matching the host's PreLobbyModal
        // flow. Wrong passwords surface as a 422 on the first
        // PUT /seat/deck inside the lobby — there's no server endpoint
        // that pre-flights a password without also taking a seat.
        <PasswordPromptModal
          tableName={joinTarget.tableName}
          onClose={() => {
            setJoinTarget(null);
            setJoiningId(null);  // user cancelled — re-enable Join
          }}
          onSubmit={(pw) => {
            requestImmediateRefresh();
            const id = joinTarget.tableId;
            onEnterLobby?.(id, pw);
            // Row unmounts on App's lobby route swap; clearing here
            // is belt-and-suspenders.
            setJoiningId(null);
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-red-400">
          {actionError}
        </p>
      )}

      {listing && listing.tables.length === 0 && (
        <p className="text-zinc-500 italic">No active tables. Be the first.</p>
      )}

      {listing && listing.tables.length > 0 && (
        <ul className="divide-y divide-zinc-800 border border-zinc-800 rounded">
          {listing.tables.map((t) => {
            const username = session?.username ?? '';
            const seated = t.seats.some(
              (s) => s.occupied && s.playerName === username,
            );
            const hasOpenHumanSeat = t.seats.some(
              (s) => !s.occupied && (s.playerType === '' || s.playerType === 'HUMAN'),
            );
            const canJoin = !seated && t.tableState === 'WAITING' && hasOpenHumanSeat;
            const canLeave = seated && t.tableState === 'WAITING';
            const canStart =
              t.controllerName === username && t.tableState === 'READY_TO_START';
            const canDelete = t.controllerName === username;
            return (
              <li key={t.tableId} className="p-3 flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <p className="font-medium truncate">{t.tableName}</p>
                  <p className="text-xs text-zinc-400 truncate">
                    {t.gameType} · {t.deckType} · {t.controllerName}
                  </p>
                  {/* Slice 70-X (user direction 2026-04-30) — per-seat
                      commander preview. Each occupied seat shows
                      "<player> — <commander>" so friends scrolling
                      the lobby can see what each pod is going to
                      play before they decide to join. Empty seats
                      render as italic "Open" placeholders so the
                      table's seat-count + format read at a glance.
                      Server populates commanderName via TableMapper's
                      Match.getPlayer(playerId).getDeck().getSideboard()
                      lookup; non-Commander formats and seats without
                      a submitted deck render as just the player
                      name (no commander suffix). */}
                  {t.seats.length > 0 && (
                    <ul className="text-[11px] text-zinc-500 space-y-0.5 pt-1">
                      {t.seats.map((s, i) => (
                        <li key={i} className="truncate">
                          {s.occupied ? (
                            <>
                              <span className="text-zinc-300">{s.playerName}</span>
                              {s.commanderName && (
                                <span className="text-zinc-400">
                                  {' — '}
                                  {s.commanderName}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="italic">Open seat</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm">
                      <span className={stateColor(t.tableState)}>{t.tableState}</span>
                    </p>
                    <p className="text-xs text-zinc-500">
                      {t.seats.filter((s) => s.occupied).length}/{t.seats.length} seated
                    </p>
                  </div>
                  {canJoin && (
                    <button
                      type="button"
                      data-testid="lobby-join-button"
                      // 2026-05-02 polish — non-passworded tables skip
                      // the join modal entirely; the user enters the
                      // new lobby with no seat and picks a deck inline
                      // (mirrors the host's PreLobbyModal flow).
                      // Passworded tables route through the password
                      // prompt first. Audit fix (HIGH #2): guard
                      // against double-click re-firing onEnterLobby.
                      disabled={joiningId === t.tableId}
                      onClick={() => {
                        if (joiningId === t.tableId) return;
                        setJoiningId(t.tableId);
                        if (t.passworded) {
                          setJoinTarget(t);
                          // Modal close (cancel or submit) clears the
                          // joining flag below — user can retry.
                        } else {
                          requestImmediateRefresh();
                          onEnterLobby?.(t.tableId);
                          // App swaps to NewLobbyScreen on next render;
                          // this row unmounts, so the flag is moot.
                        }
                      }}
                      className="bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded px-3 py-1.5"
                    >
                      {joiningId === t.tableId ? 'Joining…' : 'Join'}
                    </button>
                  )}
                  {canLeave && (
                    <button
                      type="button"
                      onClick={() => void onLeave(t)}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded px-3 py-1.5"
                    >
                      Leave
                    </button>
                  )}
                  {canStart && (
                    <button
                      type="button"
                      onClick={() => void onStart(t)}
                      data-testid="start-table-button"
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded px-3 py-1.5"
                    >
                      Start
                    </button>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void onDelete(t)}
                      className="bg-red-700 hover:bg-red-600 text-white text-sm font-medium rounded px-3 py-1.5"
                      title="Remove this table from the lobby"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
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
