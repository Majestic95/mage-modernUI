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
import { getFormatInfo } from './formatInfo';

interface Props {
  roomId: string;
  serverState: WebServerState;
  onClose: () => void;
  /** Called with the newly-created table ID on success. */
  onCreated: (tableId: string) => void;
}

/**
 * AI types the user can pick when filling seats. Order = display order;
 * the first entry is the default selection. MAD (`ComputerPlayer7`)
 * leads because it's the engine-blessed playable AI; MCTS is exposed
 * as an "experimental" alternative.
 *
 * <p>Hardcoded rather than derived from {@code serverState.playerTypes}
 * so unforeseen PlayerType enum additions don't accidentally surface
 * in the UI without explicit review (e.g. Draft-only bots, or a
 * future custom Commander AI that needs its own labelling). When a
 * new playable AI lands, append a row here.
 */
const AI_OPTIONS = [
  {
    value: 'COMPUTER_MAD',
    label: 'MAD (recommended)',
    hint: 'Simulation-based AI. Plays strategically.',
  },
  {
    value: 'COMPUTER_MONTE_CARLO',
    label: 'Monte Carlo',
    hint: 'MCTS search. Experimental — may pass priority often.',
  },
] as const;

type AiTypeValue = (typeof AI_OPTIONS)[number]['value'];

const DEFAULT_AI_TYPE: AiTypeValue = AI_OPTIONS[0].value;

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
  // T4 — static description + banlist URL for the chosen format.
  // Returns null for unknown formats (custom plugins, future upstream
  // additions we haven't curated copy for); the panel just doesn't
  // render in that case.
  const formatInfo = useMemo(() => getFormatInfo(deckType), [deckType]);
  const minPlayers = selectedGameType?.minPlayers ?? 2;
  const maxPlayers = selectedGameType?.maxPlayers ?? minPlayers;
  const [playerCount, setPlayerCount] = useState(maxPlayers);
  // 2026-05-04 — split-lobby support. Was a boolean `fillWithAi`
  // toggle; now an integer count of AI seats so the host can mix
  // AI opponents with open HUMAN slots that real friends can join.
  // Range: 0 → playerCount - 1 (the host always occupies slot 0).
  const [aiSeatCount, setAiSeatCount] = useState(0);
  const [aiType, setAiType] = useState<AiTypeValue>(DEFAULT_AI_TYPE);

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
  // Re-clamp aiSeatCount whenever the player count shrinks below the
  // user's previously-chosen AI seat count. e.g., user picked 3 AI in
  // a 4-player game then dropped player count to 2 — must shrink AI
  // seat count to 1 to keep room for the host.
  const maxAiSeats = Math.max(0, clampedCount - 1);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiSeatCount((prev) => (prev > maxAiSeats ? maxAiSeats : prev));
  }, [maxAiSeats]);
  const clampedAiSeatCount = clamp(aiSeatCount, 0, maxAiSeats);

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
    // auto-occupies it on table create). The next `clampedAiSeatCount`
    // slots are AI; any remaining slots stay HUMAN, leaving them
    // open for friends to join from the lobby. Layout:
    //   [HUMAN, ...N × aiType, ...rest HUMAN]
    // 0 AI: classic all-human lobby. count = playerCount-1: classic
    // all-AI fill. Anything in between: split lobby (this slice's
    // value-add).
    const seats: string[] = [];
    seats.push('HUMAN');
    for (let i = 1; i < clampedCount; i++) {
      const isAiSlot = i <= clampedAiSeatCount;
      seats.push(isAiSlot ? aiType : 'HUMAN');
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
    if (clampedAiSeatCount > 0) {
      const aiSeats = clampedAiSeatCount;
      for (let i = 0; i < aiSeats; i++) {
        try {
          await request(
            `/api/rooms/${roomId}/tables/${createdTableId}/ai`,
            null,
            {
              token: session.token,
              method: 'POST',
              body: { playerType: aiType },
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
      // User repro 2026-05-02: clicking the player-count <input
      // type="number"> spinner buttons was closing the modal. Native
      // spinner clicks emit events that don't reliably stop at a
      // child's onClick stopPropagation in all browsers — and chained
      // click+change events on a nested <label> can synthesise a
      // second click that bubbles past the React handler. The
      // robust fix is to gate the close on target===currentTarget so
      // only DIRECT clicks on the backdrop trigger it; clicks that
      // originate inside the modal (and bubble for any reason) are
      // ignored.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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

        {formatInfo && (
          <div
            data-testid="pre-lobby-format-info"
            role="status"
            aria-live="polite"
            className="-mt-3 flex flex-col gap-1 rounded-md border px-3 py-2 text-xs"
            style={{
              borderColor: 'var(--color-card-frame-default)',
              background: 'var(--color-bg-elevated-subtle, var(--color-bg-elevated))',
            }}
          >
            <p className="text-text-secondary">{formatInfo.description}</p>
            {formatInfo.banlistUrl && (
              <a
                href={formatInfo.banlistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start text-status-info hover:underline"
                data-testid="pre-lobby-format-banlist"
              >
                View banlist <span aria-hidden="true">↗</span>
              </a>
            )}
          </div>
        )}

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

        <div className="flex flex-col gap-2">
          <Field
            label={`AI opponents (0–${maxAiSeats})`}
          >
            <input
              type="number"
              data-testid="pre-lobby-ai-seat-count"
              min={0}
              max={maxAiSeats}
              value={clampedAiSeatCount}
              onChange={(e) =>
                setAiSeatCount(
                  clamp(parseInt(e.target.value, 10) || 0, 0, maxAiSeats),
                )
              }
              className={inputClass()}
            />
          </Field>
          <p className="text-xs text-text-secondary">
            {clampedAiSeatCount === 0
              ? `${maxAiSeats} open seat${maxAiSeats === 1 ? '' : 's'} for friends.`
              : clampedAiSeatCount === maxAiSeats
                ? `Solo vs ${maxAiSeats} AI opponent${maxAiSeats === 1 ? '' : 's'}.`
                : `${clampedAiSeatCount} AI + ${maxAiSeats - clampedAiSeatCount} open seat${maxAiSeats - clampedAiSeatCount === 1 ? '' : 's'} for friends.`}
          </p>
          {clampedAiSeatCount > 0 && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="pre-lobby-ai-type"
                className="text-xs uppercase text-text-secondary"
                style={{ letterSpacing: '0.08em' }}
              >
                AI type
              </label>
              <select
                id="pre-lobby-ai-type"
                data-testid="pre-lobby-ai-type"
                value={aiType}
                onChange={(e) => setAiType(e.target.value as AiTypeValue)}
                className={inputClass()}
              >
                {AI_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-secondary">
                {AI_OPTIONS.find((o) => o.value === aiType)?.hint}
              </p>
            </div>
          )}
        </div>

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
