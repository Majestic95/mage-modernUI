/**
 * Hover-to-zoom for the deck editor's card art thumbnails.
 * Returns hover/focus handlers and an overlay element that renders
 * the full-size Scryfall card image (no text, no info chrome — just
 * the card art) when active. Deck-builder-specific so the floating
 * preview never carries the in-game info-text-box treatment the
 * user wanted to exclude.
 *
 * <p>Usage:
 * <pre>{@code
 *   const hover = useDeckCardHoverPreview({ setCode, cardNumber, cardName });
 *   return (
 *     <>
 *       <button {...hover.handlers}>...</button>
 *       {hover.preview}
 *     </>
 *   );
 * }</pre>
 *
 * <p>Position: viewport-fixed coordinates derived from the trigger
 * element's bounding rect at hover-time. Floats to the right of the
 * trigger by default; flips to the left if there isn't room on the
 * right. Vertically clamped to stay inside the viewport.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDeckBuilderSettings } from './deckBuilderSettings';

const HOVER_DELAY_MS = 250;
const ASPECT = 7 / 5; // 5:7 Magic card aspect (height / width)
const VIEWPORT_MARGIN = 16; // px buffer on each side for the preview

interface Args {
  setCode: string;
  cardNumber: string;
  cardName: string;
}

interface HoverHandlers {
  onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

export interface DeckCardHoverPreview {
  handlers: HoverHandlers;
  preview: React.ReactNode;
}

export function useDeckCardHoverPreview({
  setCode,
  cardNumber,
  cardName,
}: Args): DeckCardHoverPreview {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<number | null>(null);
  // fix-8 — preview size is user-configurable via the settings menu.
  // We read from the store at render-time so a slider drag reflows
  // any visible preview live without waiting for the next hover.
  // fix-audit F4 — cap the effective dimensions to the viewport
  // (minus a small margin) so an oversized slider setting on a small
  // screen doesn't render a preview taller/wider than the page. We
  // shrink ONLY when the natural size doesn't fit; the slider value
  // is the user's preference, not a hard floor.
  const rawWidth = useDeckBuilderSettings((s) => s.previewSize);
  const { previewWidth, previewHeight } = useMemo(() => {
    const fitWidth =
      typeof window !== 'undefined'
        ? Math.min(rawWidth, window.innerWidth - VIEWPORT_MARGIN)
        : rawWidth;
    const heightFromWidth = fitWidth * ASPECT;
    const fitHeight =
      typeof window !== 'undefined'
        ? Math.min(heightFromWidth, window.innerHeight - VIEWPORT_MARGIN)
        : heightFromWidth;
    const finalWidth = fitHeight / ASPECT;
    return { previewWidth: finalWidth, previewHeight: fitHeight };
  }, [rawWidth]);

  const imageUrl =
    setCode && cardNumber
      ? `https://api.scryfall.com/cards/${setCode.toLowerCase()}/${encodeURIComponent(cardNumber)}?format=image&version=normal`
      : null;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startHover = useCallback(
    (rect: DOMRect) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        // Prefer the right side of the trigger; flip to left when
        // there isn't room. Vertically anchored to the trigger's
        // mid-y, then clamped to the viewport so the preview never
        // pokes off-screen.
        let left = rect.right + 8;
        if (left + previewWidth > window.innerWidth - 8) {
          left = rect.left - previewWidth - 8;
        }
        if (left < 8) {
          left = Math.max(8, window.innerWidth - previewWidth - 8);
        }
        let top = rect.top + rect.height / 2 - previewHeight / 2;
        top = Math.max(
          8,
          Math.min(window.innerHeight - previewHeight - 8, top),
        );
        setPos({ left, top });
      }, HOVER_DELAY_MS);
    },
    [clearTimer, previewWidth, previewHeight],
  );

  const endHover = useCallback(() => {
    clearTimer();
    setPos(null);
  }, [clearTimer]);

  useEffect(() => endHover, [endHover]);

  // fix-audit F6 — memoize handlers so the four-key object doesn't
  // get a new identity every render (negates useCallback's value on
  // startHover/endHover for any future memoized child consumers).
  const handlers = useMemo<HoverHandlers>(
    () => ({
      onMouseEnter: (e) => startHover(e.currentTarget.getBoundingClientRect()),
      onMouseLeave: endHover,
      onFocus: (e) => startHover(e.currentTarget.getBoundingClientRect()),
      onBlur: endHover,
    }),
    [startHover, endHover],
  );

  // fix-audit F5 — when previewWidth/Height change while a preview is
  // showing (e.g. user drags the settings slider), re-clamp the
  // existing position so the enlarged image doesn't overflow.
  useEffect(() => {
    if (pos === null) return;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - previewWidth - 8, pos.left),
    );
    const top = Math.max(
      8,
      Math.min(window.innerHeight - previewHeight - 8, pos.top),
    );
    if (left !== pos.left || top !== pos.top) {
      setPos({ left, top });
    }
  }, [previewWidth, previewHeight, pos]);

  const preview =
    pos !== null && imageUrl !== null ? (
      <div
        data-testid="deck-hover-card-image"
        // fix-audit F3 — z-[60] so the transient hover preview always
        // wins over modals (z-50) and other floating panels. Justified
        // because hover is short-lived and the user expects to see
        // the card they're hovering even if a modal happens to be open.
        className="pointer-events-none fixed z-[60] overflow-hidden rounded-lg"
        style={{
          left: pos.left,
          top: pos.top,
          width: previewWidth,
          height: previewHeight,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.65)',
        }}
      >
        <img
          src={imageUrl}
          alt={cardName}
          loading="eager"
          referrerPolicy="no-referrer"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>
    ) : null;

  return { handlers, preview };
}
