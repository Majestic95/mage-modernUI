/**
 * Header strip for the deck-builder workbench. Sibling to
 * {@code LobbyHeader} — same chrome (clamp() font, letter-spacing,
 * elevated panel for status), different content: editable deck name,
 * mainboard / sideboard counts, format picker, live legality pill,
 * and a delete affordance with confirm modal.
 *
 * <p>The deck-name slot does NOT use uppercase — it surfaces the
 * user's typed value verbatim (fix-2 B5). The lobby's all-caps title
 * works because it's a category label ("COMMANDER LOBBY"); a user-
 * typed deck name shouted in caps reads as disrespectful of input.
 *
 * <p>Legality pipeline reuses {@code useDeckLegality} +
 * {@code useDeckTypes} from the existing Decks page so the
 * pre-flight contract (/api/decks/validate, 250 ms debounce, seq
 * check) is identical.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toRequestBody, useDecksStore, type SavedDeck } from '../decks/store';
import {
  useDeckLegality,
  type LegalityStatus,
} from '../decks/useDeckLegality';
import { useDeckTypes, type DeckTypeGroup } from '../decks/useDeckTypes';
import { useAuthStore } from '../auth/store';

interface Props {
  deck: SavedDeck;
  onDeleted: () => void;
}

export function DeckBuilderHeader({ deck, onDeleted }: Props) {
  const token = useAuthStore((s) => s.session?.token);
  const updateDeck = useDecksStore((s) => s.update);
  const removeDeck = useDecksStore((s) => s.remove);

  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [deckType, setDeckType] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const deckTypes = useDeckTypes(token);
  const deckBody = useMemo(() => toRequestBody(deck, ''), [deck]);
  const status = useDeckLegality({ deck: deckBody, deckType, token });

  const mainboardCount = deck.cards.reduce((s, c) => s + c.amount, 0);
  const sideboardCount = deck.sideboard.reduce((s, c) => s + c.amount, 0);

  // fix-2 A1 — rename-on-rail-switch safety. The rename input commits
  // on Enter/Escape/blur, BUT clicking a rail row to switch decks
  // races against blur (the rail-click setState batches, the closure
  // capture order of onBlur=commitName depends on focus-then-click
  // ordering across browsers, and React 18's automatic batching makes
  // it ambiguous which deck the rename lands on). Defensive fix: when
  // deck.id changes (rail-switch OR unmount), commit any in-flight
  // rename to the PREVIOUS deck via useEffect cleanup — at cleanup
  // time the `deck` closure is the previous render's deck. The ref
  // carries the latest renameDraft so the cleanup sees the live value.
  const renameDraftRef = useRef<string | null>(null);
  useEffect(() => {
    renameDraftRef.current = renameDraft;
  }, [renameDraft]);
  useEffect(() => {
    return () => {
      const draft = renameDraftRef.current;
      if (draft !== null) {
        updateDeck(deck.id, { name: draft });
      }
    };
  }, [deck.id, updateDeck]);

  const commitName = () => {
    if (renameDraft === null) return;
    updateDeck(deck.id, { name: renameDraft });
    setRenameDraft(null);
  };

  const onDelete = () => {
    removeDeck(deck.id);
    setDeleteConfirmOpen(false);
    onDeleted();
  };

  return (
    <Fragment>
      {/* fix-2 B14 — DeleteConfirmModal lifted out of <header>'s grid.
          Previously it sat as a grid child relying on `fixed inset-0`
          to escape flow; functional but brittle if a future edit drops
          `fixed`. Now it's a Fragment sibling, scope-wise still owned
          by this component. */}
      <header
        data-testid="deck-builder-header"
        className="grid items-center gap-4 pt-2"
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
      >
        <div className="flex flex-col gap-0.5 min-w-0">
          {renameDraft === null ? (
            <button
              type="button"
              data-testid="deck-builder-rename"
              onClick={() => setRenameDraft(deck.name)}
              title="Rename deck"
              // fix-2 B5 — no `uppercase` (user-typed content).
              // fix-2 B6 — pencil glyph after the name surfaces the
              // edit affordance instead of relying on hover-color alone.
              className="group flex items-center gap-2 truncate text-left font-semibold leading-none transition-colors hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-sm"
              style={{
                fontSize: 'clamp(20px, 1.6vw + 0.5rem, 28px)',
                letterSpacing: '0.01em',
                color: 'var(--color-text-primary)',
              }}
            >
              <span className="truncate">{deck.name}</span>
              <PencilGlyph />
            </button>
          ) : (
            <input
              type="text"
              autoFocus
              data-testid="deck-builder-rename-input"
              value={renameDraft}
              maxLength={64}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitName();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenameDraft(null);
                }
              }}
              className="rounded-md border bg-bg-base px-3 py-1 font-semibold text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              style={{
                borderColor: 'var(--color-card-frame-default)',
                fontSize: 'clamp(20px, 1.6vw + 0.5rem, 28px)',
                letterSpacing: '0.01em',
              }}
            />
          )}
          <p
            data-testid="deck-builder-subtitle"
            className="text-xs text-text-secondary"
            style={{ letterSpacing: '0.02em' }}
          >
            {mainboardCount} mainboard · {sideboardCount} sideboard
          </p>
        </div>

        <FormatAndLegalityCluster
          deckTypes={deckTypes.grouped}
          deckTypesLoading={deckTypes.loading}
          token={token}
          deckName={deck.name}
          deckType={deckType}
          onDeckTypeChange={setDeckType}
          status={status}
        />

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="deck-builder-delete"
            aria-label={`Delete ${deck.name}`}
            onClick={() => setDeleteConfirmOpen(true)}
            className="rounded-md border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-status-danger/60 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Delete deck
          </button>
        </div>
      </header>

      {deleteConfirmOpen && (
        <DeleteConfirmModal
          deckName={deck.name}
          onConfirm={onDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </Fragment>
  );
}

/**
 * fix-2 B6 — tiny pencil glyph appended to the rename target so the
 * affordance is visible at rest, not just on hover. Opacity bumps on
 * hover for emphasis but the icon is always present.
 */
function PencilGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function FormatAndLegalityCluster({
  deckTypes,
  deckTypesLoading,
  token,
  deckName,
  deckType,
  onDeckTypeChange,
  status,
}: {
  deckTypes: DeckTypeGroup[];
  deckTypesLoading: boolean;
  token: string | undefined;
  deckName: string;
  deckType: string;
  onDeckTypeChange: (v: string) => void;
  status: LegalityStatus;
}) {
  return (
    <div
      // fix-2 B13 — backdrop-blur-sm parity with lobby StatusPill so
      // the elevated cluster softens the nebula gradient underneath.
      className="flex flex-col items-center gap-1 rounded-xl border px-5 py-2 backdrop-blur-sm"
      style={{
        background: 'rgba(26, 38, 48, 0.7)',
        borderColor: 'var(--color-card-frame-default)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <select
        data-testid="deck-builder-format-picker"
        value={deckType}
        onChange={(e) => onDeckTypeChange(e.target.value)}
        disabled={deckTypesLoading || !token}
        aria-label={`Format for ${deckName}`}
        // fix-2 B16 — disabled cursor + opacity dimming so the
        // disabled state reads consistently across browsers (default
        // <select> cursor on disabled varies by OS).
        className="rounded-md border bg-bg-base px-2 py-1 text-xs text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ borderColor: 'var(--color-card-frame-default)' }}
      >
        <option value="">— pick a format —</option>
        {deckTypes.map((group, i) => (
          <Fragment key={group.label || `flat-${i}`}>
            {group.label ? (
              <optgroup label={group.label}>
                {group.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.startsWith(`${group.label} - `)
                      ? opt.slice(group.label.length + 3)
                      : opt}
                  </option>
                ))}
              </optgroup>
            ) : (
              <optgroup label="Other">
                {group.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </optgroup>
            )}
          </Fragment>
        ))}
      </select>
      <LegalityPill status={status} />
    </div>
  );
}

function LegalityPill({ status }: { status: LegalityStatus }) {
  if (status.kind === 'idle') {
    // fix-2 B7 — idle pill now carries the same dot+text shape as
    // the verdict pill so a glanced-at format dropdown is visibly
    // "waiting for input" rather than blending into the chrome.
    return (
      <span
        data-testid="legality-pill-idle"
        className="inline-flex items-center gap-1 text-[11px] font-medium uppercase text-text-muted"
        style={{ letterSpacing: '0.08em' }}
      >
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full border border-text-muted"
        />
        Pick a format
      </span>
    );
  }
  const { dotClass, textClass, label } = pillAppearance(status);
  return (
    <span
      data-testid="legality-pill"
      aria-live="polite"
      className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase ${textClass}`}
      style={{ letterSpacing: '0.08em' }}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

function pillAppearance(
  status: Exclude<LegalityStatus, { kind: 'idle' }>,
): { dotClass: string; textClass: string; label: string } {
  if (status.kind === 'loading') {
    return {
      dotClass: 'bg-text-muted',
      textClass: 'text-text-muted italic',
      label: 'Checking…',
    };
  }
  if (status.kind === 'error') {
    return {
      dotClass: 'bg-status-warning',
      textClass: 'text-status-warning',
      label: 'Could not check',
    };
  }
  if (status.valid) {
    return {
      dotClass: 'bg-status-success',
      textClass: 'text-status-success',
      label: 'Legal',
    };
  }
  const realCount = status.errors.filter((e) => !e.synthetic).length;
  const issueWord = realCount === 1 ? 'issue' : 'issues';
  if (status.partlyLegal) {
    return {
      dotClass: 'bg-status-warning',
      textClass: 'text-status-warning',
      label: `Legal once finished · ${realCount} ${issueWord}`,
    };
  }
  return {
    dotClass: 'bg-status-danger',
    textClass: 'text-status-danger',
    label: `Not legal · ${realCount} ${issueWord}`,
  };
}

function DeleteConfirmModal({
  deckName,
  onConfirm,
  onCancel,
}: {
  deckName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // fix-2 B2 — stash the previously focused element and restore on
  // unmount so keyboard users don't lose their place when the modal
  // closes (Esc / Cancel / Confirm / backdrop).
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

  // fix-2 B3 — focus trap. Tab/Shift+Tab cycle inside the dialog;
  // any other key passes through. Pairs with aria-modal="true" so the
  // contract isn't a lie.
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
      // fix-2 B13 — backdrop-blur softens the workbench underneath so
      // the destructive-action focus is unambiguous.
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
