/**
 * Floating, draggable, resizable Game Log window.
 *
 * <p>Mounted as a {@code position: fixed} sibling of GameTable's grid
 * regions (via GameTable's tabletop-only conditional). Wraps the
 * existing {@link GameLog} with title-bar drag chrome, 8 resize handles
 * (4 corners + 4 edges), close button, and a top-right reopen pill.
 *
 * <p><b>Why this exists.</b> Under {@code variant === 'tabletop'} the
 * side panel is force-collapsed (P4 polish-pass, 2026-05-03), which
 * applies {@code display: none} to the entire {@code <aside>} hosting
 * the in-panel GameLog mount. The CommanderDamageTracker (F2 audit)
 * and ActionButton (UI/UX-C1) each got floating docks during the
 * graduation cutover; the GameLog was missed. This component is the
 * floating-dock equivalent for the log surface.
 *
 * <p><b>Two GameLog mounts in tabletop, by design.</b> The aside-
 * mounted GameLog stays in the React tree (hidden via
 * {@code display: none}); this floating window mounts a second
 * GameLog. Zustand multi-subscribe is normal — the store is the
 * source of truth, both subscribers render the same data, only one
 * is visible. Mirrors the CommanderDamageTracker pattern (in-aside
 * + floating dock both mounted under tabletop).
 *
 * <p><b>Persistence.</b> Position + size + open/closed state persist
 * to {@code localStorage["xmage.gameLogWindow.state"]} via
 * {@link gameLogWindowState}. On mount we clamp the persisted rect to
 * the current viewport so a state saved on a wider monitor doesn't
 * render off-screen.
 *
 * <p><b>Z-index 50</b> — above GameDialog (z-40), action dock (z-35),
 * and commander damage dock (z-30) per explicit user direction. Means
 * if a dialog is open and the log overlaps it, the user must drag the
 * log aside before clicking the dialog. Drag chrome is unmistakable
 * (cursor: move + visible title bar).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { WebPlayerView } from '../api/schemas';
import { GameLog } from './GameLog';
import {
  applyResize,
  clampToViewport,
  GAME_LOG_WINDOW_RESIZE_DIRS,
  loadGameLogWindowState,
  saveGameLogWindowState,
  type GameLogWindowResizeDir,
  type GameLogWindowState,
} from './gameLogWindowState';

export function GameLogWindow({
  players,
}: {
  players: readonly WebPlayerView[];
}) {
  const [state, setState] = useState<GameLogWindowState>(() =>
    loadGameLogWindowState(),
  );

  useEffect(() => {
    saveGameLogWindowState(state);
  }, [state]);

  const open = useCallback(() => setState((s) => ({ ...s, isOpen: true })), []);
  const close = useCallback(
    () => setState((s) => ({ ...s, isOpen: false })),
    [],
  );

  // Drag gesture state lives in a ref so an in-flight gesture isn't
  // disrupted by re-renders. Origin coords are captured at pointerdown
  // and stay constant for the gesture's lifetime.
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const onTitleBarPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Left-click only; ignore middle/right click + touch contextmenus.
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setState((s) => {
        dragRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          origX: s.x,
          origY: s.y,
        };
        return s;
      });
    },
    [],
  );

  const onTitleBarPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const nx = d.origX + (e.clientX - d.startX);
      const ny = d.origY + (e.clientY - d.startY);
      setState((s) =>
        clampToViewport(
          { ...s, x: nx, y: ny },
          window.innerWidth,
          window.innerHeight,
        ),
      );
    },
    [],
  );

  const onTitleBarPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (d && e.pointerId === d.pointerId) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        dragRef.current = null;
      }
    },
    [],
  );

  // Resize gesture state — same ref pattern as drag.
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    orig: GameLogWindowState;
    dir: GameLogWindowResizeDir;
  } | null>(null);

  const beginResize = useCallback(
    (dir: GameLogWindowResizeDir) =>
      (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        // Resize handles overlap the title bar at the corners; stop
        // propagation so the title-bar drag doesn't ALSO start.
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setState((s) => {
          resizeRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            orig: s,
            dir,
          };
          return s;
        });
      },
    [],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const r = resizeRef.current;
      if (!r || e.pointerId !== r.pointerId) return;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;
      const next = applyResize(r.orig, r.dir, dx, dy);
      setState(clampToViewport(next, window.innerWidth, window.innerHeight));
    },
    [],
  );

  const onResizePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const r = resizeRef.current;
      if (r && e.pointerId === r.pointerId) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        resizeRef.current = null;
      }
    },
    [],
  );

  if (!state.isOpen) {
    return (
      <button
        type="button"
        data-testid="game-log-reopen"
        onClick={open}
        className="fixed top-3 right-3 z-50 px-3 py-1.5 rounded-md bg-zinc-800/95 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs uppercase tracking-wider shadow-lg flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
        aria-label="Show game log"
      >
        <span aria-hidden="true">📋</span>
        <span>Game Log</span>
      </button>
    );
  }

  return (
    <div
      data-testid="game-log-window"
      role="dialog"
      aria-label="Game Log"
      className="fixed z-50 bg-bg-elevated border border-zinc-700 rounded-lg shadow-2xl flex flex-col select-none"
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
      }}
    >
      <header
        data-testid="game-log-window-titlebar"
        onPointerDown={onTitleBarPointerDown}
        onPointerMove={onTitleBarPointerMove}
        onPointerUp={onTitleBarPointerUp}
        onPointerCancel={onTitleBarPointerUp}
        className="flex items-center justify-between px-3 py-1.5 cursor-move bg-zinc-900 rounded-t-lg border-b border-zinc-800 flex-shrink-0"
      >
        <span className="text-xs uppercase tracking-wider text-zinc-300 font-semibold">
          Game Log
        </span>
        <button
          type="button"
          data-testid="game-log-window-close"
          onClick={close}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-zinc-400 hover:text-zinc-100 px-1 leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
          aria-label="Close game log"
        >
          ×
        </button>
      </header>

      {/* GameLog content. select-text re-enables text selection inside
          the log even though the window root is select-none (which
          prevents accidental text-select drag-state during a title-bar
          drag). */}
      <div className="flex-1 min-h-0 flex flex-col select-text">
        <GameLog players={players} />
      </div>

      {GAME_LOG_WINDOW_RESIZE_DIRS.map((dir) => (
        <ResizeHandle
          key={dir}
          dir={dir}
          onPointerDown={beginResize(dir)}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      ))}
    </div>
  );
}

