/**
 * Slice 70-M — ActionButton test coverage.
 *
 * The component is REDESIGN-only at the call site (GameTable mounts
 * it conditionally) but it doesn't itself read the REDESIGN flag,
 * so tests don't need to mock the flag. They DO need to mock the
 * Zustand store (gameView state) and the auth store (session for
 * priority comparison).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameStream } from './stream';

// Mock both stores. Pattern mirrors GameLog.test.tsx.
const storeState = vi.hoisted(() => ({
  gameView: null as null | {
    turn: number;
    phase: string;
    step: string;
    priorityPlayerName: string;
    stack: Record<string, unknown>;
  },
}));
vi.mock('./store', async () => {
  const actual =
    await vi.importActual<typeof import('./store')>('./store');
  return {
    ...actual,
    useGameStore: Object.assign(
      <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
      {
        getState: () => storeState,
      },
    ),
  };
});

const authState = vi.hoisted(() => ({
  session: null as null | { username: string },
}));
vi.mock('../auth/store', async () => {
  const actual =
    await vi.importActual<typeof import('../auth/store')>('../auth/store');
  return {
    ...actual,
    useAuthStore: <T,>(selector: (s: typeof authState) => T) =>
      selector(authState),
  };
});

import { ActionButton } from './ActionButton';

function makeStream(): GameStream {
  return {
    sendPlayerAction: vi.fn(),
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    close: vi.fn(),
  } as unknown as GameStream;
}

function setGame(overrides: Partial<typeof storeState.gameView> = {}) {
  storeState.gameView = {
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    priorityPlayerName: 'alice',
    stack: {},
    ...overrides,
  } as typeof storeState.gameView;
}

afterEach(() => {
  storeState.gameView = null;
  authState.session = null;
});

describe('ActionButton — guards', () => {
  it('returns null when no gameView is loaded', () => {
    storeState.gameView = null;
    authState.session = { username: 'alice' };
    const { container } = render(<ActionButton stream={makeStream()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when no session is loaded', () => {
    setGame();
    authState.session = null;
    const { container } = render(<ActionButton stream={makeStream()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ActionButton — TURN counter', () => {
  it('renders the current turn number', () => {
    setGame({ turn: 8 });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(screen.getByTestId('turn-counter')).toHaveTextContent(
      'Turn 8',
    );
  });

  it('falls back to em-dash for turn 0 / pre-game', () => {
    setGame({ turn: 0 });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(screen.getByTestId('turn-counter')).toHaveTextContent(
      'Turn —',
    );
  });
});

describe('ActionButton — morphing label', () => {
  it('shows "Attack" during DECLARE_ATTACKERS step with my priority', () => {
    setGame({
      step: 'DECLARE_ATTACKERS',
      priorityPlayerName: 'alice',
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(
      screen.getByTestId('action-button-primary'),
    ).toHaveTextContent('Attack');
  });

  it('shows "Block" during DECLARE_BLOCKERS with my priority', () => {
    setGame({
      step: 'DECLARE_BLOCKERS',
      priorityPlayerName: 'alice',
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(
      screen.getByTestId('action-button-primary'),
    ).toHaveTextContent('Block');
  });

  it('shows "Pass Priority" when stack non-empty + my priority', () => {
    setGame({
      step: 'PRECOMBAT_MAIN',
      priorityPlayerName: 'alice',
      stack: { 'spell-1': {} },
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(
      screen.getByTestId('action-button-primary'),
    ).toHaveTextContent('Pass Priority');
  });

  it('shows "End Step" during END_TURN step (catalog wording)', () => {
    setGame({ step: 'END_TURN' });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(
      screen.getByTestId('action-button-primary'),
    ).toHaveTextContent('End Step');
  });

  it('shows "End Step" during CLEANUP step', () => {
    setGame({ step: 'CLEANUP' });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(
      screen.getByTestId('action-button-primary'),
    ).toHaveTextContent('End Step');
  });

  it('falls back to "Next Phase" by default', () => {
    setGame({ step: 'PRECOMBAT_MAIN' });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(
      screen.getByTestId('action-button-primary'),
    ).toHaveTextContent('Next Phase');
  });

  it('shows "Done" when no nextPhase is available (pre-game state)', () => {
    setGame({ step: '' });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    const btn = screen.getByTestId('action-button-primary');
    expect(btn).toHaveTextContent('Done');
    expect(btn).toBeDisabled();
  });
});

describe('ActionButton — primary dispatch', () => {
  it('dispatches nextPhaseAction when clicked', async () => {
    setGame({ step: 'PRECOMBAT_MAIN' });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-primary'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_TURN_END_STEP',
    );
  });

  it('disabled state prevents click dispatch', async () => {
    setGame({ step: '' });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-primary'));
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });
});

describe('ActionButton — ellipsis menu', () => {
  it('opens menu on click', async () => {
    setGame();
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(screen.queryByTestId('action-button-menu')).toBeNull();
    await userEvent.click(screen.getByTestId('action-button-ellipsis'));
    expect(
      screen.getByTestId('action-button-menu'),
    ).toBeInTheDocument();
  });

  it('renders all multi-pass items + Concede with separator', async () => {
    setGame();
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    await userEvent.click(screen.getByTestId('action-button-ellipsis'));

    // Slice 70-M critic IMPORTANT-5 fix — labels match catalog
    // §5.C verbatim ("Pass to Next Turn" / "Pass to Your Turn"
    // etc.). Previous draft carried the legacy ActionPanel
    // wording ("End turn" / "Skip combat") forward.
    expect(
      screen.getByTestId('action-menu-PASS_PRIORITY_UNTIL_NEXT_TURN'),
    ).toHaveTextContent('Pass to Next Turn');
    expect(
      screen.getByTestId(
        'action-menu-PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
      ),
    ).toHaveTextContent('Pass to Your Turn');
    expect(
      screen.getByTestId(
        'action-menu-PASS_PRIORITY_UNTIL_STACK_RESOLVED',
      ),
    ).toHaveTextContent('Resolve Stack');
    expect(
      screen.getByTestId(
        'action-menu-PASS_PRIORITY_CANCEL_ALL_ACTIONS',
      ),
    ).toHaveTextContent('Stop Skipping');
    expect(screen.getByTestId('action-menu-UNDO')).toHaveTextContent(
      'Undo',
    );
    expect(
      screen.getByTestId('action-menu-CONCEDE'),
    ).toHaveTextContent('Concede game');
  });

  it('multi-pass item dispatches immediately without confirmation', async () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-ellipsis'));
    await userEvent.click(
      screen.getByTestId('action-menu-PASS_PRIORITY_UNTIL_NEXT_TURN'),
    );
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
    // Menu closes after dispatch
    expect(screen.queryByTestId('action-button-menu')).toBeNull();
  });

  it('Concede opens confirmation modal (no immediate dispatch)', async () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-ellipsis'));
    await userEvent.click(screen.getByTestId('action-menu-CONCEDE'));
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('concede-confirm'),
    ).toBeInTheDocument();
  });

  it('Concede confirmation modal "Yes" dispatches CONCEDE', async () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-ellipsis'));
    await userEvent.click(screen.getByTestId('action-menu-CONCEDE'));
    await userEvent.click(screen.getByTestId('concede-confirm-yes'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('CONCEDE');
  });

  it('clicking the backdrop closes the menu', async () => {
    setGame();
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    await userEvent.click(screen.getByTestId('action-button-ellipsis'));
    await userEvent.click(
      screen.getByTestId('action-button-menu-backdrop'),
    );
    expect(screen.queryByTestId('action-button-menu')).toBeNull();
  });
});

describe('ActionButton — hotkeys', () => {
  it('F2 dispatches the primary action', () => {
    setGame({ step: 'PRECOMBAT_MAIN' });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_TURN_END_STEP',
    );
  });

  it('F4 dispatches "End turn"', () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
  });

  it('F6 dispatches "Pass to Your Turn" (next-main-phase)', () => {
    // Slice 70-M critic IMPORTANT-6 fix — F6 was claimed in the
    // hotkey set but had no test covering its dispatch. Added
    // explicitly so a future refactor that drops F6 fails this
    // assertion.
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
    );
  });

  it('F8 dispatches "Resolve Stack"', () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    );
  });

  it('Esc with menu CLOSED dispatches PASS_PRIORITY_CANCEL_ALL_ACTIONS', () => {
    // Slice 70-M critic IMPORTANT-6 fix — when the menu is closed,
    // global Esc should fire the cancel-passes hotkey (the legacy
    // slice-29 binding). When the menu IS open, Esc closes the
    // menu (capture-phase listener stopImmediatePropagation). This
    // test covers the menu-closed path.
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
    );
  });

  it('Ctrl+Z dispatches UNDO', () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
    );
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('UNDO');
  });

  it('hotkeys ignored when focus is in an input field', () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    // Simulate the key event firing from an input
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', {
      key: 'F2',
      bubbles: true,
    });
    Object.defineProperty(event, 'target', { value: input });
    document.dispatchEvent(event);
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('Concede has no hotkey binding (defense in depth)', () => {
    // No key fires CONCEDE — the only path is the menu + confirmation.
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    // Try a few plausible accidental presses
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'C' }));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
    );
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });
});
