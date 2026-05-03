import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';

/**
 * Initial placement modes. The first paint measures the dialog and
 * positions it according to the chosen mode; the user's first drag
 * switches the dialog to free positioning. {@link bottomMargin} on
 * 'bottom-center' / 'bottom-right' is the gap between the dialog
 * edge and the viewport edge (defaults to 16px).
 */
export type DraggablePlacement =
  | { kind: 'center' }
  | { kind: 'top-center'; topMargin?: number }
  | {
      kind: 'bottom-center';
      bottomMargin?: number;
      /**
       * CSS custom property name (without `--`) added to
       * {@code bottomMargin} when measuring initial position. Used
       * by the in-game banners so they sit above the hand fan
       * regardless of its dynamic height
       * ({@code --hand-area-height}); the legacy positioner read it
       * via {@code calc(var(--hand-area-height, 180px) + 16px)}.
       */
      bottomMarginVar?: string;
    }
  | {
      kind: 'bottom-right';
      bottomMargin?: number;
      rightMargin?: number;
      /**
       * CSS custom property name (without the `--` prefix) to add
       * to {@code rightMargin} when measuring initial position. Used
       * to keep `bottom-right` dialogs clear of a side panel of
       * dynamic width — the legacy GameDialog hidden-zone branch
       * read {@code --side-panel-width} via Tailwind's `right-[calc(...)]`,
       * and dropping it on the drag refactor caused the dialog to
       * spawn underneath the side panel on every Demonic Tutor cast.
       */
      rightMarginVar?: string;
    };

export interface UseDraggableOptions {
  placement: DraggablePlacement;
  /**
   * CSS selector identifying the drag handle within the dialog.
   * Defaults to `[data-drag-handle]`. Pointerdowns outside this
   * selector are ignored — buttons / inputs / sliders inside the
   * handle still work because the hook bails on
   * `closest('button, input, select, textarea, a, [role=button], label')`
   * before initiating drag.
   */
  handleSelector?: string;
  /**
   * When true (the default) the dialog's position is clamped so it
   * stays at least partially inside the viewport (cannot be dragged
   * fully off-screen). Setting false allows free placement.
   */
  constrainToViewport?: boolean;
}

export interface UseDraggableResult {
  /**
   * Spread these props onto the outermost dialog element you want to
   * be draggable (the one whose `position: fixed` left/top should
   * follow the drag). Adds the pointer event handlers; the hook
   * decides per-event whether the target is inside a drag handle.
   */
  containerProps: {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: RPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: RPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: RPointerEvent<HTMLElement>) => void;
  };
  /**
   * Inline style to merge onto the dialog element. Renders the dialog
   * as `position: fixed` with the current x/y coordinates, hidden
   * until the initial-placement effect computes its first position
   * (avoids a flash at top-left during the measure tick).
   */
  style: CSSProperties;
  /** Ref to attach to the dialog element so the hook can measure it. */
  ref: React.RefObject<HTMLDivElement | null>;
  /**
   * Whether the dialog has measured + positioned itself yet. Tests
   * may want to wait for this to flip true before asserting on
   * computed coordinates.
   */
  ready: boolean;
}

const DEFAULT_HANDLE_SELECTOR = '[data-drag-handle]';
// Elements whose pointerdown should NOT initiate a drag even when
// inside the drag handle. {@code label} stays here because clicking
// label text forwards the click to a contained {@code input} —
// stealing pointerdown into a drag would suppress the implicit
// click-forward and break checkbox / radio toggles. (Today no drag
// handle wraps a label; the rule is defence-in-depth for future
// callers.)
const INTERACTIVE_DESCENDANT_SELECTOR =
  'button, input, select, textarea, a, [role="button"], [role="slider"], label';

/**
 * Read a CSS custom property registered on {@code documentElement}
 * and parse it as a pixel length. Returns 0 when the var is unset
 * or unparseable. Used by {@code bottom-right} placement so a
 * dialog clears a dynamically-sized side panel
 * ({@code --side-panel-width}) instead of spawning underneath it.
 */
