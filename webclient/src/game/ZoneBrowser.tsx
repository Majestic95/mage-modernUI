import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slow } from '../animation/debug';
import type { WebCardView } from '../api/schemas';
import { useModalA11y } from '../util/useModalA11y';
import { CardThumbnail } from './CardThumbnail';
import { HoverCardDetail } from './HoverCardDetail';
import { ManaCost } from './ManaCost';

/**
 * Clickable zone-count chip ("Grave 3", "Exile 2"). Renders as a
 * non-interactive span when the zone is empty (no panel to open),
 * a button otherwise that toggles a {@link ZoneBrowser} modal.
 *
 * <p>Phase 5 deliverable from PATH_C_PLAN.md "Graveyard / exile /
 * library (top-card-revealed) browsers". Library is intentionally
 * NOT browsable (face-down by default â€” only revealed when
 * something specifically reveals top cards; that flow comes later
 * via gameTarget on the revealed cards).
 */
export function ZoneCounter({
  label,
  zone,
  playerName,
  cards,
}: {
  label: string;
  zone: 'graveyard' | 'exile';
  playerName: string;
  cards: Record<string, WebCardView>;
}) {
  const [open, setOpen] = useState(false);
  const cardList = Object.values(cards);
  const count = cardList.length;
  const empty = count === 0;
  return (
    <span className="relative inline-block">
      <span className="text-zinc-500">{label}</span>{' '}
      {empty ? (
        <span data-testid={`zone-count-${zone}`} className="font-mono">
          {count}
        </span>
      ) : (
        <button
          type="button"
          data-testid={`zone-count-${zone}`}
          onClick={() => setOpen(true)}
          className="font-mono cursor-pointer text-zinc-100 hover:text-fuchsia-300 underline underline-offset-2"
          title={`Browse ${playerName}'s ${zone}`}
        >
          {count}
        </button>
      )}
      {/*
        Slice 55 â€” resolve animation: zero-size hidden motion.div per
        graveyard / exile card so the cross-zone layoutId graph has a
        destination to glide INTO when an instant or sorcery resolves.
        Without these, a Lightning Bolt resolving from the stack would
        animate its exit (opacity-fade + slide) but the player would
        never see it "land" anywhere â€” the chip count would just bump
        in silence. With these, Framer matches the exiting stack tile
        against the cardId-paired hidden div at the chip's position
        and glides between them. Fades to zero on arrival; the chip
        count is the persistent record.

        Per-card (not per-zone) so any card moving INTO the zone
        triggers the glide, regardless of order. Zero-size +
        opacity-0 + pointer-events-none means they cost ~nothing in
        layout/paint. Performance budget on this whole LayoutGroup is
        â‰¤50 elements (see Game.tsx:163); a long game's combined
        graveyards rarely exceed 30 cards.
      */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <AnimatePresence initial={false}>
          {cardList.map((card) =>
            card.cardId ? (
              <motion.span
                key={card.id}
                layoutId={card.cardId}
                data-layout-id={card.cardId}
                data-testid={`zone-target-${zone}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={slow({ duration: 0.2 })}
                className="absolute inset-0 block"
                style={{ width: 0, height: 0 }}
              />
            ) : null,
          )}
        </AnimatePresence>
      </span>
      {open && (
        <ZoneBrowser
          title={`${playerName}'s ${zone}`}
          cards={cards}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

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
 */
function ZoneBrowser({
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
