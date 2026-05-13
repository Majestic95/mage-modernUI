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
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDeckBuilderSettings } from './deckBuilderSettings';

const HOVER_DELAY_MS = 250;
const ASPECT = 7 / 5; // 5:7 Magic card aspect (height / width)

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
  const previewWidth = useDeckBuilderSettings((s) => s.previewSize);
  const previewHeight = previewWidth * ASPECT;

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

  const handlers: HoverHandlers = {
    onMouseEnter: (e) => startHover(e.currentTarget.getBoundingClientRect()),
    onMouseLeave: endHover,
    onFocus: (e) => startHover(e.currentTarget.getBoundingClientRect()),
    onBlur: endHover,
  };

  const preview =
    pos !== null && imageUrl !== null ? (
      <div
        data-testid="deck-hover-card-image"
        className="pointer-events-none fixed z-50 overflow-hidden rounded-lg"
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
