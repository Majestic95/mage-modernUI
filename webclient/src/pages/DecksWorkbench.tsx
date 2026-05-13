/**
 * Slice DB-1a — deck-builder workbench. Replaces the legacy Decks
 * page (paste-import form + list-of-saved-decks-with-Edit-button)
 * with a full-page workbench mirroring the lobby's chrome — same
 * nebula gradient backdrop, design tokens, elevated panels, but the
 * App-level nav header replaces the lobby's own LobbyTopBar (slice
 * DB-1a-fix-1 dropped the duplicate). Layout:
 *
 * <ul>
 *   <li>{@link DeckBuilderHeader} — deck name (editable) + format
 *       picker + live legality pill + counts + delete affordance.</li>
 *   <li>3-column grid:
 *     <ol>
 *       <li>Left: {@link MyDecksPanel} reused from the lobby. Wires
 *           {@code onDeckSelect} for direct-switch auto-save AND
 *           {@code onNewDeck} to launch the import modal.</li>
 *       <li>Center: embedded {@link DeckEditor} for search + lanes.</li>
 *       <li>Right (stacked): {@link CommanderPreviewPanel} on top,
 *           {@link DeckPreviewPanel} (analytics — mana curve / type
 *           counts / color pips) underneath.</li>
 *     </ol>
 *   </li>
 *   <li>{@link NewDeckModal} for paste-to-create-new flow, launched
 *       from the rail's "New Deck" button.</li>
 * </ul>
 *
 * <p>All deck data flows through {@link useLiveDecks}, which already
 * converts {@link SavedDeck} → {@link LobbyDeck} for the lobby panels
 * and handles per-card metadata caching + stats computation. The
 * workbench owns the active-deck UI state; useLiveDecks owns the
 * wire-side card cache.
 */
import { useEffect, useState } from 'react';
import { CommanderPreviewPanel } from '../lobby/CommanderPreviewPanel';
import { DeckPreviewPanel } from '../lobby/DeckPreviewPanel';
import { MyDecksPanel } from '../lobby/MyDecksPanel';
import { useLiveDecks } from '../lobby/useLiveDecks';
import { useDecksStore } from '../decks/store';
import { DeckBuilderHeader } from './DeckBuilderHeader';
import { DeckEditor } from './DeckEditor';
import { NewDeckModal } from './NewDeckModal';

export function DecksWorkbench() {
  const savedDecks = useDecksStore((s) => s.decks);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(
    savedDecks[0]?.id ?? null,
  );
  const [newDeckOpen, setNewDeckOpen] = useState(false);

  // Auto-select the first deck when the user adds one from empty
  // state, and recover from a deleted active deck (cross-tab or
  // local delete) by routing to whatever's still in the list.
  useEffect(() => {
    if (activeDeckId && savedDecks.some((d) => d.id === activeDeckId)) return;
    setActiveDeckId(savedDecks[0]?.id ?? null);
  }, [savedDecks, activeDeckId]);

  const { decks: lobbyDecks, selectedDeck: lobbySelectedDeck, selectedStatsLoading } =
    useLiveDecks(activeDeckId);

  const activeSavedDeck =
    savedDecks.find((d) => d.id === activeDeckId) ?? null;

  const onDeckCreated = (deckId: string) => {
    setActiveDeckId(deckId);
    setNewDeckOpen(false);
  };

  const onDeckDeleted = () => {
    // useEffect above recovers activeDeckId to the new first deck (or null).
  };

  return (
    <div
      data-testid="decks-workbench"
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-bg-base text-text-primary"
      style={{
        // Matches NewLobbyScreen's nebula gradient for visual continuity.
        backgroundImage:
          'radial-gradient(ellipse 90% 60% at 50% 35%, rgba(139, 92, 246, 0.18) 0%, rgba(76, 29, 149, 0.08) 35%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(91, 192, 240, 0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 30% at 15% 90%, rgba(168, 85, 247, 0.10) 0%, transparent 60%)',
      }}
    >
      <main
        className="grid min-h-0 flex-1 gap-3 px-5 py-4"
        style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}
      >
        {activeSavedDeck ? (
          <DeckBuilderHeader
            deck={activeSavedDeck}
            onDeleted={onDeckDeleted}
          />
        ) : (
          <EmptyHeader onNewDeck={() => setNewDeckOpen(true)} />
        )}

        <section
          data-testid="decks-workbench-grid"
          className="grid h-full min-h-0 gap-3"
          style={{
            gridTemplateColumns:
              'minmax(220px, 260px) minmax(0, 1fr) minmax(300px, 360px)',
          }}
        >
          <MyDecksPanel
            decks={lobbyDecks}
            selectedDeckId={activeDeckId ?? ''}
            onDeckSelect={setActiveDeckId}
            onNewDeck={() => setNewDeckOpen(true)}
          />

          <div
            data-testid="decks-workbench-editor-column"
            className="flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border p-3"
            style={{
              background: 'rgba(21, 34, 41, 0.85)',
              borderColor: 'var(--color-card-frame-default)',
              boxShadow: 'var(--shadow-low)',
            }}
          >
            {activeSavedDeck ? (
              <DeckEditor
                // Tech critic N2 — re-key on deck switch so any
                // open ArtPicker / rename draft / scroll position
                // is reset cleanly when the user picks another deck.
                key={activeSavedDeck.id}
                deckId={activeSavedDeck.id}
                onClose={() => setActiveDeckId(null)}
                embedded
              />
            ) : (
              <EditorEmptyState onNewDeck={() => setNewDeckOpen(true)} />
            )}
          </div>

          {/* UI/UX critic B1 — when no deck is active, suppress the
              right-column panels entirely so the empty state reads
              as "pick or build a deck," not "this app is broken." */}
          {activeSavedDeck ? (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="min-h-0 flex-[1.3]">
                <CommanderPreviewPanel deck={lobbySelectedDeck} />
              </div>
              <div className="min-h-0 flex-1">
                <DeckPreviewPanel
                  deck={lobbySelectedDeck}
                  statsLoading={selectedStatsLoading}
                />
              </div>
            </div>
          ) : (
            <EmptyPreviewPlaceholder />
          )}
        </section>
      </main>

      {newDeckOpen && (
        <NewDeckModal
          onClose={() => setNewDeckOpen(false)}
          onCreated={onDeckCreated}
        />
      )}
    </div>
  );
}

