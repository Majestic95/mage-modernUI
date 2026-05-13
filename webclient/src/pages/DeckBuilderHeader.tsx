/**
 * Header strip for the deck-builder workbench. Sibling to
 * {@code LobbyHeader} — same chrome (clamp() font, uppercase title,
 * letter-spacing), different content: editable deck name, mainboard /
 * sideboard counts, format picker, live legality pill, and a delete
 * affordance with confirm modal.
 *
 * <p>Legality pipeline reuses {@code useDeckLegality} +
 * {@code useDeckTypes} from the existing Decks page so the
 * pre-flight contract (/api/decks/validate, 250 ms debounce, seq
 * check) is identical.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
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
            className="truncate text-left font-semibold uppercase leading-none transition-colors hover:text-accent-primary"
            style={{
              fontSize: 'clamp(20px, 1.6vw + 0.5rem, 28px)',
              letterSpacing: '0.04em',
              color: 'var(--color-text-primary)',
            }}
          >
            {deck.name}
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
            className="rounded-md border bg-bg-base px-3 py-1 font-semibold uppercase text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{
              borderColor: 'var(--color-card-frame-default)',
              fontSize: 'clamp(20px, 1.6vw + 0.5rem, 28px)',
              letterSpacing: '0.04em',
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

      {deleteConfirmOpen && (
        <DeleteConfirmModal
          deckName={deck.name}
          onConfirm={onDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </header>
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
      className="flex flex-col items-center gap-1 rounded-xl border px-5 py-2"
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
        className="rounded-md border bg-bg-base px-2 py-1 text-xs text-text-primary disabled:opacity-50"
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
    return (
      <span
        data-testid="legality-pill-idle"
        className="text-[10px] uppercase text-text-muted"
        style={{ letterSpacing: '0.1em' }}
      >
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
  // UI/UX critic N1 — Escape-to-close mirrors NewDeckModal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  return (
    <div
      data-testid="delete-confirm-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg-overlay)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
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
            className="rounded-md bg-status-danger px-4 py-2 text-sm font-medium text-text-on-accent transition-opacity hover:opacity-90"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

