import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, request } from '../api/client';
import { webTableSchema, type WebServerState } from '../api/schemas';
import { useAuthStore } from '../auth/store';

interface Props {
  roomId: string;
  serverState: WebServerState;
  onClose: () => void;
  onCreated: () => void;
}

type AiType = 'COMPUTER_MONTE_CARLO' | 'COMPUTER_MAD';

/**
 * Modal form for {@code POST /api/rooms/{roomId}/tables}. Fields per
 * ADR 0006 D3 — three required ({@code gameType}, {@code deckType},
 * {@code winsNeeded}), plus the per-seat composition (HUMAN-only or
 * one HUMAN + one AI). Advanced fields (password, mulligan type,
 * skill, etc.) stay at their server defaults; later slices expose
 * them when needed.
 */
export function CreateTableModal({ roomId, serverState, onClose, onCreated }: Props) {
  const session = useAuthStore((s) => s.session);

  const initialGameType = serverState.gameTypes[0]?.name ?? '';
  const initialDeckType = serverState.deckTypes[0] ?? '';

  const [gameType, setGameType] = useState(initialGameType);
  const [deckType, setDeckType] = useState(initialDeckType);
  const [winsNeeded, setWinsNeeded] = useState(1);
  const [addAi, setAddAi] = useState(true);
  const [aiType, setAiType] = useState<AiType>('COMPUTER_MONTE_CARLO');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGame = serverState.gameTypes.find((g) => g.name === gameType);
  const aiAllowed = selectedGame?.maxPlayers === 2;

  // ESC key dismisses the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) {
      setError('Not signed in.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const seats = aiAllowed && addAi ? ['HUMAN', aiType] : undefined;
    const body: Record<string, unknown> = {
      gameType,
      deckType,
      winsNeeded,
    };
    if (seats) body['seats'] = seats;

    let created;
    try {
      created = await request(`/api/rooms/${roomId}/tables`, webTableSchema, {
        token: session.token,
        body,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create table.');
      setSubmitting(false);
      return;
    }

    // If the user asked for an AI opponent, fill the declared COMPUTER
    // seat now. Any failure here is a partial-success state: the table
    // exists, but the AI didn't join. Surface a warning and let the
    // user retry / leave / kill the table from the lobby.
    if (aiAllowed && addAi) {
      try {
        await request(
          `/api/rooms/${roomId}/tables/${created.tableId}/ai`,
          null,
          {
            token: session.token,
            method: 'POST',
            body: { playerType: aiType },
          },
        );
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Table created but AI failed to join: ${err.message}`
            : 'Table created but AI failed to join.',
        );
        setSubmitting(false);
        // Refresh the lobby anyway so the user sees the partial table.
        onCreated();
        return;
      }
    }

    onCreated();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full space-y-4"
      >
        <header className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">Create table</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-zinc-400 hover:text-zinc-100 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <Field label="Game type">
          <select
            value={gameType}
            onChange={(e) => setGameType(e.target.value)}
            className={selectClasses}
          >
            {serverState.gameTypes.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Deck format">
          <select
            value={deckType}
            onChange={(e) => setDeckType(e.target.value)}
            className={selectClasses}
          >
            {serverState.deckTypes.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Wins needed">
          <input
            type="number"
            min={1}
            max={5}
            value={winsNeeded}
            onChange={(e) => setWinsNeeded(Number(e.target.value) || 1)}
            className={inputClasses}
          />
        </Field>

        <fieldset className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={aiAllowed && addAi}
              disabled={!aiAllowed}
              onChange={(e) => setAddAi(e.target.checked)}
              className="accent-fuchsia-500"
            />
            <span className={aiAllowed ? '' : 'text-zinc-500'}>
              Add AI opponent
            </span>
          </label>
          {aiAllowed && addAi && (
            <select
              value={aiType}
              onChange={(e) => setAiType(e.target.value as AiType)}
              className={selectClasses + ' mt-2'}
            >
              <option value="COMPUTER_MONTE_CARLO">Computer — Monte Carlo</option>
              <option value="COMPUTER_MAD">Computer — Mad</option>
            </select>
          )}
          {!aiAllowed && (
            <p className="text-xs text-zinc-500">
              Available only on 2-seat games (multi-AI is later phase).
            </p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !gameType || !deckType}
            className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white font-medium"
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-zinc-300">{label}</span>
      {children}
    </label>
  );
}

const inputClasses =
  'w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100 focus:outline-none focus:border-fuchsia-500';
const selectClasses = inputClasses;
