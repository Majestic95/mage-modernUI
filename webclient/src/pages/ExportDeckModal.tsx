/**
 * Export-deck modal — renders the active deck as plain text (one
 * `<qty> <cardName>` per line, blank line + "Sideboard" header to
 * separate mainboard from sideboard) in a read-only textarea, with
 * a Copy-to-Clipboard button. The format matches what
 * {@code parseDeckText} accepts so a user can round-trip via paste.
 *
 * <p>Per the 2026-05-12 separation directive, deck-builder-specific.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SavedDeck } from '../decks/store';

interface Props {
  deck: SavedDeck;
  onClose: () => void;
}

export function ExportDeckModal({ deck, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const decklistText = useMemo(() => decksToPlainText(deck), [deck]);

  // Focus restore + Esc to close + focus trap (mirrors NewDeckModal).
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
      if (e.key === 'Escape') {
        onClose();
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
  }, [onClose]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(decklistText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers / contexts block writeText; fall back to a
      // selection prompt the user can Ctrl+C manually.
      const ta = dialogRef.current?.querySelector<HTMLTextAreaElement>(
        'textarea',
      );
      ta?.select();
    }
  };

  return (
    <div
      data-testid="export-deck-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: 'var(--color-bg-overlay)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        data-testid="export-deck-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-deck-title"
        className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border p-6"
        style={{
          background: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-card-frame-default)',
          boxShadow: 'var(--shadow-high)',
        }}
      >
        <header className="flex items-center justify-between">
          <h2
            id="export-deck-title"
            className="text-base font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
          >
            Export · {deck.name}
          </h2>
          <button
            type="button"
            data-testid="export-deck-modal-close"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            ×
          </button>
        </header>

        <textarea
          data-testid="export-deck-text"
          value={decklistText}
          readOnly
          rows={14}
          spellCheck={false}
          className="rounded-md border bg-bg-base px-3 py-2 font-mono text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          style={{ borderColor: 'var(--color-card-frame-default)' }}
        />
        <p className="text-xs text-text-secondary">
          Compatible with MTGA / MTGO / Moxfield / Archidekt paste-import.
          Sideboard separated by a blank line + <code>Sideboard</code> header.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="export-deck-close"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="export-deck-copy"
            onClick={() => void onCopy()}
            className="rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copied ? 'Copied ✓' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Convert a SavedDeck to the plain-text format parseDeckText accepts.
 * Round-trips: parseDeckText(decksToPlainText(d)) yields the same
 * mainboard + sideboard entries (modulo per-printing setCode/cardNumber,
 * which the format intentionally drops — printings are resolved at
 * import time against the local /api/cards endpoint).
 */
export function decksToPlainText(deck: SavedDeck): string {
  const lines: string[] = [];
  for (const c of deck.cards) {
    lines.push(`${c.amount} ${c.cardName}`);
  }
  if (deck.sideboard.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const c of deck.sideboard) {
      lines.push(`${c.amount} ${c.cardName}`);
    }
  }
  return lines.join('\n');
}
