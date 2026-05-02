/**
 * Slice L1 — left-bottom My Decks list. Renders the user's saved
 * decks with thumbnail, name, commander, and color identity pips.
 * Slice L6 wires {@code useDeckStore} for real data.
 */
import type { LobbyColor, LobbyDeck } from './fixtures';
import { ColorPipRow } from './ColorPipRow';

interface Props {
  decks: LobbyDeck[];
  selectedDeckId: string;
  /**
   * Slice L6 — fired when the user clicks a deck row. The lobby
   * container takes the deck and PUTs it to the server. Optional
   * so fixture mode renders without a wire side-effect.
   */
  onDeckSelect?: (deckId: string) => void;
  /** Disabled state for the deck rows (e.g. while a PUT is in flight). */
  disabled?: boolean;
}

export function MyDecksPanel({
  decks,
  selectedDeckId,
  onDeckSelect,
  disabled = false,
}: Props) {
  return (
    <aside
      data-testid="my-decks-panel"
      className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-card-frame-default/60 p-3"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <header className="flex items-center justify-between">
        <h2
          className="text-xs font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.14em' }}
        >
          My Decks
        </h2>
      </header>

      <ul
        data-testid="my-decks-list"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
      >
        {decks.length === 0 && (
          <li
            data-testid="my-decks-empty"
            className="px-2 py-3 text-xs text-text-secondary"
          >
            No saved decks yet. Build one from the Decks tab.
          </li>
        )}
        {decks.map((deck) => (
          <DeckRow
            key={deck.id}
            deck={deck}
            selected={deck.id === selectedDeckId}
            onSelect={onDeckSelect}
            disabled={disabled}
          />
        ))}
      </ul>

      <button
        type="button"
        data-testid="my-decks-new-deck-button"
        className="rounded-md border border-card-frame-default/80 px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-accent-primary/60 hover:text-text-primary"
      >
        New Deck
      </button>
    </aside>
  );
}

function DeckRow({
  deck,
  selected,
  onSelect,
  disabled,
}: {
  deck: LobbyDeck;
  selected: boolean;
  onSelect?: (deckId: string) => void;
  disabled?: boolean;
}) {
  return (
    <li
      data-testid="my-decks-row"
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      role={onSelect ? 'button' : undefined}
      // Slice L6 polish — keep rows in the tab order regardless of
      // selected/disabled state so keyboard nav doesn't drop focus to
      // <body> mid-list. Rely on aria-disabled / aria-current to
      // communicate state, not removal from the tab sequence.
      tabIndex={onSelect ? 0 : undefined}
      aria-disabled={disabled || undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={() => {
        if (onSelect && !disabled && !selected) onSelect(deck.id);
      }}
      onKeyDown={(e) => {
        if (!onSelect || disabled || selected) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(deck.id);
        }
      }}
      className={
        'flex items-center gap-2 rounded-md border p-1.5 transition-colors '
        + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring '
        + (disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
        + (onSelect && !disabled && !selected
          ? ' hover:bg-surface-card-hover'
          : '')
      }
      style={{
        background: selected
          ? 'var(--color-surface-card-active)'
          : 'transparent',
        borderColor: selected
          ? 'var(--color-accent-primary)'
          : 'transparent',
      }}
    >
      <div
        className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-md"
        style={{ background: 'var(--color-bg-elevated)' }}
      >
        {deck.commanderArtUrl ? (
          <img
            src={deck.commanderArtUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <p className="truncate text-xs font-medium text-text-primary">
          {deck.name}
        </p>
        <p className="truncate text-[10px] text-text-secondary">
          {deck.commanderName}
        </p>
      </div>
      <ColorPipRow colors={deck.colorIdentity} size="sm" />
    </li>
  );
}

void (null as LobbyColor | null);
