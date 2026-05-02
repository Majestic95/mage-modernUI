/**
 * Slice L4 (new-lobby-window) — slim pre-lobby selector. The minimum
 * viable create-table surface: format, mode, player count, optional
 * AI seats. Everything else (password, time limit, mulligan rules,
 * skill, spectators, rated, range, attack option) lives in the
 * host-only Edit Settings modal reachable from inside the new lobby
 * once it opens.
 *
 * <p>Submit flow:
 * <ol>
 *   <li>POST /api/rooms/{roomId}/tables with the slim WebCreateTableRequest
 *       body — seats array declares HUMAN + optional COMPUTER slots</li>
 *   <li>If AI was requested, POST /ai for each declared COMPUTER seat
 *       (sequential — concurrent /ai calls race on the upstream
 *       "next available COMPUTER seat" lookup)</li>
 *   <li>Invoke {@code onCreated(tableId)} so the parent can flip
 *       {@code activeLobbyId} and route into the new lobby</li>
 * </ol>
 *
 * <p>L9 retired the legacy CreateTableModal — this is the only
 * create-table modal now.
 */
import { useEffect, useMemo, useState } from 'react';
import { ApiError, request } from '../api/client';
import { webTableSchema, type WebServerState } from '../api/schemas';
import { useAuthStore } from '../auth/store';

interface Props {
  roomId: string;
  serverState: WebServerState;
  onClose: () => void;
  /** Called with the newly-created table ID on success. */
  onCreated: (tableId: string) => void;
}

const DEFAULT_AI_TYPE = 'COMPUTER_MONTE_CARLO';

