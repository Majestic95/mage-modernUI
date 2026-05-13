/**
 * Confirm-modal for the deck-builder header's destructive Delete
 * action. Extracted from DeckBuilderHeader during slice DB-1a-fix-5
 * to keep the header file under the 400 LOC soft cap. Behavior
 * preserved verbatim: Esc / backdrop click cancel, Cancel autoFocus,
 * focus trap inside the dialog, focus restored to opener on close.
 */
import { useEffect, useRef } from 'react';

interface Props {
  deckName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeckBuilderDeleteConfirmModal({
  deckName,
  onConfirm,
  onCancel,
}: Props) {
  // Stash + restore focus so keyboard users don't lose their place.
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    prevFocusRef.current =
      (document.activeElement instanceof HTMLElement)
        ? document.activeElement
        : null;
    return () => {
      prevFocusRef.current?.focus();
    };
  }, []);

  // Escape to cancel + Tab/Shift+Tab focus trap.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
  }, [onCancel]);

  return (
    <div
      data-testid="delete-confirm-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'var(--color-bg-overlay)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        data-testid="delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        aria-describedby="delete-confirm-body"
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          boxShadow: 'var(--shadow-high)',
        }}
      >
        <h2
          id="delete-confirm-title"
          className="text-base font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.12em' }}
        >
          Delete this deck?
        </h2>
        <p
          id="delete-confirm-body"
          className="text-sm text-text-secondary"
        >
          Permanently delete <span className="text-text-primary">{deckName}</span>?
          This cannot be undone — the deck is removed from local storage.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="delete-confirm-cancel"
            autoFocus
            onClick={onCancel}
            className="rounded-md border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="delete-confirm-confirm"
            onClick={onConfirm}
            className="rounded-md bg-status-danger px-4 py-2 text-sm font-medium text-text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
