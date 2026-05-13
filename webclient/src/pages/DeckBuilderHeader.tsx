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
import { useDeckLegality } from '../decks/useDeckLegality';
import { useDeckTypes } from '../decks/useDeckTypes';
import { useAuthStore } from '../auth/store';
import { DeckBuilderDeleteConfirmModal } from './DeckBuilderDeleteConfirmModal';
import { DeckBuilderFormatLegality } from './DeckBuilderFormatLegality';
import { DeckBuilderSettingsButton } from './DeckBuilderSettingsButton';
import { DeckLegalityIssuesModal } from './DeckLegalityIssuesModal';
import { ExportDeckModal } from './ExportDeckModal';
import { ImportIntoDeckModal } from './ImportIntoDeckModal';

interface Props {
  deck: SavedDeck;
  onDeleted: () => void;
  /**
   * fix-5 — fired when the Import modal's "trash and start over"
   * mode swaps the active deck. Workbench updates activeDeckId to
   * the freshly-created deck's id.
   */
  onDeckReplaced: (newDeckId: string) => void;
}

export function DeckBuilderHeader({ deck, onDeleted, onDeckReplaced }: Props) {
  const token = useAuthStore((s) => s.session?.token);
  const updateDeck = useDecksStore((s) => s.update);
  const removeDeck = useDecksStore((s) => s.remove);

  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [deckType, setDeckType] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // fix-6 — when the legality pill verdict has errors, the user can
  // click the pill to open a draggable floating panel listing each
  // issue. State lives at the header level so the panel mounts as a
  // sibling (not inside the pill's <button>).
  const [legalityIssuesOpen, setLegalityIssuesOpen] = useState(false);

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

        <DeckBuilderFormatLegality
          deckTypes={deckTypes.grouped}
          deckTypesLoading={deckTypes.loading}
          token={token}
          deckName={deck.name}
          deckType={deckType}
          onDeckTypeChange={setDeckType}
          status={status}
          onPillClick={() => setLegalityIssuesOpen(true)}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* fix-5 — Import + Export + (fix-8) Settings affordances
              cluster in the right header slot next to Delete.
              Settings comes first (leftmost) as the lightest-weight
              action; Delete stays rightmost as the most destructive. */}
          <DeckBuilderSettingsButton />
          <button
            type="button"
            data-testid="deck-builder-import"
            onClick={() => setImportOpen(true)}
            className="rounded-md border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-primary/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Import
          </button>
          <button
            type="button"
            data-testid="deck-builder-export"
            onClick={() => setExportOpen(true)}
            className="rounded-md border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent-primary/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            style={{ borderColor: 'var(--color-card-frame-default)' }}
          >
            Export
          </button>
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
        <DeckBuilderDeleteConfirmModal
          deckName={deck.name}
          onConfirm={onDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
      {exportOpen && (
        <ExportDeckModal
          deck={deck}
          onClose={() => setExportOpen(false)}
        />
      )}
      {importOpen && (
        <ImportIntoDeckModal
          deck={deck}
          onClose={() => setImportOpen(false)}
          onDeckReplaced={(newId) => {
            setImportOpen(false);
            onDeckReplaced(newId);
          }}
        />
      )}
      {legalityIssuesOpen && status.kind === 'verdict' && status.errors.length > 0 && (
        <DeckLegalityIssuesModal
          deckName={deck.name}
          format={deckType}
          partlyLegal={status.partlyLegal}
          errors={status.errors}
          onClose={() => setLegalityIssuesOpen(false)}
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

