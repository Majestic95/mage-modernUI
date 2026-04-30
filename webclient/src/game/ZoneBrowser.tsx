import { useRef } from 'react';
import type { WebCardView } from '../api/schemas';
import { useModalA11y } from '../util/useModalA11y';
import { CardThumbnail } from './CardThumbnail';
import { HoverCardDetail } from './HoverCardDetail';
import { ManaCost } from './ManaCost';

// Slice 70-C (ADR 0011 D4) — the legacy ZoneCounter export was
// extracted into ./ZoneIcon.tsx. The modal below stays here and is
// consumed by ZoneIcon directly.

/**
 * Modal panel listing every card in a public zone. Each card chip
 * is wrapped in {@link HoverCardDetail} so brushing over a card
 * surfaces the same detail overlay used in the hand / battlefield.
 *
 * <p>Closes on backdrop click and on Esc keydown. The Esc handler
 * is registered with {@code capture: true} so it runs before any
 * bubble-phase document listeners (e.g. ActionPanel's hotkey
 * listener) and {@code stopImmediatePropagation} prevents those
 * from firing. That preserves the universal "Esc closes the modal"
 * convention without losing the ActionPanel's other shortcuts.
 *
 * <p>Slice 70-C — exported so {@code ZoneIcon} (the renamed atom)
 * can host this modal directly without going through the legacy
 * {@code ZoneCounter} wrapper.
 */
export function ZoneBrowser({
  title,
  cards,
  onClose,
}: {
  title: string;
  cards: Record<string, WebCardView>;
  onClose: () => void;
}) {
  // Modal a11y. The hook owns ESC + focus trap; we still rely on
  // its capture-phase keydown listener so ActionPanel's bubble-phase
  // hotkey listener never sees the Escape that closes us.
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  const entries = Object.values(cards);
  return (
    <div
      data-testid="zone-browser"
      className="fixed inset-0 z-40 flex items-center justify-center"
    >
      <div
        data-testid="zone-browser-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[min(90vw,640px)] max-h-[80vh] flex flex-col"
      >
        <header className="flex items-baseline justify-between px-4 py-2 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100 capitalize">
            {title}{' '}
            <span className="text-xs text-zinc-500 font-normal">
              ({entries.length})
            </span>
          </h2>
          <button
            type="button"
            data-testid="zone-browser-close"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-sm"
            aria-label="Close"
          >
            âœ•
          </button>
        </header>
        <div className="flex flex-wrap gap-1.5 p-3 overflow-y-auto">
          {entries.map((card) => (
            <HoverCardDetail key={card.id} card={card}>
              <div
                data-testid="zone-browser-card"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-950"
              >
                <CardThumbnail card={card} size={28} />
                <span className="font-medium text-zinc-100">{card.name}</span>
                {card.manaCost && <ManaCost cost={card.manaCost} size="sm" />}
              </div>
            </HoverCardDetail>
          ))}
        </div>
      </div>
    </div>
  );
}
