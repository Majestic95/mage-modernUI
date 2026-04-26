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
  schemaVersion: '1.12',
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

  it('Concede button sends CONCEDE', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /concede/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('CONCEDE');
  });
});