function readCssLengthVar(name: string): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim();
  if (!raw) return 0;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reusable drag-to-move hook for modal/banner surfaces. Extracted
 * from the original `ZoneBrowser` implementation (slice 70-Y "Game:
 * battlefield rows wrap instead of scroll, and graveyard / exile
 * modals redesigned mulligan-sized + draggable" — `94ba56da`).
 *
 * <p>Usage: caller renders the dialog with `position: fixed` (the
 * hook supplies left/top via the returned style), marks the drag
 * handle with `data-drag-handle`, and spreads the returned
 * pointer handlers onto whatever element should LISTEN for the
 * drag (typically the dialog root — the hook inspects the event
 * target so the same listener can serve a header inside a deep
 * subtree).
 *
 * <p>The hook clamps the dialog inside the viewport by default
 * (`constrainToViewport: true`): the dialog cannot be parked fully
 * off-screen, and a window resize re-clamps it. Dialog rect is
 * remeasured on each window resize so the clamp uses current
 * dimensions.
 *
 * <p>Pointer-down on an interactive descendant of the drag handle
 * (button / input / slider / etc.) does NOT initiate a drag; this
 * lets the user click the modal's close button, a checkbox in a
 * settings dialog, or the Done button on a banner without dragging
 * the surface around.
 */
export function useDraggable(opts: UseDraggableOptions): UseDraggableResult {
  const {
    placement,
    handleSelector = DEFAULT_HANDLE_SELECTOR,
    constrainToViewport = true,
  } = opts;

  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const clamp = useCallback(
    (x: number, y: number, w: number, h: number): { x: number; y: number } => {
      if (!constrainToViewport) return { x, y };
      // Allow zero or positive margin on each side; cap so the dialog
      // can't extend past the viewport's right/bottom edge either.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxX = Math.max(0, vw - w);
      const maxY = Math.max(0, vh - h);
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
      };
    },
    [constrainToViewport],
  );

  // Initial placement: measure the dialog after first paint and set
  // pos based on the chosen mode. useLayoutEffect runs synchronously
  // before browser paint so we don't see a (0,0) flash.
  //
  // Audit fix 2026-05-03 — when content inside the dialog loads
  // async (CardFace tiles in MulliganModal, ZoneBrowser grid before
  // images decode), getBoundingClientRect returns 0×0 on the first
  // tick. Computing the centre on a zero rect produces (vw/2, vh/2)
  // — the dialog renders top-left-anchored at viewport centre, not
  // visually centred. Fix: place once with whatever the rect is now
  // (so the dialog is visible immediately and DOM queries work) and
  // schedule up to ~5 rAF-spaced re-measures. Each retry that finds
  // a non-zero rect refines the position; the dialog visibly snaps
  // into place once content has laid out. If the rect is non-zero
  // on the first measure (the common case + every test fixture
  // declaring explicit dimensions), no retries fire.
  useLayoutEffect(() => {
    if (pos !== null) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let attemptsLeft = 5;
    const measureAndPlace = () => {
      if (cancelled) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let x = 0;
      let y = 0;
      switch (placement.kind) {
        case 'center':
          x = (vw - rect.width) / 2;
          y = (vh - rect.height) / 2;
          break;
        case 'top-center':
          x = (vw - rect.width) / 2;
          y = placement.topMargin ?? 64;
          break;
        case 'bottom-center': {
          const baseBottom = placement.bottomMargin ?? 16;
          const varOffset = placement.bottomMarginVar
            ? readCssLengthVar(placement.bottomMarginVar)
            : 0;
          x = (vw - rect.width) / 2;
          y = vh - rect.height - baseBottom - varOffset;
          break;
        }
        case 'bottom-right': {
          const baseRight = placement.rightMargin ?? 16;
          const varOffset = placement.rightMarginVar
            ? readCssLengthVar(placement.rightMarginVar)
            : 0;
          x = vw - rect.width - baseRight - varOffset;
          y = vh - rect.height - (placement.bottomMargin ?? 16);
          break;
        }
      }
      setPos(clamp(x, y, rect.width, rect.height));
      // Schedule a refinement pass when the rect was degenerate —
      // covers the async-content case (MulliganModal CardFace tiles,
      // ZoneBrowser grid pre-decode). 5 frames @60fps ≈ 83ms; each
      // pass calls setPos again so the dialog visibly snaps once
      // content lays out.
      if (
        (rect.width === 0 || rect.height === 0) &&
        attemptsLeft > 0 &&
        typeof requestAnimationFrame !== 'undefined'
      ) {
        attemptsLeft -= 1;
        requestAnimationFrame(measureAndPlace);
      }
    };
    measureAndPlace();
    return () => {
      cancelled = true;
    };
    // Deps include `pos` so the effect re-runs after each setPos
    // (the early-return guards against repeated work). `placement`
    // is typically a fresh object literal at the call site so it
    // changes every render — that's the signal that lets the effect
    // re-fire when the host component flips from rendering null to
    // rendering the dialog (e.g. MulliganModal first appears with
    // `pendingDialog === null`, then a later render attaches the
    // ref to a freshly-mounted dialog div). With `[]` deps the
    // effect would only run on the component's first mount, when
    // ref.current is still null, and never re-run when the div
    // actually appears — leaving `pos` null forever and the dialog
    // stuck at `visibility: hidden`.
  }, [pos, placement, clamp]);

  // Re-clamp on window resize so a shrinking viewport doesn't leave
  // the dialog stranded off-screen. Skip when dialog hasn't measured
  // yet — the initial placement effect handles that.
  useEffect(() => {
    if (!constrainToViewport) return;
    const onResize = () => {
      const el = ref.current;
      if (!el || !pos) return;
      const rect = el.getBoundingClientRect();
      setPos((cur) => (cur ? clamp(cur.x, cur.y, rect.width, rect.height) : cur));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos, clamp, constrainToViewport]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      // Only left-click drags (per user spec). Other buttons (right /
      // middle) pass through unimpeded — context menu still opens.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Must originate inside an element flagged as a drag handle…
      if (!target.closest(handleSelector)) return;
      // …and must NOT originate on an interactive descendant of that
      // handle (button, input, slider, etc.) so inner controls keep
      // working.
      if (target.closest(INTERACTIVE_DESCENDANT_SELECTOR)) return;
      e.preventDefault();
      const rect = ref.current?.getBoundingClientRect();
      const originX = pos?.x ?? (rect ? rect.left : 0);
      const originY = pos?.y ?? (rect ? rect.top : 0);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX,
        originY,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // jsdom and some older browsers don't implement
        // setPointerCapture; the drag still works because pointermove
        // bubbles to the same element while the cursor is over it.
      }
    },
    [handleSelector, pos],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const rect = ref.current?.getBoundingClientRect();
      const w = rect?.width ?? 0;
      const h = rect?.height ?? 0;
      setPos(clamp(drag.originX + dx, drag.originY + dy, w, h));
    },
    [clamp],
  );

  const releasePointer = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragStateRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // best-effort; ignore if pointer capture was already released
      }
    },
    [],
  );

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.x ?? 0,
    top: pos?.y ?? 0,
    // Hide until the layout effect computes the first position so the
    // dialog doesn't flash at (0,0) before the measure tick.
    visibility: pos === null ? 'hidden' : 'visible',
    margin: 0,
  };

  return {
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: releasePointer,
      onPointerCancel: releasePointer,
    },
    style,
    ref,
    ready: pos !== null,
  };
}
