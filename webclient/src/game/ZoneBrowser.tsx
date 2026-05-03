import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WebCardView } from '../api/schemas';
import { useModalA11y } from '../util/useModalA11y';
import { CardFace } from './CardFace';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const onHeaderPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    // Skip drag when the click landed on a button inside the header
    // (e.g. close button) so the button still behaves like a button.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const rect = dialogRef.current?.getBoundingClientRect();
    const originX = pos?.x ?? (rect ? rect.left : 0);
    const originY = pos?.y ?? (rect ? rect.top : 0);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX,
      originY,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onHeaderPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setPos({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const onHeaderPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // best-effort
    }
  };

  // Center the dialog on first paint; once the user drags, switch to
  // the absolute-position coordinates they chose. Without this initial
  // measurement the dialog renders at top:0/left:0 and snaps when the
  // drag handler later sets coords.
  useEffect(() => {
    if (pos !== null) return;
    const el = dialogRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, (window.innerWidth - rect.width) / 2),
      y: Math.max(8, (window.innerHeight - rect.height) / 2),
    });
  }, [pos]);

  const entries = Object.values(cards);

  const dialogStyle: CSSProperties = {
    position: 'fixed',
    left: pos?.x ?? 0,
    top: pos?.y ?? 0,
    // Hidden until pos is computed so the dialog doesn't flash at
    // (0,0) before the centering effect runs.
    visibility: pos === null ? 'hidden' : 'visible',
  };

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
          ...dialogStyle,
          // Mulligan-sized: full card images, comfortable width so
          // ~5 cards fit per row at 130px each.
          width: 'min(90vw, 880px)',
          maxHeight: '85vh',
        }}
      >
        <header
          data-testid="zone-browser-header"
          className="flex items-baseline justify-between px-4 py-2 border-b border-zinc-800 cursor-move select-none"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
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
