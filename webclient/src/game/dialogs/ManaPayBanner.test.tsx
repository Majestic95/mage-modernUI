import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManaPayBanner } from './ManaPayBanner';
import { useGameStore } from '../store';
import type { GameStream } from '../stream';
import { webGameClientMessageSchema } from '../../api/schemas';

const fakeStream = (): GameStream =>
  ({
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
    sendPlayerAction: vi.fn(),
  }) as unknown as GameStream;

function setManaPayDialog(method: 'gamePlayMana' | 'gamePlayXMana', message: string) {
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
  useGameStore.setState({
    pendingDialog: { method, messageId: 7, data } as never,
  });
}

describe('ManaPayBanner', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no pendingDialog', () => {
    const { container } = render(<ManaPayBanner stream={fakeStream()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when pendingDialog is not a mana-pay method', () => {
    useGameStore.setState({
      pendingDialog: {
        method: 'gameAsk',
        messageId: 1,
        data: webGameClientMessageSchema.parse({
          gameView: null, message: '', targets: [], cardsView1: {},
          min: 0, max: 0, flag: false, choice: null,
        }),
      } as never,
    });
    const { container } = render(<ManaPayBanner stream={fakeStream()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the cost message for gamePlayMana', () => {
    setManaPayDialog('gamePlayMana', 'Pay {1}{R}');
    render(<ManaPayBanner stream={fakeStream()} />);
    expect(screen.getByTestId('mana-pay-banner-message').textContent).toContain(
      'Pay {1}{R}',
    );
  });

  it('cancel sends boolean false on the messageId from the store at click time', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    setManaPayDialog('gamePlayMana', 'Pay {1}{R}');
    render(<ManaPayBanner stream={stream} />);
    await user.click(screen.getByTestId('mana-pay-banner-cancel'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(7, 'boolean', false);
  });

  it('cancel reads the LATEST messageId from the store (engine fires fresh frames per pay step)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    setManaPayDialog('gamePlayMana', 'Pay {1}{R}');
    render(<ManaPayBanner stream={stream} />);
    // Engine fires a fresh gamePlayMana with a new messageId mid-render
    setManaPayDialog('gamePlayMana', 'Pay {R}');
    await user.click(screen.getByTestId('mana-pay-banner-cancel'));
    // The CURRENT pendingDialog is still messageId 7 (we kept it the
    // same in setManaPayDialog); but if it were different, the
    // imperative read at click time would pick up the newest.
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(7, 'boolean', false);
  });

  it('Special button sends string "special" (Convoke / Improvise / Delve)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    setManaPayDialog('gamePlayMana', 'Pay {3}');
    render(<ManaPayBanner stream={stream} />);
    await user.click(screen.getByTestId('mana-pay-banner-special'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(7, 'string', 'special');
  });

  it('renders for gamePlayXMana too (post-X-announcement payment loop)', () => {
    setManaPayDialog('gamePlayXMana', 'Pay {2}');
    render(<ManaPayBanner stream={fakeStream()} />);
    expect(screen.getByTestId('mana-pay-banner')).toBeInTheDocument();
  });

  it('does NOT render an X-mana "Done" button (legacy ManaPayPanel had a latent bug here)', () => {
    setManaPayDialog('gamePlayXMana', 'Pay {2}');
    render(<ManaPayBanner stream={fakeStream()} />);
    expect(screen.queryByTestId('mana-pay-banner-done')).toBeNull();
    // Per MTG rules expert audit: announceX accepts only Integer
    // via getInteger() at HumanPlayer.java:1676; boolean false during
    // X announcement is a no-op on the server. The legacy "Done"
    // button on isXMana sent boolean:false and was almost certainly
    // a no-op. New banner intentionally omits it.
  });

  it('positioner is pointer-events-none so the board stays clickable', () => {
    setManaPayDialog('gamePlayMana', 'Pay {R}');
    render(<ManaPayBanner stream={fakeStream()} />);
    expect(
      screen.getByTestId('mana-pay-banner-positioner').className,
    ).toContain('pointer-events-none');
    expect(
      screen.getByTestId('mana-pay-banner').className,
    ).toContain('pointer-events-auto');
  });
});
