/**
 * Slice L1 (new-lobby-window) — top-level lobby page. Replaces the
 * legacy CreateTableModal + table-list pre-game flow with a dedicated
 * full-page screen.
 *
 * <p>L1 shipped static fixture data only. Slice L2 wires real
 * {@link WebTable} via polling — when {@code tableId} is a UUID, the
 * page polls {@code GET /api/rooms/.../tables} and maps the matching
 * {@link WebTable} into the lobby's view shape. {@code "fixture"}
 * stays as a dev-only entry path so the visual shell can still be
 * reviewed without a live table. Slice L7 swaps polling for a
 * per-table WebSocket stream. Slice L4 wires the real entry path
 * from the slim PreLobbyModal.
 *
 * <p>Reference: docs/design/new-lobby-window.md
 */
import { useEffect, useState } from 'react';
import { ApiError, request } from '../api/client';
import { webRoomRefSchema, type WebTable } from '../api/schemas';
import { useAuthStore } from '../auth/store';
import { CommanderPreviewPanel } from './CommanderPreviewPanel';
import { DeckPreviewPanel } from './DeckPreviewPanel';
import { EditSettingsModal } from './EditSettingsModal';
import { GameSettingsPanel } from './GameSettingsPanel';
import { LOBBY_FIXTURE, type LobbyFixture } from './fixtures';
import { LobbyHeader } from './LobbyHeader';
import { LobbyTopBar } from './LobbyTopBar';
import { MyDecksPanel } from './MyDecksPanel';
import { ReadyButton } from './ReadyButton';
import { SeatRow } from './SeatRow';
import { StartGameButton } from './StartGameButton';
import { useLiveDecks } from './useLiveDecks';
import { useTableStream } from './useTableStream';
import { webTableToLobby } from './webTableToLobby';
import type { WebDeckCardInfo } from '../api/schemas';
import { useDecksStore } from '../decks/store';

interface EditableInitial {
  password: string;
  skillLevel: string;
  matchTimeLimit: string;
  freeMulligans: number;
  mulliganType: string;
  spectatorsAllowed: boolean;
  rated: boolean;
  attackOption: string;
  range: string;
}

const DEFAULT_INITIAL: EditableInitial = {
  password: '',
  skillLevel: 'CASUAL',
  matchTimeLimit: 'NONE',
  freeMulligans: 0,
  mulliganType: 'GAME_DEFAULT',
  spectatorsAllowed: true,
  rated: false,
  attackOption: 'LEFT',
  range: 'ALL',
};

/**
 * Slice L3 — derive Edit-Settings initial values from a live
 * {@link WebTable}. Only the four fields that round-trip on
 * {@code WebTable} today (skillLevel, password-flag, spectators,
 * rated) are derived from the wire; the rest fall back to the
 * server-side defaults defined in {@link DEFAULT_INITIAL}. Sparse
 * PATCH diff means a "no-touch" save sends nothing, so the
 * possibly-stale defaults can't accidentally overwrite real values.
 *
 * <p>Adding the missing fields to WebTable (matchTimeLimit,
 * freeMulligans, mulliganType, attackOption, range) is a follow-up
 * slice — additive, fits within schema 1.27.
 */
function initialFromTable(table: WebTable | null): EditableInitial {
  if (!table) return DEFAULT_INITIAL;
  return {
    ...DEFAULT_INITIAL,
    password: '',
    skillLevel: table.skillLevel || DEFAULT_INITIAL.skillLevel,
    spectatorsAllowed: table.spectatorsAllowed,
    rated: table.rated,
  };
}

interface Props {
  /**
   * Table identifier. {@code "fixture"} renders L1 fixture data
   * (no wire calls). Anything else is treated as a real upstream
   * tableId and triggers the polling hook.
   */
  tableId: string;
}

export function NewLobbyScreen({ tableId }: Props) {
  if (tableId === 'fixture') {
    return (
      <LobbyShell
        data={LOBBY_FIXTURE}
        tableId="fixture"
        roomId={null}
        editInitial={DEFAULT_INITIAL}
      />
    );
  }
  return <LiveLobby tableId={tableId} />;
}

