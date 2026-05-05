/**
 * Component tests for the floating Game Log window chrome.
 *
 * <p>Mocks the inner GameLog so this suite focuses on chrome
 * (open/close, persistence, structural affordances). The GameLog
 * itself is covered by GameLog.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  GAME_LOG_WINDOW_RESIZE_DIRS,
  GAME_LOG_WINDOW_STORAGE_KEY,
} from './gameLogWindowState';

// Mock the inner GameLog so tests don't need to wire up the Zustand
// store. The chrome contract is what's being verified here.
vi.mock('./GameLog', () => ({
  GameLog: () => <div data-testid="game-log-mock" />,
}));

import { GameLogWindow } from './GameLogWindow';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe('GameLogWindow — first-load default', () => {
  it('renders the reopen pill when no state is persisted (closed by default)', () => {
    render(<GameLogWindow players={[]} />);
    expect(screen.getByTestId('game-log-reopen')).toBeInTheDocument();
    expect(screen.queryByTestId('game-log-window')).toBeNull();
  });

  it('reopen pill is labeled "Game Log"', () => {
    render(<GameLogWindow players={[]} />);
    expect(screen.getByTestId('game-log-reopen')).toHaveTextContent('Game Log');
  });
});

describe('GameLogWindow — open / close cycle', () => {
  it('clicking the reopen pill opens the window and hides the pill', () => {
    render(<GameLogWindow players={[]} />);
    fireEvent.click(screen.getByTestId('game-log-reopen'));
    expect(screen.getByTestId('game-log-window')).toBeInTheDocument();
    expect(screen.queryByTestId('game-log-reopen')).toBeNull();
  });

  it('clicking the close button hides the window and restores the pill', () => {
    render(<GameLogWindow players={[]} />);
    fireEvent.click(screen.getByTestId('game-log-reopen'));
    fireEvent.click(screen.getByTestId('game-log-window-close'));
    expect(screen.queryByTestId('game-log-window')).toBeNull();
    expect(screen.getByTestId('game-log-reopen')).toBeInTheDocument();
  });

  it('open state persists across remount via localStorage', () => {
    const { unmount } = render(<GameLogWindow players={[]} />);
    fireEvent.click(screen.getByTestId('game-log-reopen'));
    unmount();
    render(<GameLogWindow players={[]} />);
    // Window should render directly — pill should NOT.
    expect(screen.getByTestId('game-log-window')).toBeInTheDocument();
    expect(screen.queryByTestId('game-log-reopen')).toBeNull();
  });

  it('closed state persists across remount via localStorage', () => {
    // Pre-seed an open state, then close, then remount.
    const { unmount } = render(<GameLogWindow players={[]} />);
    fireEvent.click(screen.getByTestId('game-log-reopen'));
    fireEvent.click(screen.getByTestId('game-log-window-close'));
    unmount();
    render(<GameLogWindow players={[]} />);
    expect(screen.getByTestId('game-log-reopen')).toBeInTheDocument();
    expect(screen.queryByTestId('game-log-window')).toBeNull();
  });
});

describe('GameLogWindow — chrome structure', () => {
  it('exposes the title bar with role=dialog + aria-label', () => {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify({ x: 100, y: 100, width: 360, height: 480, isOpen: true }),
    );
    render(<GameLogWindow players={[]} />);
    const w = screen.getByTestId('game-log-window');
    expect(w).toHaveAttribute('role', 'dialog');
    expect(w).toHaveAttribute('aria-label', 'Game Log');
    expect(screen.getByTestId('game-log-window-titlebar')).toBeInTheDocument();
  });

  it('renders all 8 resize handles when open', () => {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify({ x: 100, y: 100, width: 360, height: 480, isOpen: true }),
    );
    render(<GameLogWindow players={[]} />);
    for (const dir of GAME_LOG_WINDOW_RESIZE_DIRS) {
      expect(
        screen.getByTestId(`game-log-window-resize-${dir}`),
      ).toBeInTheDocument();
    }
  });

  it('positions the window from persisted x/y/width/height', () => {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify({ x: 250, y: 150, width: 400, height: 500, isOpen: true }),
    );
    render(<GameLogWindow players={[]} />);
    const w = screen.getByTestId('game-log-window');
    expect(w.style.left).toBe('250px');
    expect(w.style.top).toBe('150px');
    expect(w.style.width).toBe('400px');
    expect(w.style.height).toBe('500px');
  });

  it('mounts the inner GameLog (mocked) inside the window', () => {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify({ x: 100, y: 100, width: 360, height: 480, isOpen: true }),
    );
    render(<GameLogWindow players={[]} />);
    const w = screen.getByTestId('game-log-window');
    expect(w).toContainElement(screen.getByTestId('game-log-mock'));
  });
});

describe('GameLogWindow — viewport clamping on hydration', () => {
  it('clamps off-viewport persisted positions on mount', () => {
    window.localStorage.setItem(
      GAME_LOG_WINDOW_STORAGE_KEY,
      JSON.stringify({ x: 99999, y: 99999, width: 360, height: 480, isOpen: true }),
    );
    render(<GameLogWindow players={[]} />);
    const w = screen.getByTestId('game-log-window');
    const left = parseInt(w.style.left, 10);
    const top = parseInt(w.style.top, 10);
    expect(left).toBeLessThan(window.innerWidth);
    expect(top).toBeLessThan(window.innerHeight);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});
