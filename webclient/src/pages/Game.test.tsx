import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Game } from './Game';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import { GameStream } from '../game/stream';
import {
  webCardViewSchema,
  webGameViewSchema,
  webPermanentViewSchema,
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

const FOREST = webCardViewSchema.parse({
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Forest',
  displayName: 'Forest',
  expansionSetCode: 'M21',
  cardNumber: '281',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Forest',
  supertypes: ['BASIC'],
  types: ['LAND'],
  subtypes: ['Forest'],
  colors: [],
  rarity: 'COMMON',
  power: '',
  toughness: '',
  startingLoyalty: '',
  rules: [],
  faceDown: false,
  counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
});

const TAPPED_FOREST_PERMANENT = webPermanentViewSchema.parse({
  card: { ...FOREST, id: '22222222-2222-2222-2222-222222222222' },
  controllerName: 'alice',
  tapped: true,
  flipped: false,
  transformed: false,
  phasedIn: true,
  summoningSickness: false,
  damage: 0,
  attachments: [],
  attachedTo: '',
  attachedToPermanent: false,
});

function buildGameView() {
  const me = webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'alice',
    life: 18,
    wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 1,
    graveyard: {}, exile: {}, sideboard: {},
    battlefield: { [TAPPED_FOREST_PERMANENT.card.id]: TAPPED_FOREST_PERMANENT },
    manaPool: { red: 0, green: 1, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  const ai = webPlayerViewSchema.parse({
    playerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'COMPUTER_MONTE_CARLO',
    life: 20,
    wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: false, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 2,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: 'alice',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: { [FOREST.id]: FOREST },
    stack: {},
    combat: [],
    players: [me, ai],
  });
}

const FAKE_GAME_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('Game page', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useGameStore.getState().reset();
    // Stub WebSocket so the Game component's stream.open() doesn't try
    // to make a real network connection during the test.
    vi.stubGlobal('WebSocket', class {
      static OPEN = 1;
      url: string;
      readyState = 0;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener() {}
      close() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders waiting state when no gameView is present', async () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    // open() is deferred via setTimeout(0) (StrictMode fix), so the
    // connection state transitions from 'idle' → 'connecting' on
    // the next tick. waitFor handles the async transition.
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText(/Connecting…/)).toBeInTheDocument();
    });
  });

  it('renders both player areas when a gameView is set', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    // Force re-render.
    expect(screen.getByTestId('player-area-self')).toBeInTheDocument();
    expect(screen.getByTestId('player-area-opponent')).toBeInTheDocument();
  });

  it('shows turn + phase in the header', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.getByText(/Turn 2/)).toBeInTheDocument();
    expect(screen.getByText(/PRECOMBAT_MAIN/)).toBeInTheDocument();
  });

  it("renders the controlling player's hand cards by name", () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const hand = screen.getByTestId('my-hand');
    expect(hand).toHaveTextContent('Forest');
  });

  it('renders battlefield permanents with the tapped marker', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const perms = screen.getAllByTestId('permanent');
    expect(perms).toHaveLength(1);
    expect(perms[0]).toHaveAttribute('data-tapped', 'true');
  });

  it('shows a protocolError banner when streamError is set', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        protocolError: 'BAD_REQUEST: oops',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/BAD_REQUEST/);
  });

  /* ---------- slice 11: command zone ---------- */

  it('renders the command zone when a player has a commander', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    // Inject a commander into self's commandList. Schema parsing
    // already happened in buildGameView, so we mutate via setState
    // with the resulting plain object.
    const commander = {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      kind: 'commander',
      name: "Atraxa, Praetors' Voice",
      expansionSetCode: 'C16',
      imageFileName: 'atraxa-praetors-voice',
      imageNumber: 1,
      rules: ['Flying, vigilance, deathtouch, lifelink'],
    };
    const me = gv.players.find((p) => p.controlled)!;
    me.commandList = [commander];

    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });

    const zones = screen.getAllByTestId('command-zone');
    expect(zones).toHaveLength(1);
    const chip = screen.getByTestId('command-chip');
    expect(chip).toHaveAttribute('data-kind', 'commander');
    expect(chip).toHaveTextContent(/Atraxa/);
    expect(chip).toHaveTextContent(/commander/i);
  });

  it('hides the command zone when the player has no command-zone entries', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: buildGameView() });
    });
    expect(screen.queryByTestId('command-zone')).not.toBeInTheDocument();
  });

  /* ---------- slice 14: cast-from-hand + permanent click ---------- */

  it('clicking a hand card calls stream.sendObjectClick with the card id', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendObjectClick')
      .mockImplementation(() => {});

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });

    const handCard = screen.getByTestId('hand-card');
    expect(handCard).not.toBeDisabled();
    await user.click(handCard);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(FOREST.id);
    sendSpy.mockRestore();
  });

  it('hand cards are disabled when self does not have priority', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    me.hasPriority = false;
    gv.priorityPlayerName = 'COMPUTER_MONTE_CARLO';
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });

    expect(screen.getByTestId('hand-card')).toBeDisabled();
    expect(screen.getByText(/waiting for priority/i)).toBeInTheDocument();
  });

  it('clicking a self-controlled permanent calls sendObjectClick', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendObjectClick')
      .mockImplementation(() => {});

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });

    const perm = screen.getAllByTestId('permanent')[0]!;
    expect(perm).not.toBeDisabled();
    await user.click(perm);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(TAPPED_FOREST_PERMANENT.card.id);
    sendSpy.mockRestore();
  });

  it('permanents are disabled and tagged when no priority', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    me.hasPriority = false;
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    expect(screen.getAllByTestId('permanent')[0]).toBeDisabled();
  });

  /* ---------- slice 18: game log strip ---------- */

  it('GameLog renders accumulated entries from store.gameLog', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameLog: [
          {
            id: 1,
            message: 'alice plays Forest',
            turn: 1,
            phase: 'PRECOMBAT_MAIN',
          },
          {
            id: 2,
            message: 'Lightning Bolt deals 3 damage to bob',
            turn: 2,
            phase: 'PRECOMBAT_MAIN',
          },
        ],
      });
    });

    const log = screen.getByTestId('game-log');
    expect(log).toHaveTextContent(/Game log \(2\)/);
    const entries = screen.getAllByTestId('game-log-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('alice plays Forest');
    expect(entries[1]).toHaveTextContent(/Lightning Bolt deals 3/);
  });

  it('GameLog shows empty placeholder before any entries arrive', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.getByTestId('game-log')).toHaveTextContent(/No events yet/);
  });

  it('GameLog strips raw HTML markup from the message', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameLog: [
          {
            id: 1,
            message: 'Mulligan <font color=#ffff00>down to 6</font>',
            turn: 1,
            phase: '',
          },
        ],
      });
    });
    const entry = screen.getByTestId('game-log-entry');
    expect(entry).toHaveTextContent(/Mulligan down to 6/);
    expect(entry.querySelector('font')).toBeNull();
  });

  /* ---------- slice 15: click-on-board targeting ---------- */

  function pendingTargetDialog(targets: string[]) {
    return {
      method: 'gameTarget' as const,
      messageId: 42,
      data: {
        gameView: null,
        message: 'Pick a target',
        targets,
        cardsView1: {},
        min: 0,
        max: 0,
        flag: true,
        choice: null,
      },
    };
  }

  it('clicking a hand card while gameTarget is pending sends playerResponse, not free click', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendObj = vi
      .spyOn(GameStream.prototype, 'sendObjectClick')
      .mockImplementation(() => {});
    const sendResp = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        pendingDialog: pendingTargetDialog([FOREST.id]),
      });
    });

    await user.click(screen.getByTestId('hand-card'));

    // Targeting takes precedence — went through playerResponse, not
    // sendObjectClick.
    expect(sendObj).not.toHaveBeenCalled();
    expect(sendResp).toHaveBeenCalledWith(42, 'uuid', FOREST.id);
    // Dialog cleared after dispatch.
    expect(useGameStore.getState().pendingDialog).toBeNull();
    sendObj.mockRestore();
    sendResp.mockRestore();
  });

  it('clicking a permanent while gameTarget is pending dispatches as target response', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendResp = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        pendingDialog: pendingTargetDialog([TAPPED_FOREST_PERMANENT.card.id]),
      });
    });

    await user.click(screen.getAllByTestId('permanent')[0]!);
    expect(sendResp).toHaveBeenCalledWith(
      42,
      'uuid',
      TAPPED_FOREST_PERMANENT.card.id,
    );
    sendResp.mockRestore();
  });

  it('player header becomes a clickable target when their UUID is in targets[]', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendResp = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const opponentId = gv.players.find((p) => !p.controlled)!.playerId;
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: gv,
        pendingDialog: pendingTargetDialog([opponentId]),
      });
    });

    const opponentBtn = screen.getByTestId('target-player-opponent');
    await user.click(opponentBtn);
    expect(sendResp).toHaveBeenCalledWith(42, 'uuid', opponentId);
    sendResp.mockRestore();
  });

  it('player header is plain text when no target dialog is pending', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(
      screen.queryByTestId('target-player-opponent'),
    ).not.toBeInTheDocument();
  });

  it('Leave button invokes onLeave', async () => {
    const onLeave = vi.fn();
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={onLeave} />);
    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).toHaveBeenCalled();
  });
});