function LiveLobby({ tableId }: { tableId: string }) {
  const session = useAuthStore((s) => s.session);
  const username = session?.username ?? '';
  // Slice L7 — WebSocket push replaces the 5s polling. Same return
  // shape so the rest of the component is unchanged. Polling lives on
  // as fallback inside the hook for hard-failure paths.
  const { table, error, loading } = useTableStream(tableId);
  const [roomId, setRoomId] = useState<string | null>(null);

  // Slice L3 — discover the singleton main room ID once. The PATCH
  // endpoint needs both roomId + tableId; useLobbyTable already
  // resolves the room for its polling, but doesn't expose it. Cheap
  // to call again here (one-shot) so the modal can render the room
  // path. If this becomes a recurring shape, extract a useMainRoom()
  // hook in a future slice.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await request('/api/server/main-room', webRoomRefSchema, {
          token: session.token,
        });
        if (!cancelled) setRoomId(r.roomId);
      } catch {
        // Swallow — modal will render in fixture-mode (Save no-op)
        // until roomId resolves.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (loading && !table) {
    return <LobbyStatus message="Loading table…" />;
  }
  if (!table) {
    return <LobbyStatus message={error ?? 'Table not found.'} />;
  }
  const data = webTableToLobby({ webTable: table, currentUsername: username });
  return (
    <LobbyShell
      data={data}
      tableId={tableId}
      roomId={roomId}
      editInitial={initialFromTable(table)}
      useLiveDecksHook
    />
  );
}

function LobbyStatus({ message }: { message: string }) {
  return (
    <div
      data-testid="lobby-status"
      className="flex h-screen flex-col items-center justify-center gap-2 bg-bg-base text-text-secondary"
    >
      <p>{message}</p>
    </div>
  );
}