function ResizeHandle({
  dir,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  dir: GameLogWindowResizeDir;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      data-testid={`game-log-window-resize-${dir}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={resizeHandleStyles(dir)}
      aria-hidden="true"
    />
  );
}

function resizeHandleStyles(dir: GameLogWindowResizeDir): CSSProperties {
  const T = 6;
  const C = 12;
  const base: CSSProperties = { position: 'absolute', touchAction: 'none' };
  switch (dir) {
    case 'n':
      return { ...base, top: 0, left: C, right: C, height: T, cursor: 'ns-resize' };
    case 's':
      return { ...base, bottom: 0, left: C, right: C, height: T, cursor: 'ns-resize' };
    case 'e':
      return { ...base, top: C, bottom: C, right: 0, width: T, cursor: 'ew-resize' };
    case 'w':
      return { ...base, top: C, bottom: C, left: 0, width: T, cursor: 'ew-resize' };
    case 'ne':
      return { ...base, top: 0, right: 0, width: C, height: C, cursor: 'nesw-resize' };
    case 'nw':
      return { ...base, top: 0, left: 0, width: C, height: C, cursor: 'nwse-resize' };
    case 'se':
      return { ...base, bottom: 0, right: 0, width: C, height: C, cursor: 'nwse-resize' };
    case 'sw':
      return { ...base, bottom: 0, left: 0, width: C, height: C, cursor: 'nesw-resize' };
  }
}