function EmptyHeader({ onNewDeck }: { onNewDeck: () => void }) {
  return (
    <header
      data-testid="decks-workbench-empty-header"
      className="grid items-center gap-4 pt-2"
      style={{ gridTemplateColumns: '1fr auto 1fr' }}
    >
      <h1
        className="font-semibold uppercase leading-none"
        style={{
          fontSize: 'clamp(20px, 1.6vw + 0.5rem, 28px)',
          letterSpacing: '0.04em',
        }}
      >
        <span className="text-text-primary">Deck</span>{' '}
        <span className="text-accent-primary">Workbench</span>
      </h1>
      <div aria-hidden="true" />
      {/* UI/UX critic B2 — empty header now surfaces the New Deck CTA
          in the right slot so first-launch users have a discoverable
          affordance at the title-bar level (mirrors the populated
          header's Delete-deck slot). */}
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="decks-workbench-empty-header-new-deck"
          onClick={onNewDeck}
          // fix-2 B15 — focus-visible ring for keyboard parity.
          className="rounded-md bg-accent-primary px-4 py-1.5 text-sm font-medium text-text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          New Deck
        </button>
      </div>
    </header>
  );
}

function EmptyPreviewPlaceholder() {
  return (
    <div
      data-testid="decks-workbench-preview-empty"
      // fix-2 B10 — richer placeholder so the empty right column
      // reads as "intentional gap" not "blank/loading box."
      className="flex h-full min-h-0 flex-col items-center justify-center gap-3 rounded-xl border p-6 text-center"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        borderColor: 'var(--color-card-frame-default)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <DeckPlaceholderGlyph />
      <p className="text-sm text-text-secondary">
        Pick a deck on the left, or start a new one.
      </p>
      <p
        className="text-[10px] uppercase text-text-muted"
        style={{ letterSpacing: '0.12em' }}
      >
        Preview · curve · color identity
      </p>
    </div>
  );
}

function DeckPlaceholderGlyph() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-text-muted opacity-60"
    >
      <rect x="6" y="4" width="11" height="16" rx="1.5" />
      <rect x="9" y="2" width="11" height="16" rx="1.5" />
      <rect x="3" y="6" width="11" height="16" rx="1.5" fill="currentColor" fillOpacity="0.18" />
    </svg>
  );
}

function EditorEmptyState({ onNewDeck }: { onNewDeck: () => void }) {
  // fix-2 B9 — empty-state now has TWO CTAs total (rail bottom +
  // EmptyHeader right slot). The center column shows just the
  // contextual hint and a quieter inline "Start one now" affordance
  // so it doesn't compete for primary-CTA gravity.
  return (
    <div
      data-testid="decks-workbench-editor-empty"
      className="flex h-full flex-col items-center justify-center gap-4 text-center text-text-secondary"
    >
      <p className="text-sm">
        No deck selected. Pick one from the rail, or{' '}
        <button
          type="button"
          data-testid="decks-workbench-empty-new-deck"
          onClick={onNewDeck}
          className="font-medium text-accent-primary underline underline-offset-2 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-sm"
        >
          start a new one
        </button>
        .
      </p>
    </div>
  );
}
