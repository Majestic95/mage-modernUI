/**
 * Settings dropdown for the deck-builder header. Currently exposes
 * the hover-preview size slider; future settings (grid mode, sort
 * order, etc.) layer in here without spawning new buttons.
 *
 * <p>Behavior: click the gear icon → popover anchors below the
 * button, click-outside / Escape closes. Slider supports both
 * arrow-key nudge (native range) AND mousewheel-on-slider to
 * scroll-resize, mirroring the game-window pattern the user
 * referenced.
 */
import { useEffect, useRef, useState } from 'react';
import {
  PREVIEW_SIZE_DEFAULT,
  PREVIEW_SIZE_MAX,
  PREVIEW_SIZE_MIN,
  PREVIEW_SIZE_STEP,
  useDeckBuilderSettings,
} from './deckBuilderSettings';

export function DeckBuilderSettingsButton() {
  const [open, setOpen] = useState(false);
  const previewSize = useDeckBuilderSettings((s) => s.previewSize);
  const setPreviewSize = useDeckBuilderSettings((s) => s.setPreviewSize);
  const resetPreviewSize = useDeckBuilderSettings((s) => s.resetPreviewSize);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click outside the button + menu → close. Pointerdown (not click)
  // so the closer fires before any other handlers; the open-state
  // gate prevents a no-op listener cycle while closed.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Esc closes the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onWheelAdjust = (e: React.WheelEvent<HTMLInputElement>) => {
    // Scroll-up → bigger, scroll-down → smaller. preventDefault
    // would block page scroll; we don't preventDefault so the user
    // can still scroll the page if their cursor briefly hits the
    // slider — only the value changes.
    const delta = e.deltaY < 0 ? PREVIEW_SIZE_STEP : -PREVIEW_SIZE_STEP;
    setPreviewSize(previewSize + delta);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="deck-builder-settings"
        aria-label="Deck-builder settings"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-md border px-2 py-1.5 text-text-secondary transition-colors hover:border-accent-primary/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        style={{ borderColor: 'var(--color-card-frame-default)' }}
      >
        <GearGlyph />
      </button>

      {open && (
        <div
          ref={menuRef}
          data-testid="deck-builder-settings-menu"
          role="dialog"
          aria-label="Deck-builder settings"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border p-4"
          style={{
            background: 'var(--color-bg-elevated)',
            borderColor: 'var(--color-card-frame-default)',
            boxShadow: 'var(--shadow-high)',
          }}
        >
          <h3
            className="mb-3 text-xs font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
          >
            Settings
          </h3>

          <label
            className="flex flex-col gap-2 text-xs text-text-secondary"
            style={{ letterSpacing: '0.02em' }}
          >
            <div className="flex items-baseline justify-between">
              <span>Hover preview size</span>
              <span
                data-testid="deck-builder-preview-size-value"
                className="font-mono text-text-primary"
              >
                {previewSize}px
              </span>
            </div>
            <input
              type="range"
              data-testid="deck-builder-preview-size-slider"
              min={PREVIEW_SIZE_MIN}
              max={PREVIEW_SIZE_MAX}
              step={PREVIEW_SIZE_STEP}
              value={previewSize}
              onChange={(e) => setPreviewSize(Number(e.target.value))}
              onWheel={onWheelAdjust}
              aria-label="Hover preview size in pixels"
              className="w-full accent-accent-primary"
            />
            <div className="flex justify-between text-[10px] text-text-muted">
              <span>{PREVIEW_SIZE_MIN}px</span>
              <span>scroll-wheel to resize</span>
              <span>{PREVIEW_SIZE_MAX}px</span>
            </div>
          </label>

          <button
            type="button"
            data-testid="deck-builder-preview-size-reset"
            onClick={resetPreviewSize}
            className="mt-3 text-[11px] uppercase text-text-secondary underline-offset-2 hover:text-accent-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-sm"
            style={{ letterSpacing: '0.08em' }}
          >
            Reset to default ({PREVIEW_SIZE_DEFAULT}px)
          </button>
        </div>
      )}
    </div>
  );
}

function GearGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.43 12.98a8 8 0 0 0 0-1.96l2.06-1.6-2-3.46-2.43.92a8 8 0 0 0-1.7-1l-.36-2.58h-4l-.36 2.58a8 8 0 0 0-1.7 1l-2.43-.92-2 3.46 2.06 1.6a8 8 0 0 0 0 1.96l-2.06 1.6 2 3.46 2.43-.92a8 8 0 0 0 1.7 1l.36 2.58h4l.36-2.58a8 8 0 0 0 1.7-1l2.43.92 2-3.46-2.06-1.6z" />
    </svg>
  );
}
