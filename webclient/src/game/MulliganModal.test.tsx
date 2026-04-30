import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isMulliganDialog, MulliganModal } from './MulliganModal';
import { useGameStore } from './store';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type WebGameView,
} from '../api/schemas';

function makeGameView(): WebGameView {
  const me = webPlayerViewSchema.parse({
    playerId: 'me-id',
    name: 'me',
    life: 7, // mid-mulligan, hand of 7
    wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  const opp = webPlayerViewSchema.parse({
    playerId: 'opp-id',
    name: 'alice',
    life: 7,
    wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 0, phase: '', step: '',
    activePlayerName: 'me', priorityPlayerName: 'me',
    special: false, rollbackTurnsAllowed: false,
    totalErrorsCount: 0, totalEffectsCount: 0, gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: {}, stack: {}, combat: [],
    players: [me, opp],
  });
}

const mulliganDialog = {
  method: 'gameAsk' as const,
  messageId: 17,
  data: {
    options: {
      leftBtnText: 'Mulligan',
      rightBtnText: 'Keep',
      possibleAttackers: [],
      possibleBlockers: [],
      specialButton: '',
    },
    message: 'Mulligan?',
  },
};

const fakeStream = () => ({
  sendObjectClick: vi.fn(),
  sendPlayerResponse: vi.fn(),
});

describe('isMulliganDialog', () => {
  it('matches the engine convention (left=Mulligan, right=Keep)', () => {
    expect(isMulliganDialog(mulliganDialog)).toBe(true);
  });

  it('rejects gameAsk with different button labels (Proliferate Done, etc.)', () => {
    expect(
      isMulliganDialog({
        method: 'gameAsk',
        data: { options: { leftBtnText: 'Done', rightBtnText: '' } },
      }),
    ).toBe(false);
  });

  it('rejects non-gameAsk methods', () => {
    expect(
      isMulliganDialog({
        method: 'gameTarget',
        data: {
          options: { leftBtnText: 'Mulligan', rightBtnText: 'Keep' },
        },
      }),
    ).toBe(false);
  });

  it('handles missing options gracefully (no crash on malformed data)', () => {
    expect(isMulliganDialog({ method: 'gameAsk' })).toBe(false);
    expect(
      isMulliganDialog({ method: 'gameAsk', data: {} }),
    ).toBe(false);
  });
});

describe('MulliganModal', () => {
  afterEach(() => {
    useGameStore.setState({ pendingDialog: null });
    vi.unstubAllGlobals();
  });

  it('renders nothing when no mulligan dialog is pending', () => {
    render(<MulliganModal stream={null} gameView={makeGameView()} />);
    expect(screen.queryByTestId('mulligan-modal')).toBeNull();
  });

  it('renders nothing for non-mulligan gameAsk (Proliferate, etc.)', () => {
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 5,
          data: { options: { leftBtnText: 'Done', rightBtnText: '' } },
        },
      });
    });
    render(<MulliganModal stream={null} gameView={makeGameView()} />);
    expect(screen.queryByTestId('mulligan-modal')).toBeNull();
  });

  it('renders the modal when mulligan dialog is pending', () => {
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    render(
      <MulliganModal stream={fakeStream() as never} gameView={makeGameView()} />,
    );
    expect(screen.getByTestId('mulligan-modal')).toBeInTheDocument();
    expect(screen.getByTestId('mulligan-keep')).toBeInTheDocument();
    expect(screen.getByTestId('mulligan-take')).toBeInTheDocument();
  });

  it('shows every player in the deciding-status panel', () => {
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    render(
      <MulliganModal stream={fakeStream() as never} gameView={makeGameView()} />,
    );
    const status = screen.getByTestId('mulligan-player-status');
    // The local player is annotated "(you)"; both players show as
    // "deciding…" until the modal closes.
    expect(status.textContent).toContain('me');
    expect(status.textContent).toContain('(you)');
    expect(status.textContent).toContain('alice');
    expect(status.textContent).toMatch(/deciding/);
  });

  it('Mulligan button dispatches sendPlayerResponse(messageId, "boolean", true)', async () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    const user = userEvent.setup();
    render(<MulliganModal stream={stream as never} gameView={makeGameView()} />);

    await user.click(screen.getByTestId('mulligan-take'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledExactlyOnceWith(
      17,
      'boolean',
      true,
    );
    // Local pendingDialog clears, but the modal stays mounted in
    // "waiting for opponents" state per the committed-latch fix
    // (slice 70-F critic Tech-C2 / UX-1).
    expect(useGameStore.getState().pendingDialog).toBeNull();
    expect(screen.getByTestId('mulligan-modal')).toBeInTheDocument();
  });

  it('Keep button dispatches sendPlayerResponse(messageId, "boolean", false)', async () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    const user = userEvent.setup();
    render(<MulliganModal stream={stream as never} gameView={makeGameView()} />);

    await user.click(screen.getByTestId('mulligan-keep'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledExactlyOnceWith(
      17,
      'boolean',
      false,
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();
    expect(screen.getByTestId('mulligan-modal')).toBeInTheDocument();
  });

  // Slice 70-F critic Tech-C2 / UX-1 — the modal must persist after
  // local commit so the user sees "waiting for opponents" rather
  // than the modal vanishing instantly. The latch resets when the
  // engine pushes the next non-mulligan game state (pendingDialog
  // stays null) OR when a fresh mulligan dialog arrives (deeper
  // mulligan loop).
  it('committed-latch keeps the modal mounted after local commit', async () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    const user = userEvent.setup();
    render(<MulliganModal stream={stream as never} gameView={makeGameView()} />);

    await user.click(screen.getByTestId('mulligan-keep'));
    // Modal still visible — local pendingDialog cleared, but the
    // committed latch keeps it rendered.
    expect(screen.getByTestId('mulligan-modal')).toBeInTheDocument();
    // Local player's status flips to "committed".
    const localCell = screen.getByTestId('mulligan-player-me-id');
    expect(localCell.textContent).toMatch(/committed/);
    // Buttons disabled to prevent double-dispatch.
    expect(screen.getByTestId('mulligan-keep')).toBeDisabled();
    expect(screen.getByTestId('mulligan-take')).toBeDisabled();
  });

  it('a deeper mulligan dialog (next loop iteration) resets the committed latch', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    render(<MulliganModal stream={stream as never} gameView={makeGameView()} />);

    await user.click(screen.getByTestId('mulligan-keep'));
    expect(screen.getByTestId('mulligan-keep')).toBeDisabled();

    // Engine sends a new mulligan dialog (different messageId →
    // fresh decision required).
    act(() => {
      useGameStore.setState({
        pendingDialog: { ...mulliganDialog, messageId: 18 },
      });
    });
    expect(screen.getByTestId('mulligan-keep')).not.toBeDisabled();
    expect(screen.getByTestId('mulligan-take')).not.toBeDisabled();
  });

  it('renders nothing when stream is null even with mulligan pending', () => {
    // Defensive: a missing stream means we can't dispatch; don't
    // show buttons that won't work.
    act(() => {
      useGameStore.setState({ pendingDialog: mulliganDialog });
    });
    render(<MulliganModal stream={null} gameView={makeGameView()} />);
    expect(screen.queryByTestId('mulligan-modal')).toBeNull();
  });
});
