import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WebCardView } from '../api/schemas';
import { scryfallImageUrl } from './scryfall';
import { ManaCost } from './ManaCost';
import { renderUpstreamMarkup } from './dialogs/markupRenderer';
import { effectiveToughness } from './effectiveToughness';
import { popoverWidthPx, useHoverPreviewSettings } from './hoverPreviewSettings';

/* ---------- card detail overlay (slice 30) ---------- */

/**
 * Floating card-detail panel — shown on hover. Phase 5 deliverable
 * (PATH_C_PLAN.md "Card-detail overlay (zoom + full text)") that
 * gives the player a one-glance read of "what does this card do?"
 * without having to wait for a tooltip or click through. The same
 * scaffolding will host the Scryfall card art when image-fetching
 * lands later.
 *
 * <p>Renders the card name, mana cost, type line, P/T (if a
 * creature) or starting loyalty (if a planeswalker), full rules
 * text (each line a separate paragraph), and a subdued footer with
 * set code + rarity.
 */
function CardDetail({
  card,
  onFlip,
  isFlipped,
  damage,
}: {
  card: WebCardView;
  onFlip?: () => void;
  isFlipped?: boolean;
  /** Marked damage from the parent permanent (battlefield context).
   *  Drives the same red-toughness display as CardFace per CR 121.3. */
  damage?: number;
}) {
  const isCreature = card.power || card.toughness;
  const isPlaneswalker = !!card.startingLoyalty;
  const imageUrl = scryfallImageUrl(card);
  // Width is user-tunable via the settings modal slider (per user
  // direction 2026-05-09 — "make the card tooltip and the card image
  // as large as they want, even if it blocks other elements"). Inline
  // style replaces the legacy `w-64` Tailwind class so the same
  // markup serves any width in the configured 1.0..3.0 range.
  //
  // Viewport-fit clamps (added 2026-05-09 follow-up — popover spilled
  // off-screen at 300% on sub-1440p displays): maxWidth / maxHeight
  // bound the popover to the viewport with a 1rem safety margin.
  // The image inside gets max-h-[60vh] object-contain so it scales
  // down preserving aspect ratio when the popover's height is
  // clamped. The position math in useLayoutEffect reads the
  // post-clamp `getBoundingClientRect`, so it picks up the new
  // dimensions automatically — no math changes required.
  const popoverScale = useHoverPreviewSettings((s) => s.popoverScale);
  const widthPx = popoverWidthPx(popoverScale);
  return (
    <div
      data-testid="card-detail"
      data-flipped={isFlipped || undefined}
      style={{
        width: widthPx,
        maxWidth: 'calc(100vw - 1rem)',
        maxHeight: 'calc(100vh - 1rem)',
      }}
      className="bg-zinc-900 border border-zinc-700 rounded shadow-xl text-xs overflow-hidden relative flex flex-col"
    >
      {imageUrl && <CardImage url={imageUrl} alt={card.name} />}
      {/* Bug fix #2 (2026-05-02) — DFC flip toggle. Per CR 712.x both
          faces are public information; the visual spec the user asked
          for is "click flip, see back; move mouse away, returns to
          front." `flipped` state lives in HoverCardDetail and resets
          when the popover closes, so leaving and re-hovering always
          shows the front first. The button is the ONLY element with
          pointer-events-auto inside the otherwise pass-through popover
          so the trigger's hover state isn't disturbed by hovering
          empty popover real estate. */}
      {onFlip && (
        <button
          type="button"
          data-testid="card-detail-flip"
          onClick={(e) => {
            e.stopPropagation();
            onFlip();
          }}
          className="absolute top-1 right-1 z-10 px-2 py-0.5 text-[10px] font-medium rounded bg-zinc-800/90 hover:bg-zinc-700 text-zinc-100 border border-zinc-600 shadow"
          style={{ pointerEvents: 'auto' }}
          aria-label={isFlipped ? 'Show front face' : 'Show back face'}
        >
          {isFlipped ? '↺ Front' : '↻ Flip'}
        </button>
      )}
      <div className="p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-sm text-zinc-100 truncate">
            {card.name}
          </span>
          {card.manaCost && (
            <span className="text-zinc-300 shrink-0">
              <ManaCost cost={card.manaCost} />
            </span>
          )}
        </div>
        {card.typeLine && (
          <div className="text-zinc-400 italic">{card.typeLine}</div>
        )}
        {(isCreature || isPlaneswalker) && (
          <div className="text-zinc-300 font-mono">
            {isPlaneswalker ? (
              `Loyalty: ${card.startingLoyalty}`
            ) : (() => {
              const t = effectiveToughness(card.toughness, damage ?? 0);
              return (
                <>
                  {card.power} /{' '}
                  <span
                    data-damaged={t.damaged || undefined}
                    className={t.damaged ? 'text-status-danger' : undefined}
                  >
                    {t.display}
                  </span>
                </>
              );
            })()}
          </div>
        )}
        {card.rules && card.rules.length > 0 && (
          <div className="space-y-1 text-zinc-300 leading-snug">
            {/* P2 audit fix — was stripping HTML via regex, which
                lost engine-emitted formatting (font color highlights
                on card names, <br> line breaks). Use the shared
                renderUpstreamMarkup which tokenizes the same set of
                tags safely (no dangerouslySetInnerHTML, unknown tags
                stripped) so engine-markup renders consistently here
                AND in the search page (which previously showed raw
                literal markup). */}
            {card.rules.map((line, i) => (
              <p key={i}>{renderUpstreamMarkup(line)}</p>
            ))}
          </div>
        )}
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-baseline gap-2 pt-1 border-t border-zinc-800">
          {card.expansionSetCode && <span>{card.expansionSetCode}</span>}
          {card.rarity && <span>· {card.rarity}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Lazy-loaded Scryfall image with graceful failure. Hides itself
 * on load error so a missing print (Scryfall has no record of
 * this set / number, network blocked, etc.) just falls back to
 * the text-only card detail. {@code loading="lazy"} is a hint
 * for browsers that mount the element off-screen — most of our
 * use cases hover the element on, so it loads immediately, but
 * the hint is harmless and helps when an overlay first mounts
 * outside the viewport.
 */
function CardImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid="card-image"
      // max-h-[60vh] + object-contain shrink the image when the
      // outer popover's maxHeight clamp engages (e.g., user picked
      // 300% on a 1080p screen — popover height would naturally
      // exceed viewport). Image scales preserving aspect ratio;
      // text section below stays visible.
      className="w-full max-h-[60vh] object-contain block flex-shrink"
    />
  );
}

/**
 * Hover wrapper. Wraps any card-bearing element and shows
 * {@link CardDetail} above it on mouseEnter. Positioned absolutely
 * with high z-index so the overlay floats over surrounding chips
 * even when the parent has overflow.
 *
 * <p>Visibility is also bound to keyboard focus (focus / blur) so
 * tab-navigating the hand surfaces the same detail — accessibility
 * scaffolding for the Phase 6 a11y pass.
 */
export function HoverCardDetail({
  card,
  children,
  damage,
}: {
  card: WebCardView;
  children: ReactNode;
  /** Marked damage from the parent permanent (battlefield context).
   *  Forwarded to the popover's CardDetail so the tooltip shows
   *  effective toughness in red, matching CardFace's on-card P/T.
   *  Optional — non-battlefield call sites (hand, stack, mulligan,
   *  library search, zone browser, game log) leave undefined. */
  damage?: number;
}) {
  const [show, setShow] = useState(false);
  // Bug fix #2 (2026-05-02) — DFC flip state. `flipped` toggles the
  // displayed face when the user clicks the flip button. Resets to
  // false whenever `show` becomes false so leaving and re-hovering
  // always shows the front first (per user-stated UX: "pop back to
  // front when you stop hovering").
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!show) setFlipped(false);
  }, [show]);
  const transformable = !!(card.transformable && card.secondCardFace);
  const displayCard = transformable && flipped ? card.secondCardFace! : card;
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Slice 38: viewport-clamped position. Initial render places the
  // popover off-screen (so its layout settles invisibly) and the
  // useLayoutEffect below measures both the trigger and the popover,
  // then snaps the popover to a position that:
  //   1. flips above ↔ below depending on which side has more room
  //   2. clamps horizontally so the right / left edges never spill
  //      past the viewport
  // We use position: fixed (not absolute) and a portal so the
  // popover escapes any overflow:hidden ancestor (the battlefield
  // sections are scrollable).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    // When show flips false the popover unmounts (the {show && ...}
    // guard below), so any stale {@code pos} is unobservable until the
    // next show=true cycle, which immediately recomputes it. We
    // therefore intentionally do not setPos(null) here — that synchronous
    // setState in an effect body would lint-fail without changing UX.
    if (!show) return;
    if (!triggerRef.current || !popoverRef.current) return;
    const tr = triggerRef.current.getBoundingClientRect();
    const pr = popoverRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: prefer above the trigger, flip below if more room
    // there, else clamp into the viewport.
    let top: number;
    const roomAbove = tr.top - margin;
    const roomBelow = vh - tr.bottom - margin;
    if (roomAbove >= pr.height) {
      top = tr.top - pr.height - margin;
    } else if (roomBelow >= pr.height) {
      top = tr.bottom + margin;
    } else {
      // Neither side fits — clamp so at minimum the top of the
      // popover stays in view.
      top = Math.max(margin, vh - pr.height - margin);
    }

    // Horizontal: align to trigger's left edge, clamp to viewport.
    let left = tr.left;
    if (left + pr.width > vw - margin) {
      left = vw - pr.width - margin;
    }
    if (left < margin) left = margin;

    setPos({ left, top });
  }, [show, card]);

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-flex"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
      >
        {children}
      </span>
      {show &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            data-testid="card-detail-overlay"
            // z-[60] — sits above every modal/backdrop in the app
            // (all currently at z-50: Mulligan, Settings, Sideboard,
            // GameEnd, GameLogWindow, TriggerOrder, etc.). Without
            // this, the popover relies on DOM-paint-order tiebreaks
            // through the modal's own stacking context (useDraggable
            // applies a transform → creates a context), which is
            // brittle. ActionButton menu is z-[55]; popover-on-top
            // there is intentional.
            className="fixed z-[60] pointer-events-none"
            style={
              pos
                ? { left: pos.left, top: pos.top }
                : { left: -9999, top: -9999, opacity: 0 }
            }
          >
            <CardDetail
              card={displayCard}
              isFlipped={flipped}
              {...(damage !== undefined ? { damage } : {})}
              {...(transformable ? { onFlip: () => setFlipped((f) => !f) } : {})}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
