/**
 * Per-card row rendered inside DeckLane. Extracted from DeckEditor.tsx
 * during slice DB-0 (mechanical split). Behavior preserved verbatim.
 */
import { useState } from 'react';
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import { scryfallArtCropUrl } from './deckEditorHelpers';

export function CardRow({
  entry,
  card,
  isCommanderSlot,
  isDisplayCard,
  onIncrement,
  onDecrement,
  onDelete,
  onSwapArt,
  onSetDisplayCard,
}: {
  entry: WebDeckCardInfo;
  card: WebCardInfo | null;
  isCommanderSlot: boolean;
  isDisplayCard: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onDelete: () => void;
  onSwapArt: () => void;
  onSetDisplayCard: () => void;
}) {
  const artUrl = scryfallArtCropUrl(entry.setCode, entry.cardNumber);
  // Audit fix (LOW) — Scryfall doesn't have art for some xmage promo
  // sets / non-standard collector numbers. Track per-row image-fail
  // state so we can render a placeholder instead of a broken icon.
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div
      data-testid="deck-editor-card-row"
      data-card={entry.cardName}
      data-set={entry.setCode}
      data-number={entry.cardNumber}
      className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 p-1.5"
    >
      <button
        type="button"
        data-testid="deck-editor-swap-art"
        onClick={onSwapArt}
        className="h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-zinc-800 hover:ring-2 hover:ring-fuchsia-400 transition-shadow"
        title={`Swap art (currently ${entry.setCode} #${entry.cardNumber})`}
      >
        {artUrl && !imgFailed ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[9px] text-zinc-500 px-1 text-center">
            {entry.setCode || '—'}
          </span>
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium text-zinc-100 truncate"
          title={entry.cardName}
        >
          {entry.cardName}
        </p>
        <p className="text-[11px] text-zinc-500 font-mono truncate">
          {entry.setCode} #{entry.cardNumber}
          {card ? ` · CMC ${card.manaValue}` : ''}
        </p>
        {isDisplayCard && (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300">
            Display card
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Audit fix (M3) — Face is a non-Commander portrait pick.
            Commander art always wins on the wire (see TableMapper +
            PlayerPortrait), so the button has no observable effect on
            commander rows; suppress it to avoid confusing UX. */}
        {!isCommanderSlot && (
          <button
            type="button"
            data-testid="deck-editor-display-card"
            aria-label="Use as display card"
            aria-pressed={isDisplayCard}
            onClick={onSetDisplayCard}
            title="Use this card as your portrait (non-Commander formats only)"
            className={
              'h-6 rounded px-2 text-[10px] font-semibold uppercase tracking-wide '
              + (isDisplayCard
                ? 'bg-fuchsia-600 text-white'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')
            }
          >
            Display
          </button>
        )}
        <button
          type="button"
          data-testid="deck-editor-decrement"
          aria-label="Decrease quantity"
          onClick={onDecrement}
          className="w-6 h-6 rounded text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
        >
          −
        </button>
        <span
          data-testid="deck-editor-amount"
          className="w-5 text-center text-sm tabular-nums text-zinc-200"
        >
          {entry.amount}
        </span>
        <button
          type="button"
          data-testid="deck-editor-increment"
          aria-label="Increase quantity"
          onClick={onIncrement}
          className="w-6 h-6 rounded text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
        >
          +
        </button>
        <button
          type="button"
          data-testid="deck-editor-delete"
          aria-label={isCommanderSlot ? 'Cannot remove commander' : 'Remove card'}
          disabled={isCommanderSlot}
          onClick={onDelete}
          title={
            isCommanderSlot
              ? 'Commander cannot be removed — swap art instead'
              : 'Remove card'
          }
          className="ml-1 w-6 h-6 rounded text-zinc-400 bg-zinc-800 enabled:hover:bg-status-danger enabled:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ×
        </button>
      </div>
    </div>
  );
}
