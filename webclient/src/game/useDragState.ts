/**
 * Slice 70-F (ADR 0011 D5) — drag-state hook lifted out of
 * Battlefield. Owns the hand-card drag-to-play state machine
 * introduced in slice 36 (pointer-events-only DnD per ADR 0005 §6).
 *
 * <p>Lifted to module scope so {@code GameTable} can own the state
 * and pass handlers to BOTH {@code MyHand} (drag source) and
 * {@code Battlefield} → {@code PlayerArea} (drop target). The drag
 * state used to live inside Battlefield, but slice 70-E moved
 * MyHand to its own grid region — the two components are now
 * siblings, not parent/child, so a shared state owner is required.
 *
 * <p>Document-level pointermove / pointerup listeners are mount-once
 * at the hook scope. The press anchor is a ref (no re-render on
 * pointerdown), so binding/unbinding listeners on drag-state changes
 * would never see the updated ref. Instead, attach once and read
 * the ref each event.
 *
 * <p>Returned shape:
 * <ul>
 *   <li>{@code drag} — null when no drag is active; otherwise
 *       {cardId, x, y} for the floating preview position</li>
 *   <li>{@code beginHandPress(cardId, ev)} — passed to MyHand's
 *       per-card pointerdown</li>
 * </ul>
 *
 * <p>The drop-dispatch (onBoardDrop) is NOT returned by the hook —
 * it lives in {@code Battlefield} because it needs the local
 * interaction-mode + clickRouter dispatch (mode-aware drop routing
 * isn't the hook's concern). Battlefield reads {@code drag} from
 * props and computes its own onBoardDrop callback.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface DragState {
  cardId: string;
  x: number;
  y: number;
}

export interface UseDragStateReturn {
  drag: DragState | null;
  beginHandPress: (cardId: string, ev: ReactPointerEvent) => void;
}

const DRAG_THRESHOLD_SQ = 5 * 5;

export function useDragState(): UseDragStateReturn {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragStartRef = useRef<
    | { cardId: string; x: number; y: number; pointerId: number }
    | null
  >(null);

  const beginHandPress = (cardId: string, ev: ReactPointerEvent) => {
    if (ev.button !== 0) return; // primary button only
    dragStartRef.current = {
      cardId,
      x: ev.clientX,
      y: ev.clientY,
      pointerId: ev.pointerId,
    };
  };

  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start || ev.pointerId !== start.pointerId) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (dx * dx + dy * dy <= DRAG_THRESHOLD_SQ) return;
      setDrag((curr) =>
        curr && curr.cardId === start.cardId
          ? { ...curr, x: ev.clientX, y: ev.clientY }
          : { cardId: start.cardId, x: ev.clientX, y: ev.clientY },
      );
    };
    const onUp = () => {
      dragStartRef.current = null;
      setDrag(null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return { drag, beginHandPress };
}
