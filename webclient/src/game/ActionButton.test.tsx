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
    myPlayerId: string;
    players: Array<{ playerId: string; skipState: string }>;
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
    // Slice 70-Z bug fix exposed a gap — the F2 handler now reads
    // useAuthStore.getState() to derive myPriority for primaryActionFor.
    // Mirror the useGameStore mock pattern: assign a `getState` helper
    // onto the mocked function so direct .getState() calls work too.
    useAuthStore: Object.assign(
      <T,>(selector: (s: typeof authState) => T) => selector(authState),
      {
        getState: () => authState,
      },
    ),
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
    myPlayerId: 'p-alice',
    players: [
      { playerId: 'p-alice', skipState: '' },
      { playerId: 'p-bob', skipState: '' },
    ],
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
      'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
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
        'action-menu-PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
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
    // Slice 70-O — Concede relocated to SettingsModal (header gear
    // icon). Menu has no destructive items.
    expect(screen.queryByTestId('action-menu-CONCEDE')).toBeNull();
  });

  it('multi-pass item dispatches immediately', async () => {
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
      'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
    );
  });

  // Slice 70-Z bug fix — when stack is non-empty AND it's my priority,
  // the morphing label flips to "Pass Priority" (deriveActionLabel),
  // and the dispatch must follow: PASS_PRIORITY_UNTIL_STACK_RESOLVED
  // so the spell resolves and AP regains priority IN THE CURRENT
  // PHASE, instead of the previous behavior which auto-passed through
  // main1 + begin_combat into declare-attackers (a UX violation of
  // CR 117.3b).
  it('F2 with stack non-empty + my priority dispatches UNTIL_STACK_RESOLVED, not the phase macro', () => {
    setGame({
      step: 'PRECOMBAT_MAIN',
      priorityPlayerName: 'alice',
      stack: { 'spell-on-stack': {} },
    });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    );
    expect(stream.sendPlayerAction).not.toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
    );
  });

  it('primary button click with stack non-empty + my priority dispatches UNTIL_STACK_RESOLVED', async () => {
    setGame({
      step: 'PRECOMBAT_MAIN',
      priorityPlayerName: 'alice',
      stack: { 'spell-on-stack': {} },
    });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-primary'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    );
  });

  it('primary button click with empty stack still dispatches the phase macro', async () => {
    // Sanity: empty-stack path is unchanged. The fix is scoped to the
    // "Pass Priority" label state.
    setGame({
      step: 'PRECOMBAT_MAIN',
      priorityPlayerName: 'alice',
      stack: {},
    });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await userEvent.click(screen.getByTestId('action-button-primary'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
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

  it('F9 dispatches "Pass to Your Turn" (until my next turn)', () => {
    // Audit fix 2026-05-03 — hotkey is F9 (not F6, which the engine
    // reserves for PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK and the
    // legacy desktop xmage muscle memory). The action stays
    // UNTIL_MY_NEXT_TURN — that's the right engine call for the
    // "skip until it's MY turn again" semantics the menu label
    // promises.
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_MY_NEXT_TURN',
    );
  });

  it('F6 (now unbound after audit fix) does not dispatch any action', () => {
    setGame();
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6' }));
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
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

  it('Concede has no hotkey binding (Concede only fires from SettingsModal — slice 70-O)', () => {
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

describe('ActionButton — schema 1.30 skip-state visuals', () => {
  it('does not render the skip-status banner when no skip is armed', () => {
    setGame();
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(screen.queryByTestId('skip-status-banner')).toBeNull();
  });

  it('renders the skip-status banner with the right label when local player has armed Pass-to-Next-Turn', () => {
    setGame({
      players: [
        { playerId: 'p-alice', skipState: 'NEXT_TURN' },
        { playerId: 'p-bob', skipState: '' },
      ],
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    const banner = screen.getByTestId('skip-status-banner');
    expect(banner).toHaveTextContent('Skipping to next turn');
    expect(banner.getAttribute('data-skip-state')).toBe('NEXT_TURN');
  });

  it('shows ALL_TURNS label for Pass-to-Your-Turn (passedAllTurns engine bool)', () => {
    setGame({
      players: [{ playerId: 'p-alice', skipState: 'ALL_TURNS' }],
      myPlayerId: 'p-alice',
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(screen.getByTestId('skip-status-banner')).toHaveTextContent(
      'Skipping until your next turn',
    );
  });

  it('clicking the skip-status banner cancels via PASS_PRIORITY_CANCEL_ALL_ACTIONS', async () => {
    const user = userEvent.setup();
    setGame({
      players: [{ playerId: 'p-alice', skipState: 'NEXT_TURN' }],
      myPlayerId: 'p-alice',
    });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await user.click(screen.getByTestId('skip-status-banner'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
    );
  });

  it('ignores OTHER players skipState — only the local player drives the banner', () => {
    setGame({
      players: [
        { playerId: 'p-alice', skipState: '' },
        { playerId: 'p-bob', skipState: 'NEXT_TURN' },
      ],
      myPlayerId: 'p-alice',
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    expect(screen.queryByTestId('skip-status-banner')).toBeNull();
  });

  it('marks the matching menu item ARMED when the corresponding skip is active', async () => {
    const user = userEvent.setup();
    setGame({
      players: [{ playerId: 'p-alice', skipState: 'NEXT_TURN' }],
      myPlayerId: 'p-alice',
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    await user.click(screen.getByTestId('action-button-ellipsis'));
    const armedItem = screen.getByTestId(
      'action-menu-PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
    expect(armedItem.getAttribute('data-armed')).toBe('true');
    expect(armedItem).toHaveTextContent(/armed/i);
    // Sibling items not armed
    const stackItem = screen.getByTestId(
      'action-menu-PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    );
    expect(stackItem.getAttribute('data-armed')).toBeNull();
  });

  it('uses role="menuitemcheckbox" with aria-checked for skip menu items (audit fix)', async () => {
    const user = userEvent.setup();
    setGame({
      players: [{ playerId: 'p-alice', skipState: 'NEXT_TURN' }],
      myPlayerId: 'p-alice',
    });
    authState.session = { username: 'alice' };
    render(<ActionButton stream={makeStream()} />);
    await user.click(screen.getByTestId('action-button-ellipsis'));
    const armed = screen.getByTestId(
      'action-menu-PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
    expect(armed.getAttribute('role')).toBe('menuitemcheckbox');
    expect(armed.getAttribute('aria-checked')).toBe('true');
    const notArmed = screen.getByTestId(
      'action-menu-PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    );
    expect(notArmed.getAttribute('role')).toBe('menuitemcheckbox');
    expect(notArmed.getAttribute('aria-checked')).toBe('false');
    // Non-skip menuitems (Stop Skipping, Undo) keep the plain
    // menuitem role and have no aria-checked.
    const undo = screen.getByTestId('action-menu-UNDO');
    expect(undo.getAttribute('role')).toBe('menuitem');
    expect(undo.getAttribute('aria-checked')).toBeNull();
  });

  it('clicking an ARMED menu item dispatches CANCEL_ALL_ACTIONS, not the same arm action', async () => {
    // Audit fix 2026-05-03 — re-dispatching the SAME PASS_PRIORITY_*
    // call would call resetPlayerPassedActions then re-arm. The
    // user-intent on clicking an armed item is "stop skipping"; the
    // dispatch must route to PASS_PRIORITY_CANCEL_ALL_ACTIONS.
    const user = userEvent.setup();
    setGame({
      players: [{ playerId: 'p-alice', skipState: 'NEXT_TURN' }],
      myPlayerId: 'p-alice',
    });
    authState.session = { username: 'alice' };
    const stream = makeStream();
    render(<ActionButton stream={stream} />);
    await user.click(screen.getByTestId('action-button-ellipsis'));
    await user.click(
      screen.getByTestId('action-menu-PASS_PRIORITY_UNTIL_NEXT_TURN'),
    );
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
    );
    expect(stream.sendPlayerAction).not.toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
  });

  it('does not crash when gv has no players (edge case during early frame)', () => {
    // Defensive — schemas allow players to be empty during the
    // pre-game window. Component must not error before the first
    // populated frame.
    setGame({ players: [] });
    authState.session = { username: 'alice' };
    expect(() =>
      render(<ActionButton stream={makeStream()} />),
    ).not.toThrow();
    expect(screen.queryByTestId('skip-status-banner')).toBeNull();
  });
});
