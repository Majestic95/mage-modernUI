import { type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { WebCardView } from '../api/schemas';
import { useDraggable } from '../util/useDraggable';
import { useModalA11y } from '../util/useModalA11y';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';

/**
 * Modal panel listing every card in a public zone (graveyard / exile /
 * etc). Sized like the mulligan modal — full card images at hand-card
 * scale, no hover-to-read. Draggable: the user can grab the header and
 * move the panel around the viewport, so a graveyard for player A
 * doesn't occlude an interaction the user is trying to perform on the
 * battlefield or another player's zone.
 *
 * <p>Eligible-target halo: when the engine reports any card in the
 * zone as a legal target for the active dialog (e.g. Scavenging Ooze
 * picking exile fodder, Gravecrawler returning from yard), each
 * matching card pulses with the same purple-targeted-pulse used on
 * the battlefield. Clicking an eligible card invokes
 * {@code onObjectClick} so the engine receives the choice. Non-
 * eligible cards in the zone are static (still browsable, still
 * hover-detail-able via CardFace's built-ins, but not pulsing).
 *
 * <p>Closes on Esc keydown or close-button click. Backdrop click is
 * INTENTIONALLY not a close affordance here — the modal is draggable
 * and a user might click "outside" the modal area expecting the
 * modal to stay; we use an explicit close button instead.
 *
 * <p>Rendered via a React portal to document.body so it escapes any
 * transformed ancestor. Without the portal, ANY ancestor with
 * {@code transform} / {@code filter} / {@code will-change} (e.g.
 * PlayerFrameRedesigned's {@code -translate-x-1/2}) creates a new
 * containing block for {@code position: fixed} descendants, and the
 * modal is positioned relative to that ancestor instead of the
 * viewport — typically off-screen or hidden behind game chrome,
 * making the open button appear to do nothing.
 */
export function ZoneBrowser({
  title,
  cards,
  eligibleIds,
  canAct,
  onObjectClick,
  onClose,
}: {
  title: string;
  cards: Record<string, WebCardView>;
  /**
   * IDs of cards in this zone that the engine currently considers a
   * legal target for the open dialog. Empty/undefined → no halo on
   * any card. Optional so existing callers continue to work without
   * the prop while we thread it through.
   */
  eligibleIds?: Set<string>;
  /** Whether the local player has priority + a target dialog open. */
  canAct?: boolean;
  /** Forwarded to the click router when an eligible card is picked. */
  onObjectClick?: (id: string) => void;
  onClose: () => void;
}) {
  const { ref: dialogRef, containerProps, style: dragStyle } = useDraggable({
    placement: { kind: 'center' },
  });
  useModalA11y(dialogRef, { onClose });

  const entries = Object.values(cards);

  // Portal target — render to document.body so the modal escapes any
  // ancestor with a transform/filter/will-change (which otherwise
  // turns this fixed-positioned modal into one positioned relative
  // to that ancestor instead of the viewport). PlayerFrameRedesigned
  // uses -translate-x-1/2 which triggers exactly that gotcha.
  if (typeof document === 'undefined') return null;

  const tree = (
    <div
      data-testid="zone-browser"
      // Wrapper covers the viewport ONLY to host the modal; we
      // intentionally don't render a backdrop/scrim. Clicks outside
      // the modal go through to the underlying battlefield, so the
      // user can keep playing while a graveyard is open.
      className="fixed inset-0 z-40 pointer-events-none"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col pointer-events-auto"
        style={{
          ...dragStyle,
          // Mulligan-sized: full card images, comfortable width so
          // ~5 cards fit per row at 130px each.
          width: 'min(90vw, 880px)',
          maxHeight: '85vh',
        }}
        {...containerProps}
      >
        <header
          data-testid="zone-browser-header"
          data-drag-handle
          className="flex items-baseline justify-between px-4 py-2 border-b border-zinc-800 cursor-move select-none"
        >
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
            className="text-zinc-400 hover:text-zinc-100 text-base leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        {entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500 italic">
            Empty.
          </p>
        ) : (
          <ul
            data-testid="zone-browser-grid"
            className="grid gap-2 p-3 overflow-y-auto"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              ['--card-size-large' as keyof CSSProperties]: '140px',
            } as CSSProperties}
          >
            {entries.map((card) => {
              const eligible = eligibleIds?.has(card.id) ?? false;
              const clickable = canAct && eligible && !!onObjectClick;
              return (
                <li key={card.id}>
                  {/* Hover-to-zoom — same pattern as the in-game hand
                      hover. The popover is rendered via portal at
                      pointer-events:none, so eligible-target clicks
                      still pass through to the button below. */}
                  <HoverCardDetail card={card}>
                    <button
                      type="button"
                      data-testid={`zone-browser-card-${card.id}`}
                      data-eligible={eligible || undefined}
                      onClick={
                        clickable
                          ? () => onObjectClick(card.id)
                          : undefined
                      }
                      disabled={!clickable}
                      className={
                        'block w-full rounded transition focus:outline-none ' +
                        'focus-visible:ring-2 focus-visible:ring-fuchsia-400 ' +
                        (clickable
                          ? 'cursor-pointer hover:brightness-110 animate-card-targeted-pulse'
                          : 'cursor-default')
                      }
                      aria-label={
                        clickable
                          ? `${card.name} — click to select`
                          : card.name
                      }
                    >
                      <CardFace card={card} size="hand" />
                    </button>
                  </HoverCardDetail>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );

  return createPortal(tree, document.body);
}
