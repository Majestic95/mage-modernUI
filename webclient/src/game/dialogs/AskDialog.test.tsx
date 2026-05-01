import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YesNoDialog } from './AskDialog';
import { stickyAnswerKey, useGameStore } from '../store';
import type { GameStream } from '../stream';
import { webGameClientMessageSchema } from '../../api/schemas';
import type { PendingDialogClientMessage } from '../store';

const fakeStream = (): GameStream =>
  ({
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
    sendPlayerAction: vi.fn(),
  }) as unknown as GameStream;

function askDialog(
  messageId: number,
  message: string,
): PendingDialogClientMessage {
  const data = webGameClientMessageSchema.parse({
    gameView: null,
    message,
    targets: [],
    cardsView1: {},
    min: 0,
    max: 0,
    flag: false,
    choice: null,
  });
  return { method: 'gameAsk', messageId, data };
}

describe('YesNoDialog — sticky answers', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toggle off: clicking Yes does NOT record a sticky', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const dialog = askDialog(11, 'Pay 1 mana?');
    act(() => {
      useGameStore.setState({ pendingDialog: dialog });
    });
    render(
      <YesNoDialog
        dialog={dialog}
        stream={stream}
        clearDialog={() => useGameStore.getState().clearDialog()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(11, 'boolean', true);
    expect(useGameStore.getState().stickyAnswers).toEqual({});
  });

  it('toggle on (turn): clicking Yes records a turn-scoped sticky', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const dialog = askDialog(11, 'Pay 1 mana?');
    act(() => {
      useGameStore.setState({ pendingDialog: dialog });
    });
    render(
      <YesNoDialog
        dialog={dialog}
        stream={stream}
        clearDialog={() => useGameStore.getState().clearDialog()}
      />,
    );
    await user.click(screen.getByTestId('sticky-toggle-checkbox'));
    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    const key = stickyAnswerKey('gameAsk', 'Pay 1 mana?');
    expect(useGameStore.getState().stickyAnswers[key]).toEqual({
      answer: true,
      scope: 'turn',
    });
  });

  it('toggle on (game scope): clicking No records a game-scoped sticky', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const dialog = askDialog(11, 'Pay 1 mana?');
    act(() => {
      useGameStore.setState({ pendingDialog: dialog });
    });
    render(
      <YesNoDialog
        dialog={dialog}
        stream={stream}
        clearDialog={() => useGameStore.getState().clearDialog()}
      />,
    );
    await user.click(screen.getByTestId('sticky-toggle-checkbox'));
    await user.selectOptions(screen.getByTestId('sticky-toggle-scope'), 'game');
    await user.click(screen.getByRole('button', { name: /^no$/i }));
    const key = stickyAnswerKey('gameAsk', 'Pay 1 mana?');
    expect(useGameStore.getState().stickyAnswers[key]).toEqual({
      answer: false,
      scope: 'game',
    });
  });

  it('matched sticky: dialog auto-fires the remembered answer and renders nothing', async () => {
    const stream = fakeStream();
    const dialog = askDialog(22, 'Pay 1 mana?');
    const key = stickyAnswerKey('gameAsk', 'Pay 1 mana?');
    act(() => {
      useGameStore.setState({
        pendingDialog: dialog,
        stickyAnswers: { [key]: { answer: true, scope: 'turn' } },
      });
    });
    const { container } = render(
      <YesNoDialog
        dialog={dialog}
        stream={stream}
        clearDialog={() => useGameStore.getState().clearDialog()}
      />,
    );
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(22, 'boolean', true);
    expect(container.firstChild).toBeNull();
  });

  it('different message text: matched sticky on prompt A does NOT fire on prompt B', () => {
    const stream = fakeStream();
    const dialog = askDialog(33, 'Different question?');
    const key = stickyAnswerKey('gameAsk', 'Pay 1 mana?');
    act(() => {
      useGameStore.setState({
        pendingDialog: dialog,
        stickyAnswers: { [key]: { answer: true, scope: 'turn' } },
      });
    });
    render(
      <YesNoDialog
        dialog={dialog}
        stream={stream}
        clearDialog={() => useGameStore.getState().clearDialog()}
      />,
    );
    expect(stream.sendPlayerResponse).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^yes$/i })).toBeInTheDocument();
  });

  it('turn-scoped stickies clear when gameUpdate advances the turn', () => {
    const key = stickyAnswerKey('gameAsk', 'Pay 1?');
    act(() => {
      useGameStore.setState({
        gameView: { turn: 3 } as never,
        stickyAnswers: {
          [key]: { answer: true, scope: 'turn' },
          'persistent|x': { answer: false, scope: 'game' },
        },
      });
    });
    act(() => {
      useGameStore.getState().applyFrame(
        { method: 'gameUpdate', messageId: 1, objectId: '' } as never,
        { turn: 4, players: [], myHand: {} } as never,
      );
    });
    const stickies = useGameStore.getState().stickyAnswers;
    expect(stickies[key]).toBeUndefined();
    expect(stickies['persistent|x']).toEqual({ answer: false, scope: 'game' });
  });

  it('same turn: gameUpdate keeps turn-scoped stickies', () => {
    const key = stickyAnswerKey('gameAsk', 'Pay 1?');
    act(() => {
      useGameStore.setState({
        gameView: { turn: 3 } as never,
        stickyAnswers: { [key]: { answer: true, scope: 'turn' } },
      });
    });
    act(() => {
      useGameStore.getState().applyFrame(
        { method: 'gameUpdate', messageId: 1, objectId: '' } as never,
        { turn: 3, players: [], myHand: {} } as never,
      );
    });
    expect(useGameStore.getState().stickyAnswers[key]).toEqual({
      answer: true,
      scope: 'turn',
    });
  });
});
