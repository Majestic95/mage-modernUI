/**
 * Import-into-current-deck modal. Two modes:
 *
 * <ul>
 *   <li><b>Overwrite</b> — replace cards in the active deck. Deck
 *       identity (id, createdAt, name) preserved.</li>
 *   <li><b>Trash + New</b> — delete the active deck and create a new
 *       one from the paste. Workbench callback {@code onDeckReplaced}
 *       switches the active deck to the freshly-created one.</li>
 * </ul>
 *
 * <p>Per the 2026-05-12 separation directive, deck-builder-specific.
 * Reuses the parse + resolve flow from {@link NewDeckModal} via the
 * same shared parser helpers in {@code decks/parse.ts} +
 * {@code decks/resolve.ts}.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseDeckText } from '../decks/parse';
import { resolveDeckLists } from '../decks/resolve';
import { useDecksStore, type SavedDeck } from '../decks/store';
import { useAuthStore } from '../auth/store';

type Mode = 'overwrite' | 'replace';

interface Props {
  deck: SavedDeck;
  onClose: () => void;
  /**
   * Fired after the trash-and-new mode swaps the deck. The workbench
   * uses this to point the active-deck UI state at the new deck's id.
   * Not fired for the overwrite mode (the active deck's id stays the
   * same).
   */
  onDeckReplaced: (newDeckId: string) => void;
}

export function ImportIntoDeckModal({ deck, onClose, onDeckReplaced }: Props) {
  const session = useAuthStore((s) => s.session);
  const addDeck = useDecksStore((s) => s.add);
  const updateDeck = useDecksStore((s) => s.update);
  const removeDeck = useDecksStore((s) => s.remove);

  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('overwrite');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    prevFocusRef.current =
      (document.activeElement instanceof HTMLElement)
        ? document.activeElement
        : null;
    return () => {
      prevFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) {
        onClose();
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !importing) {
        e.preventDefault();
        dialogRef.current?.requestSubmit();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [importing, onClose]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!session) {
      setError('Not signed in.');
      return;
    }
    const parsed = parseDeckText(text);
    if (parsed.errors.length > 0) {
      setError(parsed.errors.join('\n'));
      return;
    }
    if (parsed.cards.length === 0 && parsed.sideboard.length === 0) {
      setError('No cards parsed. Use one "<count> <card name>" line per entry.');
      return;
    }
    setImporting(true);
    let newDeckId: string | null = null;
    try {
      const result = await resolveDeckLists(
        parsed.cards,
        parsed.sideboard,
        session.token,
      );
      if (result.missing.length > 0) {
        setError(
          'Could not find these cards in the server DB '
          + '(check exact spelling, including capitalization):\n  '
          + result.missing.join('\n  '),
        );
        return;
      }
      if (mode === 'overwrite') {
        // Replace cards in-place. Deck id, name, createdAt preserved.
        // displayCard is reset to the first imported card (matches
        // the addDeck() default for new decks).
        updateDeck(deck.id, {
          cards: result.cards,
          sideboard: result.sideboard,
          displayCard: result.cards[0] ?? null,
        });
      } else {
        // 'replace' = trash existing + create new with same name.
        // Order matters: addDeck first so the new deck exists before
        // we remove the old; the workbench's recovery effect will
        // route to a sibling deck if the order were inverted.
        const created = addDeck(deck.name, result.cards, result.sideboard);
        removeDeck(deck.id);
        newDeckId = created.id;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
    if (newDeckId !== null) onDeckReplaced(newDeckId);
    else if (!error) onClose();
  };

  return (
    <div
      data-testid="import-into-deck-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'var(--color-bg-overlay)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
      role="presentation"
    >
      <form
        ref={dialogRef}
        data-testid="import-into-deck-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-into-deck-title"
        onSubmit={onSubmit}
        className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          boxShadow: 'var(--shadow-high)',
        }}
      >
        <header className="flex items-center justify-between">
          <h2
            id="import-into-deck-title"
            className="text-base font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
          >
            Import · {deck.name}
          </h2>
          <button
            type="button"
            data-testid="import-into-deck-modal-close"
            aria-label="Close"
            onClick={onClose}
            disabled={importing}
            className="rounded-md px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            ×
          </button>
        </header>

        <fieldset className="flex flex-col gap-2">
          <legend
            className="text-[11px] font-semibold uppercase text-text-secondary"
            style={{ letterSpacing: '0.1em' }}
          >
            Mode
          </legend>
          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="radio"
              data-testid="import-mode-overwrite"
              name="import-mode"
              checked={mode === 'overwrite'}
              onChange={() => setMode('overwrite')}
              disabled={importing}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Overwrite this deck</span>
              <span className="block text-xs text-text-secondary">
                Replace cards in "{deck.name}" — deck name and identity preserved.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-text-primary">
            <input
              type="radio"
              data-testid="import-mode-replace"
              name="import-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
              disabled={importing}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Trash and start over</span>
              <span className="block text-xs text-text-secondary">
                Delete "{deck.name}" and create a new deck (same name) from the paste.
              </span>
            </span>
          </label>
        </fieldset>

        <textarea
          data-testid="import-into-deck-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={false}
          autoFocus
          placeholder={
            '4 Lightning Bolt\n'
            + '4 Counterspell\n'
            + '20 Island\n'
            + '\n'
            + 'Sideboard\n'
            + '2 Negate'
          }
          className="rounded-md border bg-bg-base px-3 py-2 font-mono text-sm text-text-primary placeholder-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          style={{ borderColor: 'var(--color-card-frame-default)' }}
        />
        <p className="text-xs text-text-secondary">
          Accepts MTGA / MTGO / Moxfield / Archidekt exports. Trailing
          <code> (SET) NUM</code> annotations are stripped.
        </p>

        {error && (
          <pre
            role="alert"
            data-testid="import-into-deck-error"
            className="whitespace-pre-wrap font-sans text-sm text-status-danger"
          >
            {error}
          </pre>
        )}

        <div className="flex items-center justify-end gap-3">
          <span
            className="text-[10px] uppercase text-text-muted"
            style={{ letterSpacing: '0.1em' }}
          >
            ⌘/Ctrl + Enter
          </span>
          <button
            type="button"
            data-testid="import-into-deck-cancel"
            onClick={onClose}
            disabled={importing}
            className="rounded-md border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="import-into-deck-submit"
            disabled={importing}
            className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-on-accent transition-opacity hover:opacity-90 disabled:bg-surface-card disabled:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {importing ? 'Resolving…' : mode === 'overwrite' ? 'Overwrite' : 'Trash + new'}
          </button>
        </div>
      </form>
    </div>
  );
}
