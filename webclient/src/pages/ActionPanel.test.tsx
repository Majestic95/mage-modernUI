import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionPanel } from './ActionPanel';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import type { GameStream } from '../game/stream';
import {
  webGameViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.15',
  token: 'tok-anon',
  username: 'alice',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

function gameViewWithPriorityOn(priorityName: string) {
  const me = webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'alice',
    life: 20, wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true,
    hasPriority: priorityName === 'alice',
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: priorityName,
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: {},
    stack: {},
    combat: [],
    players: [me],
  });
}

function fakeStream() {
  return {
    sendPlayerAction: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
  } as unknown as GameStream;
}

describe('ActionPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useGameStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no gameView', () => {
    const { container } = render(<ActionPanel stream={fakeStream()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows priority indicator when controlling player has priority', () => {
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={fakeStream()} />);
    expect(screen.getByText(/your priority/i)).toBeInTheDocument();
  });

  it('shows waiting indicator when opponent has priority', () => {
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('COMPUTER_MONTE_CARLO'),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });

  it('Pass-step button sends PASS_PRIORITY_UNTIL_TURN_END_STEP', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /pass step/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_TURN_END_STEP',
    );
  });

  it('To-end-turn button sends PASS_PRIORITY_UNTIL_NEXT_TURN', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /to end turn/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
  });

  it('Concede button opens confirmation modal; confirm sends CONCEDE', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('concede-button'));
    // Modal opens, no dispatch yet.
    expect(screen.getByTestId('concede-confirm')).toBeInTheDocument();
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('concede-confirm-yes'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('CONCEDE');
    expect(screen.queryByTestId('concede-confirm')).toBeNull();
  });

  it('Concede modal Cancel does not dispatch', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('concede-button'));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId('concede-confirm')).toBeNull();
  });

  it('Concede modal Esc closes without firing the cancel-passes hotkey', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('concede-button'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('concede-confirm')).toBeNull();
    // Esc should NOT have fired PASS_PRIORITY_CANCEL_ALL_ACTIONS — the
    // capture-phase modal listener stopImmediatePropagation'd it.
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  /* ---------- slice 37: Undo button + Ctrl+Z hotkey ---------- */

  it('Undo button sends UNDO', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('undo-button'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('UNDO');
  });

  it('Ctrl+Z fires UNDO', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{Control>}z{/Control}');
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('UNDO');
  });

  it('bare z (no modifier) does not fire UNDO', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('z');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  it('Ctrl+F2 does not fire pass-step (modifier mismatch)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{Control>}{F2}{/Control}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  /* ---------- slice 29: keyboard pass shortcuts ---------- */

  it.each([
    ['F2', 'PASS_PRIORITY_UNTIL_TURN_END_STEP'],
    ['F4', 'PASS_PRIORITY_UNTIL_NEXT_TURN'],
    ['F6', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['F8', 'PASS_PRIORITY_UNTIL_STACK_RESOLVED'],
    ['Escape', 'PASS_PRIORITY_CANCEL_ALL_ACTIONS'],
  ])('keydown %s dispatches %s', async (key, expectedAction) => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard(`{${key}}`);
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(expectedAction);
  });

  it('hotkeys are suppressed when focus is in an input element', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    const { container } = render(
      <>
        <input data-testid="chat-input" />
        <ActionPanel stream={stream} />
      </>,
    );
    const input = container.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLInputElement;
    input.focus();
    await user.keyboard('{F2}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  it('unrelated keys do not dispatch any action', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{F1}{F3}{F7}{a}{Enter}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });
});
