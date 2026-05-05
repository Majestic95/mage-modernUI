/**
 * Unit tests for the floating Game Log window's pure state helpers.
 *
 * <p>Pure-function coverage — no DOM. Component-level tests live in
 * GameLogWindow.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyResize,
  clampToViewport,
  computeInitialState,
  GAME_LOG_WINDOW_DEFAULT_HEIGHT,
  GAME_LOG_WINDOW_DEFAULT_WIDTH,
  GAME_LOG_WINDOW_MIN_HEIGHT,
  GAME_LOG_WINDOW_MIN_WIDTH,
  GAME_LOG_WINDOW_STORAGE_KEY,
  loadGameLogWindowState,
  saveGameLogWindowState,
  type GameLogWindowState,
} from './gameLogWindowState';

const VW = 2560;
const VH = 1440;

function makeState(over: Partial<GameLogWindowState> = {}): GameLogWindowState {
  return {
    x: 100,
    y: 100,
    width: GAME_LOG_WINDOW_DEFAULT_WIDTH,
    height: GAME_LOG_WINDOW_DEFAULT_HEIGHT,
    isOpen: true,
    ...over,
  };
}

describe('computeInitialState', () => {
  it('anchors top-right with MARGIN gap', () => {
    const s = computeInitialState(VW);
    expect(s.x).toBe(VW - GAME_LOG_WINDOW_DEFAULT_WIDTH - 24);
    expect(s.y).toBe(24);
    expect(s.width).toBe(GAME_LOG_WINDOW_DEFAULT_WIDTH);
    expect(s.height).toBe(GAME_LOG_WINDOW_DEFAULT_HEIGHT);
  });

  it('is closed by default on first load', () => {
    expect(computeInitialState(VW).isOpen).toBe(false);
  });

  it('clamps x to MARGIN when viewport is narrower than default width', () => {
    const s = computeInitialState(200);
    expect(s.x).toBe(24);
  });
});

describe('clampToViewport', () => {
  it('passes through an in-bounds rect untouched', () => {
    const s = makeState({ x: 100, y: 100, width: 360, height: 480 });
    expect(clampToViewport(s, VW, VH)).toEqual(s);
  });

  it('pulls a window dragged off the right edge back into the viewport', () => {
    const s = makeState({ x: 99999 });
    const out = clampToViewport(s, VW, VH);
    expect(out.x).toBe(VW - s.width);
  });

  it('pulls a window dragged off the bottom edge back', () => {
    const s = makeState({ y: 99999 });
    const out = clampToViewport(s, VW, VH);
    expect(out.y).toBe(VH - s.height);
  });

  it('pulls a window dragged off the top-left edge back to (0, 0)', () => {
    const s = makeState({ x: -500, y: -500 });
    const out = clampToViewport(s, VW, VH);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('shrinks a window wider than the viewport to viewport width less margin', () => {
    const s = makeState({ x: 0, y: 0, width: 99999 });
    const out = clampToViewport(s, 1000, VH);
    expect(out.width).toBe(1000 - 16);
  });

  it('enforces min width when input is below floor', () => {
    const s = makeState({ width: 100 });
    expect(clampToViewport(s, VW, VH).width).toBe(GAME_LOG_WINDOW_MIN_WIDTH);
  });

  it('enforces min height when input is below floor', () => {
    const s = makeState({ height: 50 });
    expect(clampToViewport(s, VW, VH).height).toBe(GAME_LOG_WINDOW_MIN_HEIGHT);
  });

  it('preserves isOpen across clamping', () => {
    expect(clampToViewport(makeState({ isOpen: true }), VW, VH).isOpen).toBe(true);
    expect(clampToViewport(makeState({ isOpen: false }), VW, VH).isOpen).toBe(false);
  });
});

describe('applyResize', () => {
  const orig = makeState({ x: 200, y: 200, width: 400, height: 400 });

  it('east handle grows width without moving x', () => {
    const out = applyResize(orig, 'e', 50, 0);
    expect(out.width).toBe(450);
    expect(out.x).toBe(200);
  });

  it('west handle grows width AND shifts x left when delta is negative', () => {
    const out = applyResize(orig, 'w', -50, 0);
    expect(out.width).toBe(450);
    expect(out.x).toBe(150);
  });

  it('south handle grows height without moving y', () => {
    const out = applyResize(orig, 's', 0, 50);
    expect(out.height).toBe(450);
    expect(out.y).toBe(200);
  });

  it('north handle grows height AND shifts y up when delta is negative', () => {
    const out = applyResize(orig, 'n', 0, -50);
    expect(out.height).toBe(450);
    expect(out.y).toBe(150);
  });

  it('south-east corner grows both width and height', () => {
    const out = applyResize(orig, 'se', 30, 40);
    expect(out.width).toBe(430);
    expect(out.height).toBe(440);
    expect(out.x).toBe(200);
    expect(out.y).toBe(200);
  });

  it('north-west corner grows both AND shifts x/y', () => {
    const out = applyResize(orig, 'nw', -30, -40);
    expect(out.width).toBe(430);
    expect(out.height).toBe(440);
    expect(out.x).toBe(170);
    expect(out.y).toBe(160);
  });

  it('locks at MIN_WIDTH when shrinking past floor (east handle)', () => {
    const out = applyResize(orig, 'e', -9999, 0);
    expect(out.width).toBe(GAME_LOG_WINDOW_MIN_WIDTH);
  });

  it('locks at MIN_WIDTH when west handle shrinks past floor — x stays anchored to opposite edge', () => {
    const out = applyResize(orig, 'w', 9999, 0);
    expect(out.width).toBe(GAME_LOG_WINDOW_MIN_WIDTH);
    // The east edge of the window must not move. Original east edge =
    // x + width = 600; with MIN_WIDTH this means x = 600 - MIN_WIDTH.
    expect(out.x).toBe(orig.x + orig.width - GAME_LOG_WINDOW_MIN_WIDTH);
  });

  it('locks at MIN_HEIGHT when north handle shrinks past floor — y stays anchored to opposite edge', () => {
    const out = applyResize(orig, 'n', 0, 9999);
    expect(out.height).toBe(GAME_LOG_WINDOW_MIN_HEIGHT);
    expect(out.y).toBe(orig.y + orig.height - GAME_LOG_WINDOW_MIN_HEIGHT);
  });

  it('preserves isOpen across resize', () => {
    expect(applyResize(orig, 'e', 50, 0).isOpen).toBe(orig.isOpen);
  });
});

describe('loadGameLogWindowState + saveGameLogWindowState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns initial state when localStorage is empty', () => {
    const out = loadGameLogWindowState();
    expect(out.isOpen).toBe(false);
    expect(out.width).toBe(GAME_LOG_WINDOW_DEFAULT_WIDTH);
  });

  it('round-trips a saved state through save → load', () => {
    const s = makeState({ x: 500, y: 200, width: 400, height: 350, isOpen: true });
    saveGameLogWindowState(s);
    const out = loadGameLogWindowState();
    expect(out.x).toBe(500);
    expect(out.y).toBe(200);
    expect(out.width).toBe(400);
    expect(out.height).toBe(350);
    expect(out.isOpen).toBe(true);
  });

  it('falls back to defaults when localStorage contains corrupted JSON', () => {
    window.localStorage.setItem(GAME_LOG_WINDOW_STORAGE_KEY, '{not valid json');
    const out = loadGameLogWindowState();
    expect(out.width).toBe(GAME_LOG_WINDOW_DEFAULT_WIDTH);
  });

  it('fills missing fields from defaults when partial state is stored', () => {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify({ isOpen: true }),
    );
    const out = loadGameLogWindowState();
    expect(out.isOpen).toBe(true);
    expect(out.width).toBe(GAME_LOG_WINDOW_DEFAULT_WIDTH);
    expect(out.height).toBe(GAME_LOG_WINDOW_DEFAULT_HEIGHT);
  });

  it('clamps a saved off-viewport position on load (smaller monitor scenario)', () => {
    const s = makeState({ x: 99999, y: 99999, isOpen: true });
    saveGameLogWindowState(s);
    const out = loadGameLogWindowState();
    expect(out.x).toBeLessThan(window.innerWidth);
    expect(out.y).toBeLessThan(window.innerHeight);
  });
});
