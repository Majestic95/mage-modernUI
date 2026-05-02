import { useRef, useState } from 'react';
import { ApiError, request } from '../api/client';
import { useAuthStore } from '../auth/store';
import { useDecksStore, toRequestBody, type SavedDeck } from '../decks/store';
import { ValidationErrorList } from '../decks/ValidationErrorList';
import type { WebDeckValidationError } from '../api/schemas';
import { useModalA11y } from '../util/useModalA11y';

interface Props {
  roomId: string;
  tableId: string;
  tableName: string;
  /**
   * Slice L8 review (UX HIGH #5) — when the table requires a
   * password, the modal renders an input for it. Without this, the
   * server returned 422 PASSWORD_REQUIRED with no recovery affordance
   * and the user was stuck.
   */
  passworded?: boolean;
  onClose: () => void;
  onJoined: () => void;
}

/**
 * Pick a saved deck and join a table. {@code POST /api/rooms/{roomId}
 * /tables/{tableId}/join}; on success, refresh the lobby and close.
 *
 * <p>Slice 72-A — the server now distinguishes deck-validation
 * failures from other join failures: {@code DECK_INVALID} (422)
 * carries a structured {@link WebDeckValidationError}[] payload via
 * {@link ApiError#validationErrors}, while password / seat-full /
 * already-seated paths still surface as {@code UPSTREAM_REJECTED}
 * with just {@code message}. We branch on the code: render the
 * shared {@code <ValidationErrorList />} for DECK_INVALID, fall
 * back to the original message-only path otherwise.
 */
export function JoinTableModal({
  roomId, tableId, tableName, passworded = false, onClose, onJoined,
}: Props) {
  const session = useAuthStore((s) => s.session);
  const decks = useDecksStore((s) => s.decks);
  const [selectedId, setSelectedId] = useState<string>(decks[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    readonly WebDeckValidationError[] | null
  >(null);

  // Modal a11y: ESC, focus trap, initial focus, focus restoration.
  // The submitting guard is preserved by withholding onClose while
  // a join is in flight (so ESC is a no-op until the request lands).
  const modalRootRef = useRef<HTMLDivElement>(null);
  useModalA11y(modalRootRef, {
    onClose: submitting ? undefined : onClose,
  });

  const onSubmit = async () => {
    if (!session) {
      setError('Not signed in.');
      return;
    }
    const deck = decks.find((d) => d.id === selectedId);
    if (!deck) {
      setError('Pick a deck.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setValidationErrors(null);
    try {
      await request(
        `/api/rooms/${roomId}/tables/${tableId}/join`,
        null,
        {
          token: session.token,
          method: 'POST',
          body: {
            name: session.username,
            password: passworded ? password : '',
            skill: 1,
            deck: toRequestBody(deck, session.username),
          },
        },
      );
      onJoined();
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        // Slice 72-A — DECK_INVALID carries the structured per-card
        // breakdown; any other code keeps validationErrors null and
        // we fall back to the message-only render.
        setValidationErrors(
          err.code === 'DECK_INVALID' ? err.validationErrors : null,
        );
      } else {
        setError('Join failed.');
        setValidationErrors(null);
      }
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={modalRootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-table-heading"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 max-w-md w-full space-y-4">
        <header className="flex items-baseline justify-between">
          <h2 id="join-table-heading" className="text-xl font-semibold">Join table</h2>
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
        <p className="text-sm text-zinc-400 truncate">{tableName}</p>

        {decks.length === 0 ? (
          <p className="text-zinc-500 italic">
            No saved decks. Import one on the Decks tab first.
          </p>
        ) : (
          <DeckPicker
            decks={decks}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        {passworded && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-400 uppercase tracking-wide">
              Password
            </span>
            <input
              type="password"
              data-testid="join-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={decks.length > 0}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-100"
              maxLength={64}
            />
          </label>
        )}

        {error && (
          <div role="alert" className="space-y-2">
            {/* Slice 72-B critic UX-I2 — when the structured breakdown is
              * present, the per-card list IS the message; just frame it
              * with a heading so the user knows the stack is one failure,
              * not two. The message-only render path stays for non-
              * DECK_INVALID errors (wrong password, table full, etc.). */}
            {validationErrors && validationErrors.length > 0 ? (
              <>
                <p className="text-sm font-medium text-status-danger">
                  Deck not legal:
                </p>
                <ValidationErrorList
                  errors={validationErrors}
                  ariaLabel="Join failed — deck validation errors"
                />
              </>
            ) : (
              <p className="text-sm text-status-danger">{error}</p>
            )}
          </div>
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
            type="button"
            onClick={onSubmit}
            disabled={submitting || decks.length === 0}
            className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 text-white font-medium"
          >
            {submitting ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeckPicker({
  decks,
  selectedId,
  onSelect,
}: {
  decks: SavedDeck[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-1 max-h-64 overflow-y-auto border border-zinc-800 rounded">
      <legend className="sr-only">Pick a deck</legend>
      {decks.map((d) => (
        <label
          key={d.id}
          className={
            'flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-800 ' +
            (selectedId === d.id ? 'bg-zinc-800' : '')
          }
        >
          <input
            type="radio"
            name="deck"
            value={d.id}
            checked={selectedId === d.id}
            onChange={() => onSelect(d.id)}
            className="accent-fuchsia-500"
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{d.name}</p>
            <p className="text-xs text-zinc-500">
              {d.cards.reduce((sum, c) => sum + c.amount, 0)} cards
            </p>
          </div>
        </label>
      ))}
    </fieldset>
  );
}