export function PreLobbyModal({
  roomId,
  serverState,
  onClose,
  onCreated,
}: Props) {
  const session = useAuthStore((s) => s.session);

  // Default the format to "Commander" when present in the server's
  // deckType list (matches the design doc's primary mockup).
  // Otherwise fall back to the first listed deckType.
  const initialDeckType = useMemo(() => {
    const commander = serverState.deckTypes.find((dt) =>
      dt.toLowerCase().includes('commander'),
    );
    return commander ?? serverState.deckTypes[0] ?? '';
  }, [serverState.deckTypes]);

  // Default the mode to "Free For All" when present, otherwise the
  // first listed game type.
  const initialGameType = useMemo(() => {
    const ffa = serverState.gameTypes.find((g) =>
      g.name.toLowerCase().includes('free for all'),
    );
    return ffa?.name ?? serverState.gameTypes[0]?.name ?? '';
  }, [serverState.gameTypes]);

  const [gameType, setGameType] = useState(initialGameType);
  const [deckType, setDeckType] = useState(initialDeckType);
  const selectedGameType = useMemo(
    () => serverState.gameTypes.find((g) => g.name === gameType) ?? null,
    [gameType, serverState.gameTypes],
  );
  const minPlayers = selectedGameType?.minPlayers ?? 2;
  const maxPlayers = selectedGameType?.maxPlayers ?? minPlayers;
  const [playerCount, setPlayerCount] = useState(maxPlayers);
  const [fillWithAi, setFillWithAi] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Slice L6 polish — Esc closes the modal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Slice L8 review (UX MEDIUM #24) — clamp via useEffect rather
  // than setState-in-render. Previous draft set state during render
  // body, which triggered a forced extra render every time gameType
  // changed (and on the first render with mismatched defaults,
  // double-rendered unconditionally). The effect-based clamp runs
  // after commit and only sets state when the value would actually
  // change — no cascading-render warning, single repaint per change.
  useEffect(() => {
    // Clamp playerCount to the new mode's [min,max] range when gameType
    // changes. Doing this in render would loop (setState during render);
    // doing it in the onChange handler would miss programmatic gameType
    // updates. Functional updater short-circuits when no change is needed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayerCount((prev) => {
      const next = clamp(prev, minPlayers, maxPlayers);
      return next === prev ? prev : next;
    });
  }, [minPlayers, maxPlayers]);
  const clampedCount = clamp(playerCount, minPlayers, maxPlayers);

  const handleSubmit = async () => {
    if (!session) {
      setError('Session expired — please reload.');
      return;
    }
    if (!gameType || !deckType) {
      setError('Format and mode are required.');
      return;
    }
    setSubmitting(true);
    setError(null);

    // Build the seats array. Slot 0 is always HUMAN (the creator
    // auto-occupies it on table create). If "fill with AI" is on,
    // remaining slots are COMPUTER_MONTE_CARLO so the table can
    // start solo or with one human + several AI opponents.
    const seats: string[] = [];
    seats.push('HUMAN');
    for (let i = 1; i < clampedCount; i++) {
      seats.push(fillWithAi ? DEFAULT_AI_TYPE : 'HUMAN');
    }

    const body: Record<string, unknown> = {
      gameType,
      deckType,
      winsNeeded: 1,
      seats,
    };

    let createdTableId: string;
    try {
      const created = await request(`/api/rooms/${roomId}/tables`, webTableSchema, {
        token: session.token,
        body,
      });
      createdTableId = created.tableId;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create table.');
      setSubmitting(false);
      return;
    }

    // Fill the declared COMPUTER seats sequentially. Concurrent /ai
    // calls race on the upstream "next available COMPUTER seat"
    // lookup, so we must serialize.
    if (fillWithAi) {
      const aiSeats = clampedCount - 1;
      for (let i = 0; i < aiSeats; i++) {
        try {
          await request(
            `/api/rooms/${roomId}/tables/${createdTableId}/ai`,
            null,
            {
              token: session.token,
              method: 'POST',
              body: { playerType: DEFAULT_AI_TYPE },
            },
          );
        } catch (err) {
          const filled = i;
          const detail = err instanceof ApiError ? `: ${err.message}` : '';
          setError(
            `Table created with ${filled} of ${aiSeats} AI seats filled — `
            + `seat ${i + 1} failed to join${detail}.`,
          );
          setSubmitting(false);
          // Still hand off to the lobby so the user can manage the
          // partial table from there.
          onCreated(createdTableId);
          return;
        }
      }
    }

    onCreated(createdTableId);
    onClose();
  };

  return (
    <div
      data-testid="pre-lobby-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--color-bg-overlay)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        data-testid="pre-lobby-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create game"
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          boxShadow: 'var(--shadow-high)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2
            className="text-base font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
          >
            Create Game
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Pick the format and mode. You'll set the rest in the lobby.
          </p>
        </header>

        <Field label="Format">
          <select
            data-testid="pre-lobby-deck-type"
            value={deckType}
            onChange={(e) => setDeckType(e.target.value)}
            className={inputClass()}
          >
            {serverState.deckTypes.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Mode">
          <select
            data-testid="pre-lobby-game-type"
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
            className={inputClass()}
          >
            {serverState.gameTypes.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={`Players (${minPlayers}${maxPlayers > minPlayers ? `–${maxPlayers}` : ''})`}
        >
          {minPlayers === maxPlayers ? (
            <p
              data-testid="pre-lobby-player-count-fixed"
              className="px-3 py-2 text-sm text-text-secondary"
            >
              {minPlayers} players (fixed for this mode)
            </p>
          ) : (
            <input
              type="number"
              data-testid="pre-lobby-player-count"
              min={minPlayers}
              max={maxPlayers}
              value={clampedCount}
              onChange={(e) =>
                setPlayerCount(clamp(parseInt(e.target.value, 10) || minPlayers, minPlayers, maxPlayers))
              }
              className={inputClass()}
            />
          )}
        </Field>

        <label
          data-testid="pre-lobby-ai-toggle"
          className="flex cursor-pointer items-center gap-2 text-sm text-text-primary"
        >
          <input
            type="checkbox"
            checked={fillWithAi}
            onChange={(e) => setFillWithAi(e.target.checked)}
            className="h-4 w-4 accent-accent-primary"
          />
          <span>Fill remaining seats with AI</span>
        </label>

        {error && (
          <p
            role="alert"
            data-testid="pre-lobby-error"
            className="text-sm text-status-danger"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="pre-lobby-cancel"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="pre-lobby-create"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-on-accent transition-colors hover:bg-accent-primary-hover disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create lobby'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-xs uppercase text-text-secondary"
        style={{ letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function inputClass(): string {
  // Slice L6 polish — explicit border + bg + focus-ring tokens so
  // native form controls don't fall back to OS chrome on dark mode.
  // The global rules in index.css set background/text; this adds
  // the per-element border + focus state.
  return 'rounded-md border border-card-frame-default/80 bg-surface-card px-3 py-2 text-sm text-text-primary outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-focus-ring';
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
