/**
 * Pure state helpers for the floating Game Log window.
 *
 * <p>Extracted from {@link GameLogWindow} so the rect math
 * ({@link applyResize}, {@link clampToViewport}, {@link computeInitialState})
 * is unit-testable without rendering React. Also keeps the component
 * file under the 400-LOC soft cap.
 */
export interface GameLogWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isOpen: boolean;
}

export type GameLogWindowResizeDir =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

export const GAME_LOG_WINDOW_STORAGE_KEY = 'xmage.gameLogWindow.state';
export const GAME_LOG_WINDOW_MIN_WIDTH = 280;
export const GAME_LOG_WINDOW_MIN_HEIGHT = 200;
export const GAME_LOG_WINDOW_DEFAULT_WIDTH = 360;
export const GAME_LOG_WINDOW_DEFAULT_HEIGHT = 480;
const MARGIN = 24;

export const GAME_LOG_WINDOW_RESIZE_DIRS: readonly GameLogWindowResizeDir[] = [
  'n',
  's',
  'e',
  'w',
  'ne',
  'nw',
  'se',
  'sw',
];

export function computeInitialState(viewportWidth: number): GameLogWindowState {
  return {
    x: Math.max(MARGIN, viewportWidth - GAME_LOG_WINDOW_DEFAULT_WIDTH - MARGIN),
    y: MARGIN,
    width: GAME_LOG_WINDOW_DEFAULT_WIDTH,
    height: GAME_LOG_WINDOW_DEFAULT_HEIGHT,
    isOpen: false,
  };
}

/**
 * Clamp a window rect into the viewport with a small breathing margin
 * so a state saved on a wider monitor doesn't render off-screen after
 * the user resizes their window or moves to a smaller display.
 */
export function clampToViewport(
  s: GameLogWindowState,
  viewportWidth: number,
  viewportHeight: number,
): GameLogWindowState {
  const width = Math.min(
    Math.max(s.width, GAME_LOG_WINDOW_MIN_WIDTH),
    Math.max(GAME_LOG_WINDOW_MIN_WIDTH, viewportWidth - 16),
  );
  const height = Math.min(
    Math.max(s.height, GAME_LOG_WINDOW_MIN_HEIGHT),
    Math.max(GAME_LOG_WINDOW_MIN_HEIGHT, viewportHeight - 16),
  );
  const x = Math.min(Math.max(s.x, 0), Math.max(0, viewportWidth - width));
  const y = Math.min(Math.max(s.y, 0), Math.max(0, viewportHeight - height));
  return { ...s, x, y, width, height };
}

/**
 * Apply a resize delta to the original rect for the given handle
 * direction. The "origin" rect is captured at pointerdown time and
 * stays constant for the duration of the gesture; only delta moves.
 *
 * <p>When a west / north handle drags past the min-size floor, the
 * opposite edge stays anchored — so the window doesn't drift sideways
 * once it can't shrink further. Mirrors native OS window resize.
 */
export function applyResize(
  orig: GameLogWindowState,
  dir: GameLogWindowResizeDir,
  dx: number,
  dy: number,
): GameLogWindowState {
  let { x, y, width, height } = orig;
  if (dir.includes('e')) {
    width = orig.width + dx;
  }
  if (dir.includes('w')) {
    width = orig.width - dx;
    x = orig.x + dx;
  }
  if (dir.includes('s')) {
    height = orig.height + dy;
  }
  if (dir.includes('n')) {
    height = orig.height - dy;
    y = orig.y + dy;
  }
  if (width < GAME_LOG_WINDOW_MIN_WIDTH) {
    if (dir.includes('w')) {
      x = orig.x + (orig.width - GAME_LOG_WINDOW_MIN_WIDTH);
    }
    width = GAME_LOG_WINDOW_MIN_WIDTH;
  }
  if (height < GAME_LOG_WINDOW_MIN_HEIGHT) {
    if (dir.includes('n')) {
      y = orig.y + (orig.height - GAME_LOG_WINDOW_MIN_HEIGHT);
    }
    height = GAME_LOG_WINDOW_MIN_HEIGHT;
  }
  return { x, y, width, height, isOpen: orig.isOpen };
}

export function loadGameLogWindowState(): GameLogWindowState {
  const initial =
    typeof window !== 'undefined'
      ? computeInitialState(window.innerWidth)
      : computeInitialState(1280);
  if (typeof window === 'undefined') return initial;
  try {
    const raw = window.localStorage.getItem(GAME_LOG_WINDOW_STORAGE_KEY);
    if (!raw) return initial;
    const parsed = JSON.parse(raw) as Partial<GameLogWindowState>;
    const merged: GameLogWindowState = {
      x: typeof parsed.x === 'number' ? parsed.x : initial.x,
      y: typeof parsed.y === 'number' ? parsed.y : initial.y,
      width: typeof parsed.width === 'number' ? parsed.width : initial.width,
      height:
        typeof parsed.height === 'number' ? parsed.height : initial.height,
      isOpen:
        typeof parsed.isOpen === 'boolean' ? parsed.isOpen : initial.isOpen,
    };
    return clampToViewport(merged, window.innerWidth, window.innerHeight);
  } catch {
    // Bad JSON / disabled storage / quota error — silently fall back
    // to defaults. UX still works; persistence is just a nicety.
    return initial;
  }
}

export function saveGameLogWindowState(state: GameLogWindowState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // localStorage off / quota full — UX still works, persistence
    // skipped. No user-visible error path needed.
  }
}
