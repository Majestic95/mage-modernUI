/**
 * "New Deck" modal launched from the deck-builder workbench's
 * MyDecksPanel rail. Lifts the legacy {@code Decks.tsx} ImportForm
 * into a modal so the import flow becomes a single, discoverable
 * affordance instead of a permanent page section.
 *
 * <p>Flow: type a name + paste decklist text → click Import →
 * {@link parseDeckText} parses the lines → {@link resolveDeckLists}
 * resolves every name against /api/cards → {@link useDecksStore.add}
 * persists locally → {@code onCreated(deckId)} fires so the workbench
 * can switch the active deck to the freshly-created one.
 *
 * <p>Error surfaces preserved verbatim from the legacy flow:
 * parser errors ("Line 1: ..."), missing-card resolution failures,
 * and resolveDeckLists exceptions all land in the same alert region.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseDeckText } from '../decks/parse';
import { resolveDeckLists } from '../decks/resolve';
import { useDecksStore } from '../decks/store';
import { useAuthStore } from '../auth/store';

interface Props {
  onClose: () => void;
  onCreated: (deckId: string) => void;
}

export function NewDeckModal({ onClose, onCreated }: Props) {
  const session = useAuthStore((s) => s.session);
  const addDeck = useDecksStore((s) => s.add);

  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fix-2 B2 — stash + restore focus on close (a11y for keyboard
  // users; the modal currently auto-focuses the name input, so on
  // close we need to send focus back to the opener button).
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

  // fix-2 N1+B1+B3 — keyboard handling:
  //   Escape → close (suppressed while a resolve is in flight).
  //   Cmd/Ctrl+Enter → submit the form (Moxfield/MTGA expectation).
  //   Tab/Shift+Tab → focus-trap cycle inside the dialog.
  // Wired on window so the textarea (which swallows Enter) still
  // hears Cmd+Enter via the modifier check.
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

  const onImport = async (e: FormEvent) => {
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
    let createdDeckId: string | null = null;
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
      const deck = addDeck(name, result.cards, result.sideboard);
      createdDeckId = deck.id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
    // Tech critic B1 — flip the parent's modal-open flag AFTER setImporting
    // settles so the success path doesn't fire setState on an unmounted
    // component. onCreated → parent setNewDeckOpen(false) → unmount.
    if (createdDeckId !== null) onCreated(createdDeckId);
  };

  return (
    <div
      data-testid="new-deck-modal-backdrop"
      // fix-2 B13 — backdrop-blur softens the workbench underneath.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'var(--color-bg-overlay)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
      role="presentation"
    >
      <form
        ref={dialogRef}
        data-testid="new-deck-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create a new deck"
        onSubmit={onImport}
        className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          boxShadow: 'var(--shadow-high)',
        }}
      >
        <header className="flex items-center justify-between">
          <h2
            className="text-base font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
          >
            New Deck
          </h2>
          <button
            type="button"
            data-testid="new-deck-modal-close"
            aria-label="Close"
            onClick={onClose}
            disabled={importing}
            // fix-2 B15 — focus-visible ring for keyboard parity.
            className="rounded-md px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            ×
          </button>
        </header>

        <input
          type="text"
          data-testid="new-deck-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deck name"
          autoFocus
          className="rounded-md border bg-bg-base px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          style={{ borderColor: 'var(--color-card-frame-default)' }}
        />

        <textarea
          data-testid="new-deck-text-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          spellCheck={false}
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
          Accepts MTGA / MTGO / Moxfield / Archidekt exports. Sideboard
          starts after a blank line or a <code>Sideboard</code> header.
          Trailing <code>(SET) NUM</code> annotations are stripped.
        </p>

        {error && (
          <pre
            role="alert"
            data-testid="new-deck-error"
            className="whitespace-pre-wrap font-sans text-sm text-status-danger"
          >
            {error}
          </pre>
        )}

        <div className="flex items-center justify-end gap-3">
          {/* fix-2 B1 hint — surface the keyboard shortcut so users
              discover it (Moxfield power-user expectation). */}
          <span
            className="text-[10px] uppercase text-text-muted"
            style={{ letterSpacing: '0.1em' }}
          >
            ⌘/Ctrl + Enter
          </span>
          <button
            type="button"
            data-testid="new-deck-cancel"
            onClick={onClose}
            disabled={importing}
            className="rounded-md border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="new-deck-submit"
            disabled={importing}
            className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-on-accent transition-opacity hover:opacity-90 disabled:bg-surface-card disabled:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {importing ? 'Resolving…' : 'Import deck'}
          </button>
        </div>
      </form>
    </div>
  );
}
