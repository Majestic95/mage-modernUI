/**
 * Draggable + closable floating panel surfacing the
 * {@link WebDeckValidationError}s flagged by the legality pre-flight.
 * Opened from the legality pill in DeckBuilderHeader when the verdict
 * has at least one issue.
 *
 * <p>NOT a blocking modal — no full-screen backdrop. The user can
 * still interact with the deck behind the panel; the panel just
 * floats over the workbench so they can read each issue while
 * adjusting the deck. Matches the gamelog / cinematic-lab pattern
 * already used elsewhere in the webclient (per
 * {@code project_gamelog_window_shipped} memory).
 *
 * <p>Drag behavior: pointer-based with setPointerCapture so the drag
 * survives the cursor leaving the panel rect. Initial position is
 * viewport center with a small offset so the panel doesn't cover the
 * pill that opened it. Position is local state, not persisted.
 */
import { useEffect, useRef, useState } from 'react';
import type { WebDeckValidationError } from '../api/schemas';
import { ValidationErrorList } from '../decks/ValidationErrorList';

interface Props {
  deckName: string;
  format: string;
  partlyLegal: boolean;
  errors: readonly WebDeckValidationError[];
  onClose: () => void;
}

const INITIAL_WIDTH = 440;
const INITIAL_HEIGHT = 400;

export function DeckLegalityIssuesModal({
  deckName,
  format,
  partlyLegal,
  errors,
  onClose,
}: Props) {
  // Initial position: centered on the viewport, then offset up-and-
  // left so the panel doesn't sit on top of the header pill that
  // opened it.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(16, (window.innerWidth - INITIAL_WIDTH) / 2),
    y: Math.max(16, (window.innerHeight - INITIAL_HEIGHT) / 2 - 80),
  }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Esc closes — keep parity with other workbench modals.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only the title bar starts a drag — buttons inside should not.
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nextX = clamp(
      dragRef.current.origX + dx,
      0,
      Math.max(0, window.innerWidth - 200),
    );
    const nextY = clamp(
      dragRef.current.origY + dy,
      0,
      Math.max(0, window.innerHeight - 80),
    );
    setPos({ x: nextX, y: nextY });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    }
  };

  const verdictLabel = partlyLegal
    ? `Legal once finished · ${errors.length} ${errors.length === 1 ? 'issue' : 'issues'}`
    : `Not legal · ${errors.length} ${errors.length === 1 ? 'issue' : 'issues'}`;

  return (
    <div
      ref={panelRef}
      data-testid="deck-legality-issues-modal"
      role="dialog"
      aria-modal="false"
      aria-labelledby="deck-legality-issues-title"
      className="fixed z-50 flex flex-col rounded-xl border shadow-2xl"
      style={{
        left: pos.x,
        top: pos.y,
        width: INITIAL_WIDTH,
        maxHeight: INITIAL_HEIGHT,
        background: 'var(--color-bg-elevated)',
        borderColor: 'var(--color-card-frame-default)',
        boxShadow: 'var(--shadow-high)',
      }}
    >
      <div
        data-testid="deck-legality-issues-title-bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex flex-shrink-0 items-center justify-between gap-2 rounded-t-xl border-b px-4 py-2 select-none"
        style={{
          borderBottomColor: 'var(--color-card-frame-default)',
          background: 'rgba(26, 38, 48, 0.85)',
          cursor: dragRef.current ? 'grabbing' : 'grab',
        }}
      >
        <div className="flex min-w-0 flex-col">
          <h2
            id="deck-legality-issues-title"
            className="truncate text-xs font-semibold uppercase text-text-primary"
            style={{ letterSpacing: '0.12em' }}
            title={`${deckName} — ${format}`}
          >
            Deck issues
          </h2>
          <p
            className={
              'truncate text-[10px] uppercase '
              + (partlyLegal ? 'text-status-warning' : 'text-status-danger')
            }
            style={{ letterSpacing: '0.08em' }}
            title={verdictLabel}
          >
            {verdictLabel} · {format}
          </p>
        </div>
        <button
          type="button"
          data-no-drag
          data-testid="deck-legality-issues-close"
          aria-label="Close issues panel"
          onClick={onClose}
          className="flex-shrink-0 rounded-md px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-surface-card-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {errors.length === 0 ? (
          <p className="text-sm text-text-secondary italic">
            No issues to surface.
          </p>
        ) : (
          <ValidationErrorList
            errors={errors}
            ariaLabel={`Deck issues for ${deckName}`}
          />
        )}
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