function LobbyShell({
  data: fixture,
  tableId,
  roomId,
  editInitial,
  useLiveDecksHook = false,
}: {
  data: LobbyFixture;
  tableId: string;
  roomId: string | null;
  editInitial: EditableInitial;
  useLiveDecksHook?: boolean;
}) {
  const session = useAuthStore((s) => s.session);
  const [editOpen, setEditOpen] = useState(false);
  const [readySubmitting, setReadySubmitting] = useState(false);
  const [readyError, setReadyError] = useState<string | null>(null);
  const [localSelectedDeckId, setLocalSelectedDeckId] = useState<string | null>(
    fixture.selectedDeckId,
  );
  const [deckSubmitting, setDeckSubmitting] = useState(false);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [startSubmitting, setStartSubmitting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Slice L7 polish — settings-change banner. Set by EditSettingsModal
  // on save; auto-dismisses after 4s. The wire-side mechanism (server
  // resets guest ready flags on PATCH) drives the actual state; the
  // banner is purely UX feedback so users notice they need to re-ready.
  const [settingsChangedNotice, setSettingsChangedNotice] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (!settingsChangedNotice) return;
    const t = setTimeout(() => setSettingsChangedNotice(null), 4000);
    return () => clearTimeout(t);
  }, [settingsChangedNotice]);
  // Live-mode deck data (slice L6). Fixture mode uses fixture.decks
  // unchanged. The hook always runs (rules-of-hooks); when not in
  // live mode, useLiveDecksHook=false and we ignore the result.
  const live = useLiveDecks(useLiveDecksHook ? localSelectedDeckId : null);

  const decks = useLiveDecksHook ? live.decks : fixture.decks;
  const selectedDeckId = localSelectedDeckId ?? fixture.selectedDeckId;
  const selectedDeck = useLiveDecksHook
    ? live.selectedDeck
    : decks.find((d) => d.id === selectedDeckId) ?? null;
  // Slice L7 polish — normalize playerName / username comparison so a
  // wire-side variation (whitespace, casing) doesn't silently deny the
  // user's seat identity, leaving them with a greyed Ready Up button.
  const normalizedUsername = fixture.currentUsername.trim().toLowerCase();
  const localSeat =
    fixture.seats.find(
      (s) => s.playerName.trim().toLowerCase() === normalizedUsername,
    ) ?? null;
  // Slice L7 review fix — host status comes from the table-level
  // controllerName comparison (set in webTableToLobby), not from seat
  // occupancy. The host who hasn't taken a seat yet still sees host-
  // flavored UI (Start Game button instead of guest Ready Up).
  const isHost = fixture.amIHost;
  const isLocalReady = localSeat?.ready ?? false;
  const readyCount = fixture.seats.filter((s) => s.occupied && s.ready).length;
  const totalSeats = fixture.matchOptions.playerCount;
  const allReady = readyCount === totalSeats;
  const isFixture = tableId === 'fixture' || roomId === null;

  // Slice L6 — submit deck on selection. Client-state selection
  // updates immediately; the wire submit follows. On failure the
  // selection is reverted so the UI stays truthful.
  const onSelectDeck = async (deckId: string) => {
    if (tableId === 'fixture' || roomId === null) {
      // Fixture path — just move the highlight, no wire call.
      setLocalSelectedDeckId(deckId);
      return;
    }
    if (!session) {
      setDeckError('Session expired — please reload.');
      return;
    }
    const saved = useDecksStore.getState().decks.find((d) => d.id === deckId);
    if (!saved) {
      setDeckError('Selected deck not found in local storage.');
      return;
    }
    const previous = localSelectedDeckId;
    setLocalSelectedDeckId(deckId);
    setDeckSubmitting(true);
    setDeckError(null);
    try {
      const cards: WebDeckCardInfo[] = saved.cards;
      const sideboard: WebDeckCardInfo[] = saved.sideboard;
      await request(
        `/api/rooms/${roomId}/tables/${tableId}/seat/deck`,
        null,
        {
          method: 'PUT',
          token: session.token,
          body: {
            name: session.username,
            skill: 1,
            deck: {
              name: saved.name,
              author: session.username,
              cards,
              sideboard,
            },
          },
        },
      );
    } catch (err) {
      setLocalSelectedDeckId(previous);
      setDeckError(
        err instanceof ApiError ? err.message : 'Failed to submit deck.',
      );
    } finally {
      setDeckSubmitting(false);
    }
  };

  // Slice L7-prep — wire the orange Start Game CTA to the existing
  // POST /tables/{t}/start endpoint. Without this the button looked
  // active but did nothing. Server-side already gates on owner; the
  // client gate prevents the click when not all seats are ready.
  const onStartGame = async () => {
    if (tableId === 'fixture' || roomId === null) {
      // Fixture path — no wire call. The 'Start' click is visual-only.
      return;
    }
    if (!session) {
      setStartError('Session expired — please reload.');
      return;
    }
    setStartSubmitting(true);
    setStartError(null);
    try {
      await request(
        `/api/rooms/${roomId}/tables/${tableId}/start`,
        null,
        { method: 'POST', token: session.token },
      );
      // Slice L8 will route into the game window when the lobby
      // sees state=DUELING. For now the polling hook will pick up
      // the new state on the next tick and the UI naturally
      // transitions when activeGameId is set elsewhere.
    } catch (err) {
      setStartError(
        err instanceof ApiError ? err.message : 'Failed to start the match.',
      );
    } finally {
      setStartSubmitting(false);
    }
  };

  const toggleReady = async () => {
    if (isFixture) {
      // Fixture path — visual-only; no wire call.
      return;
    }
    if (!session) {
      setReadyError('Session expired — please reload.');
      return;
    }
    setReadySubmitting(true);
    setReadyError(null);
    try {
      await request(
        `/api/rooms/${roomId}/tables/${tableId}/seat/ready`,
        null,
        {
          method: 'POST',
          token: session.token,
          body: { ready: !isLocalReady },
        },
      );
      // Slice L5 — successful toggle. The next 5s poll will re-emit
      // the seat with the updated ready flag; the wire is the source
      // of truth. L7 swaps polling for WS push so the change is
      // reflected <100ms.
    } catch (err) {
      setReadyError(
        err instanceof ApiError ? err.message : 'Failed to toggle ready.',
      );
    } finally {
      setReadySubmitting(false);
    }
  };

  return (
    <div
      data-testid="new-lobby-screen"
      className="relative flex h-screen flex-col overflow-hidden bg-bg-base text-text-primary"
      style={{
        // Subtle nebula gradient backdrop matching the in-game battlefield
        // ambient. Composited from a deep teal-purple radial spotlight
        // over the bg-base canvas.
        backgroundImage:
          'radial-gradient(ellipse 90% 60% at 50% 35%, rgba(139, 92, 246, 0.18) 0%, rgba(76, 29, 149, 0.08) 35%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(91, 192, 240, 0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 30% at 15% 90%, rgba(168, 85, 247, 0.10) 0%, transparent 60%)',
      }}
    >
      <LobbyTopBar />

      {/* Main fills remaining viewport height. `min-h-0` is critical:
          without it, flex children retain content-driven heights and
          the page overflows the viewport. The grid splits the space
          between header (auto) and the two content rows; the rows
          share the remaining space at 1.15:1 ratio (matching mockup
          where seats > decks). */}
      <main
        className="grid min-h-0 flex-1 gap-3 px-5 pb-4"
        style={{
          gridTemplateRows: 'auto minmax(0, 1.15fr) minmax(0, 1fr)',
        }}
      >
        <LobbyHeader
          format={fixture.matchOptions.format}
          mode={fixture.matchOptions.mode}
          playerCount={fixture.matchOptions.playerCount}
          readyCount={readyCount}
          totalSeats={totalSeats}
        />

        {/* Top half — settings + seats. Chat panel omitted; the right
            column is intentionally vacant in L1. */}
        <section
          data-testid="lobby-top-row"
          className="grid h-full min-h-0 gap-3"
          style={{
            gridTemplateColumns: 'minmax(220px, 260px) 1fr minmax(280px, 320px)',
          }}
        >
          <GameSettingsPanel
            options={fixture.matchOptions}
            isHost={isHost}
            onEditSettings={() => setEditOpen(true)}
          />
          <SeatRow
            seats={fixture.seats}
            currentUsername={fixture.currentUsername}
          />
          <div aria-hidden="true" />
        </section>

        {/* Bottom half — deck management + commander preview + start. */}
        <section
          data-testid="lobby-bottom-row"
          className="grid h-full min-h-0 gap-3"
          style={{
            gridTemplateColumns:
              'minmax(240px, 280px) minmax(320px, 360px) 1fr minmax(220px, 280px)',
          }}
        >
          <MyDecksPanel
            decks={decks}
            selectedDeckId={selectedDeckId}
            onDeckSelect={(id) => void onSelectDeck(id)}
            disabled={deckSubmitting}
          />
          <DeckPreviewPanel
            deck={selectedDeck}
            statsLoading={useLiveDecksHook && live.selectedStatsLoading}
          />
          <CommanderPreviewPanel deck={selectedDeck} />
          <div className="flex flex-col items-end justify-end gap-1">
            {/*
              Slice L7 review fix — three states for the bottom-right CTA:
              1. Local user has no seat yet → "Pick a deck to take your
                 seat" hint (applies to host AND guest before deck pick).
              2. Local user is host (with or without seat) → Start Game.
                 Until they have a seat AND every other seat is ready,
                 the button is disabled with a contextual subtitle.
              3. Local user is non-host with seat → Ready Up.
            */}
            {!localSeat ? (
              <TakeSeatHint isHost={isHost} />
            ) : isHost ? (
              <StartGameButton
                enabled={isHost && allReady}
                isHost={isHost}
                allReady={allReady}
                submitting={startSubmitting}
                onStart={() => void onStartGame()}
              />
            ) : (
              <ReadyButton
                ready={isLocalReady}
                disabled={readySubmitting || !localSeat}
                onToggle={() => void toggleReady()}
              />
            )}
            {readyError && (
              <p
                role="alert"
                data-testid="ready-error"
                className="text-xs text-status-danger"
              >
                {readyError}
              </p>
            )}
            {deckError && (
              <p
                role="alert"
                data-testid="deck-error"
                className="text-xs text-status-danger"
              >
                {deckError}
              </p>
            )}
            {startError && (
              <p
                role="alert"
                data-testid="start-error"
                className="text-xs text-status-danger"
              >
                {startError}
              </p>
            )}
          </div>
        </section>
      </main>

      {editOpen && (
        <EditSettingsModal
          roomId={roomId}
          tableId={tableId}
          initial={editInitial}
          onClose={() => setEditOpen(false)}
          onSaved={() =>
            setSettingsChangedNotice(
              'Settings changed — guests must re-ready up.',
            )
          }
        />
      )}

      {settingsChangedNotice && (
        <div
          data-testid="settings-change-notice"
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 top-16 z-40 flex justify-center px-4"
        >
          <div
            className="rounded-md border px-4 py-2 text-sm text-text-primary backdrop-blur-sm"
            style={{
              background: 'rgba(21, 34, 41, 0.92)',
              borderColor: 'var(--color-status-warning)',
              boxShadow: 'var(--shadow-medium)',
            }}
          >
            {settingsChangedNotice}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Slice L7 review fix — the "you have no seat yet" CTA. Sits in the
 * bottom-right slot where StartGameButton / ReadyButton normally
 * render; surfaces the deck-pick = take-seat coupling that was
 * otherwise non-obvious to first-time users (locked decision Q12 +
 * UX-review #6 from L6).
 */
function TakeSeatHint({ isHost }: { isHost: boolean }) {
  const verb = isHost ? 'host' : 'join';
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div
        data-testid="take-seat-hint"
        className="rounded-xl border px-8 py-3 text-center"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          color: 'var(--color-text-secondary)',
          boxShadow: 'var(--shadow-low)',
        }}
      >
        <p
          className="text-sm font-semibold uppercase"
          style={{ letterSpacing: '0.08em' }}
        >
          Take your seat
        </p>
        <p className="mt-1 text-xs">
          Pick a deck below to {verb} this table
        </p>
      </div>
    </div>
  );
}
