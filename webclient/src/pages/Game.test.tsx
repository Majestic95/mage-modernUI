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

  it('shows turn number on the phase timeline (slice 28 owns this display)', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.getByTestId('phase-timeline')).toHaveTextContent(/Turn 2/);
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

  it('hand cards mark aria-disabled when self does not have priority — shows "Waiting for opponent" hint', () => {
    // Bug fix (2026-05-02) — was expect(...).toBeDisabled(). The
    // hand fan no longer hard-disables the underlying button when
    // the player lacks priority; instead it sets aria-disabled and
    // gates the cast click handler internally. This lets drag-to-
    // reorder fire on opponents' turns (a personal-layout action,
    // not a game action) while still announcing the disabled state
    // to assistive tech and showing the "Waiting for opponent" hint.
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    me.hasPriority = false;
    me.isActive = false;
    gv.priorityPlayerName = 'COMPUTER_MONTE_CARLO';
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });

    expect(screen.getByTestId('hand-card')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByTestId('hand-disabled-hint')).toHaveTextContent(
      /Waiting for opponent/i,
    );
  });

  it('clicking a hand card while !canAct does NOT dispatch a cast (silent gate)', async () => {
    // Bug fix (2026-05-02) companion — verify the aria-disabled
    // contract still suppresses cast dispatch. Without the internal
    // canAct gate, the new pointer-events-on path would let an
    // opponent-turn click reach the engine and gameError back.
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendObjectClick')
      .mockImplementation(() => {});

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    me.hasPriority = false;
    me.isActive = false;
    gv.priorityPlayerName = 'COMPUTER_MONTE_CARLO';
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });

    await user.click(screen.getByTestId('hand-card'));
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  /* ---------- slice 23: turn / priority indicators + hand hints ---------- */

  it('header shows "Your turn" + "Your priority" when self is active and has priority', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: buildGameView() });
    });
    expect(screen.getByTestId('turn-indicator')).toHaveTextContent(/Your turn/i);
    expect(screen.getByTestId('priority-indicator')).toHaveTextContent(
      /Your priority/i,
    );
  });

  it('header shows "Opponent\'s turn" + "Waiting for opponent" when AI is active', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    me.isActive = false;
    me.hasPriority = false;
    const ai = gv.players.find((p) => !p.controlled)!;
    ai.isActive = true;
    ai.hasPriority = true;
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    expect(screen.getByTestId('turn-indicator')).toHaveTextContent(
      /Opponent's turn/i,
    );
    expect(screen.getByTestId('priority-indicator')).toHaveTextContent(
      /Waiting for opponent/i,
    );
  });

  it('hand shows "Wait for your turn" hint when user has priority on opponent\'s turn', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    me.isActive = false; // not your turn
    me.hasPriority = true; // but you hold priority (instant-speed window)
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    expect(screen.getByTestId('hand-disabled-hint')).toHaveTextContent(
      /Wait for your turn/i,
    );
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

  /* ---------- slice 26: combat highlighting + ATK/BLK badges ---------- */

  function pendingDeclareAttackersDialog(possibleAttackers: string[]) {
    return {
      method: 'gameSelect' as const,
      messageId: 77,
      data: {
        gameView: null,
        message: 'Select attackers',
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
        options: {
          leftBtnText: '',
          rightBtnText: '',
          possibleAttackers,
          possibleBlockers: [],
          specialButton: '',
        },
      },
    };
  }

  it('marks permanents in POSSIBLE_ATTACKERS as combat-eligible during declare-attackers', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        pendingDialog: pendingDeclareAttackersDialog([
          TAPPED_FOREST_PERMANENT.card.id,
        ]),
      });
    });
    const perm = screen.getAllByTestId('permanent')[0]!;
    expect(perm).toHaveAttribute('data-combat-eligible', 'true');
  });

  it('does not mark permanents as combat-eligible outside combat modes', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const perm = screen.getAllByTestId('permanent')[0]!;
    expect(perm).not.toHaveAttribute('data-combat-eligible');
  });

  it('renders an ATK badge on permanents in gv.combat[].attackers', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    const opponent = gv.players.find((p) => !p.controlled)!;
    const attackerId = TAPPED_FOREST_PERMANENT.card.id;
    gv.combat = [
      {
        defenderId: opponent.playerId,
        defenderName: opponent.name,
        attackers: { [attackerId]: me.battlefield[attackerId]! },
        blockers: {},
        blocked: false,
      },
    ];
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    expect(screen.getByTestId('combat-badge-attacker')).toBeInTheDocument();
    expect(screen.queryByTestId('combat-badge-blocker')).toBeNull();
  });

  it('renders a BLK badge on permanents in gv.combat[].blockers', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    const opponent = gv.players.find((p) => !p.controlled)!;
    const blockerId = TAPPED_FOREST_PERMANENT.card.id;
    gv.combat = [
      {
        defenderId: opponent.playerId,
        defenderName: opponent.name,
        attackers: {},
        blockers: { [blockerId]: me.battlefield[blockerId]! },
        blocked: true,
      },
    ];
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    expect(screen.getByTestId('combat-badge-blocker')).toBeInTheDocument();
    expect(screen.queryByTestId('combat-badge-attacker')).toBeNull();
  });

  it('no combat badges when gv.combat[] is empty', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.queryByTestId('combat-badge-attacker')).toBeNull();
    expect(screen.queryByTestId('combat-badge-blocker')).toBeNull();
  });

  /* ---------- slice 45: BattlefieldTile (card-shaped permanents) ---------- */

  it('BattlefieldTile shows P/T overlay for creatures', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const grizzlyCard = webCardViewSchema.parse({
      ...FOREST,
      id: '66666666-6666-6666-6666-666666666666',
      name: 'Grizzly Bears',
      manaCost: '{1}{G}',
      typeLine: 'Creature — Bear',
      types: ['CREATURE'],
      subtypes: ['Bear'],
      power: '2',
      toughness: '2',
    });
    const grizzlyPerm = webPermanentViewSchema.parse({
      card: grizzlyCard,
      controllerName: 'alice',
      tapped: false,
      flipped: false,
      transformed: false,
      phasedIn: true,
      summoningSickness: false,
      damage: 0,
      attachments: [],
      attachedTo: '',
      attachedToPermanent: false,
    });
    const me = gv.players.find((p) => p.controlled)!;
    me.battlefield[grizzlyCard.id] = grizzlyPerm;
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    // The P/T overlay is the only place "2/2" appears on the
    // battlefield render for this card; assert it's in the DOM.
    const tileFaces = screen.getAllByTestId('battlefield-tile-face');
    expect(tileFaces.some((el) => el.textContent?.includes('2/2'))).toBe(true);
  });

  it('BattlefieldTile rotates 90deg when tapped', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    // The fixture's only permanent is TAPPED_FOREST_PERMANENT
    // (tapped: true) — its inner face should carry the 90° rotation.
    const face = screen.getByTestId('battlefield-tile-face');
    expect(face.style.transform).toContain('rotate(90deg)');
  });

  it('BattlefieldTile shows damage chip when damage > 0', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const wounded = webCardViewSchema.parse({
      ...FOREST,
      id: '77777777-7777-7777-7777-777777777777',
      name: 'Wounded Bear',
      manaCost: '{1}{G}',
      typeLine: 'Creature — Bear',
      types: ['CREATURE'],
      subtypes: ['Bear'],
      power: '3',
      toughness: '3',
    });
    const woundedPerm = webPermanentViewSchema.parse({
      card: wounded,
      controllerName: 'alice',
      tapped: false,
      flipped: false,
      transformed: false,
      phasedIn: true,
      summoningSickness: false,
      damage: 2,
      attachments: [],
      attachedTo: '',
      attachedToPermanent: false,
    });
    const me = gv.players.find((p) => p.controlled)!;
    me.battlefield[wounded.id] = woundedPerm;
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const chip = screen.getByTestId('permanent-damage');
    expect(chip).toHaveTextContent('-2');
  });

  it('BattlefieldTile shows counter chip when counters non-empty', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const buffedCard = webCardViewSchema.parse({
      ...FOREST,
      id: '88888888-8888-8888-8888-888888888888',
      name: 'Buffed Bear',
      manaCost: '{1}{G}',
      typeLine: 'Creature — Bear',
      types: ['CREATURE'],
      subtypes: ['Bear'],
      power: '2',
      toughness: '2',
      counters: { '+1/+1': 3 },
    });
    const buffedPerm = webPermanentViewSchema.parse({
      card: buffedCard,
      controllerName: 'alice',
      tapped: false,
      flipped: false,
      transformed: false,
      phasedIn: true,
      summoningSickness: false,
      damage: 0,
      attachments: [],
      attachedTo: '',
      attachedToPermanent: false,
    });
    const me = gv.players.find((p) => p.controlled)!;
    me.battlefield[buffedCard.id] = buffedPerm;
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const chip = screen.getByTestId('permanent-counters');
    expect(chip).toHaveTextContent('+1/+1: 3');
  });

  /* ---------- slice 27: stack rendering ---------- */

  it('hides the stack zone (no entries) when stack is empty', () => {
    // Slice 50: section stays mounted but visually collapsed so
    // AnimatePresence has somewhere to flush exit animations from.
    // Empty-state contract is now "no stack-entry children" rather
    // than "section unmounted."
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.queryAllByTestId('stack-entry')).toHaveLength(0);
    const stackZone = screen.queryByTestId('stack-zone');
    expect(stackZone).toBeInTheDocument();
    expect(stackZone).toHaveClass('opacity-0');
  });

  it('renders one stack entry per card on the stack', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const lightning = webCardViewSchema.parse({
      ...FOREST,
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Lightning Bolt',
      manaCost: '{R}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: ['Lightning Bolt deals 3 damage to any target.'],
    });
    gv.stack = { [lightning.id]: lightning };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const zone = screen.getByTestId('stack-zone');
    expect(zone).toBeInTheDocument();
    expect(zone).toHaveTextContent('Lightning Bolt');
    expect(screen.getAllByTestId('stack-entry')).toHaveLength(1);
  });

  it('marks the most recently added stack entry as TOP (resolves first)', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const oldest = webCardViewSchema.parse({
      ...FOREST,
      id: '44444444-4444-4444-4444-444444444444',
      name: 'Oldest Spell',
      manaCost: '{1}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
    });
    const newest = webCardViewSchema.parse({
      ...FOREST,
      id: '55555555-5555-5555-5555-555555555555',
      name: 'Newest Spell',
      manaCost: '{2}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
    });
    // Server preserves insertion order (LinkedHashMap) — oldest
    // first on the wire, newest first in the UI.
    gv.stack = { [oldest.id]: oldest, [newest.id]: newest };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const entries = screen.getAllByTestId('stack-entry');
    expect(entries).toHaveLength(2);
    // First rendered entry is the newest — and carries the TOP marker.
    expect(entries[0]).toHaveTextContent('Newest Spell');
    expect(entries[1]).toHaveTextContent('Oldest Spell');
    const topMarkers = screen.getAllByTestId('stack-top-marker');
    expect(topMarkers).toHaveLength(1);
    expect(entries[0]!.contains(topMarkers[0]!)).toBe(true);
  });

  /* ---------- slice 28: phase timeline ---------- */

  it('renders the phase timeline with all five phase segments', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.getByTestId('phase-timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('phase-segment')).toHaveLength(5);
  });

  it('marks the segment matching the active step as data-active-phase', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    // buildGameView sets phase: 'PRECOMBAT_MAIN', step: 'PRECOMBAT_MAIN'
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const segments = screen.getAllByTestId('phase-segment');
    const activeSegments = segments.filter(
      (el) => el.getAttribute('data-active-phase') === 'true',
    );
    expect(activeSegments).toHaveLength(1);
    expect(activeSegments[0]).toHaveAttribute('data-phase', 'Main Phase 1');
  });

  it('renders the active-step bloom orb on the matching tick', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    gv.step = 'DECLARE_BLOCKERS';
    gv.phase = 'COMBAT';
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const orbs = screen.getAllByTestId('active-step-orb');
    expect(orbs).toHaveLength(1);
    // The orb sits inside the tick element with data-step.
    const tick = orbs[0]!.closest('[data-testid="phase-tick"]');
    expect(tick).toHaveAttribute('data-step', 'DECLARE_BLOCKERS');
    expect(tick).toHaveAttribute('data-active-step', 'true');
  });

  it('shows the turn number and active player name on the timeline', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const timeline = screen.getByTestId('phase-timeline');
    expect(timeline).toHaveTextContent(/Turn 2/);
    expect(screen.getByTestId('active-player-name')).toHaveTextContent('alice');
  });

  it('labels each combat sub-step under its tick', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const segments = screen.getAllByTestId('phase-segment');
    const combat = segments.find(
      (el) => el.getAttribute('data-phase') === 'Combat',
    )!;
    const labels = combat.querySelectorAll(
      '[data-testid="phase-step-label"]',
    );
    expect(labels).toHaveLength(6);
    const stepNames = Array.from(labels).map((el) =>
      el.getAttribute('data-step'),
    );
    expect(stepNames).toEqual([
      'BEGIN_COMBAT',
      'DECLARE_ATTACKERS',
      'DECLARE_BLOCKERS',
      'FIRST_COMBAT_DAMAGE',
      'COMBAT_DAMAGE',
      'END_COMBAT',
    ]);
  });

  it('renders step labels under every phase, including single-step phases', () => {
    // Slice 70-Z polish round 23 (user direction 2026-04-30) — every
    // phase now shows step labels. Previously only Combat did, so
    // Main Phase 1's "Main 1" sub-label felt redundant with the
    // phase header — but the user wanted symmetry across the bar
    // for at-a-glance "what step am I in" reads.
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const segments = screen.getAllByTestId('phase-segment');
    const main1 = segments.find(
      (el) => el.getAttribute('data-phase') === 'Main Phase 1',
    )!;
    const labels = main1.querySelector('[data-testid="phase-step-labels"]');
    expect(labels).not.toBeNull();
    const main1StepLabels = main1.querySelectorAll(
      '[data-testid="phase-step-label"]',
    );
    expect(main1StepLabels).toHaveLength(1);
    expect(main1StepLabels[0]?.getAttribute('data-step')).toBe(
      'PRECOMBAT_MAIN',
    );
  });

  it('renders six combat ticks (5 standard + first-strike)', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const segments = screen.getAllByTestId('phase-segment');
    const combat = segments.find(
      (el) => el.getAttribute('data-phase') === 'Combat',
    );
    expect(combat).toBeTruthy();
    const ticks = combat!.querySelectorAll('[data-testid="phase-tick"]');
    expect(ticks).toHaveLength(6);
  });

  /* ---------- slice 30: hover-to-zoom card detail ---------- */

  it('hovering a hand card shows the card-detail overlay with name + mana cost', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.queryByTestId('card-detail-overlay')).toBeNull();
    await user.hover(screen.getByTestId('hand-card'));
    const detail = await screen.findByTestId('card-detail');
    expect(detail).toHaveTextContent('Forest');
    expect(detail).toHaveTextContent('Basic Land');
  });

  it('un-hovering hides the overlay', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const handCard = screen.getByTestId('hand-card');
    await user.hover(handCard);
    expect(await screen.findByTestId('card-detail')).toBeInTheDocument();
    await user.unhover(handCard);
    expect(screen.queryByTestId('card-detail')).toBeNull();
  });

  it('hovering a stack entry shows the detail with rules text', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const lightning = webCardViewSchema.parse({
      ...FOREST,
      id: '88888888-8888-8888-8888-888888888888',
      name: 'Lightning Bolt',
      manaCost: '{R}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: ['Lightning Bolt deals 3 damage to any target.'],
    });
    gv.stack = { [lightning.id]: lightning };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    await user.hover(screen.getByTestId('stack-entry'));
    const detail = await screen.findByTestId('card-detail');
    expect(detail).toHaveTextContent('Lightning Bolt');
    // Slice 32: mana cost renders as icon glyphs, not raw text
    expect(detail.querySelector('[data-testid="mana-cost"] i.ms-r')).toBeInTheDocument();
    expect(detail).toHaveTextContent(/3 damage to any target/);
  });

  it('hovering a battlefield permanent shows its detail', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    await user.hover(screen.getAllByTestId('permanent')[0]!);
    const detail = await screen.findByTestId('card-detail');
    expect(detail).toHaveTextContent('Forest');
  });

  /* ---------- slice 36: drag-to-play from hand ---------- */

  it('a quick click (no movement) plays the card via the existing click path', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendObj = vi
      .spyOn(GameStream.prototype, 'sendObjectClick')
      .mockImplementation(() => {});
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    await user.click(screen.getByTestId('hand-card'));
    expect(sendObj).toHaveBeenCalledWith(FOREST.id);
    sendObj.mockRestore();
  });

  it('crossing the 5px threshold surfaces a drag preview', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.queryByTestId('drag-preview')).toBeNull();
    const handCard = screen.getByTestId('hand-card');
    fireEvent.pointerDown(handCard, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 130, clientY: 100 });
    expect(await screen.findByTestId('drag-preview')).toBeInTheDocument();
    expect(screen.getByTestId('drag-preview')).toHaveTextContent('Forest');
  });

  it('releasing over a player area dispatches sendObjectClick (drop)', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const sendObj = vi
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
    fireEvent.pointerDown(handCard, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 200 });
    // Drop on the player's own area.
    const selfArea = screen.getByTestId('player-area-self');
    fireEvent.pointerUp(selfArea, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(sendObj).toHaveBeenCalledWith(FOREST.id);
    expect(screen.queryByTestId('drag-preview')).toBeNull();
    sendObj.mockRestore();
  });

  it('releasing outside a player area cancels with no dispatch', async () => {
    const { fireEvent } = await import('@testing-library/react');
    const sendObj = vi
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
    fireEvent.pointerDown(handCard, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(screen.getByTestId('drag-preview')).toBeInTheDocument();
    // Release on document (outside any droppable).
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(sendObj).not.toHaveBeenCalled();
    expect(screen.queryByTestId('drag-preview')).toBeNull();
    sendObj.mockRestore();
  });

  it('player areas show a drop-target ring while a drag is in flight', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const selfArea = screen.getByTestId('player-area-self');
    expect(selfArea).not.toHaveAttribute('data-drop-target');
    const handCard = screen.getByTestId('hand-card');
    fireEvent.pointerDown(handCard, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(selfArea).toHaveAttribute('data-drop-target', 'true');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(selfArea).not.toHaveAttribute('data-drop-target');
  });

  /* ---------- slice 34: scryfall card images ---------- */

  it('renders a Scryfall image inside the card detail overlay on hover', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    await user.hover(screen.getByTestId('hand-card'));
    const img = (await screen.findByTestId(
      'card-image',
    )) as HTMLImageElement;
    // Forest from M21 #281 → lowercase set, encoded number, normal version
    expect(img.getAttribute('src')).toBe(
      'https://api.scryfall.com/cards/m21/281?format=image&version=normal',
    );
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('alt')).toBe('Forest');
  });

  it('hides the image (text detail still visible) when Scryfall errors', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const { fireEvent } = await import('@testing-library/react');
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    await user.hover(screen.getByTestId('hand-card'));
    const img = await screen.findByTestId('card-image');
    fireEvent.error(img);
    // Image gone, but the rest of the detail card stays mounted.
    expect(screen.queryByTestId('card-image')).toBeNull();
    expect(screen.getByTestId('card-detail')).toHaveTextContent('Forest');
  });

  it('omits the image when set or collector number is missing', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    // Inject an unprinted card (e.g. a token built ad-hoc) — no
    // setCode means we can't derive a Scryfall URL.
    const tokenCard = webCardViewSchema.parse({
      ...FOREST,
      id: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
      name: 'Saproling',
      expansionSetCode: '',
      cardNumber: '',
    });
    gv.myHand = { [tokenCard.id]: tokenCard };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    await user.hover(screen.getByTestId('hand-card'));
    expect(await screen.findByTestId('card-detail')).toHaveTextContent(
      'Saproling',
    );
    expect(screen.queryByTestId('card-image')).toBeNull();
  });

  /* ---------- slice 32: mana cost icon font ---------- */

  it('renders mana costs as icon-font glyphs (one <i> per token)', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const lightning = webCardViewSchema.parse({
      ...FOREST,
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
      name: 'Lightning Bolt',
      manaCost: '{R}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: ['Lightning Bolt deals 3 damage to any target.'],
    });
    gv.stack = { [lightning.id]: lightning };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const stackEntry = screen.getByTestId('stack-entry');
    const cost = stackEntry.querySelector('[data-testid="mana-cost"]')!;
    expect(cost).toBeInTheDocument();
    const glyphs = cost.querySelectorAll('i');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]).toHaveClass('ms', 'ms-r');
    expect(glyphs[0]).toHaveAttribute('data-symbol', '{R}');
  });

  it('parses multi-token costs into one glyph per token', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const wrath = webCardViewSchema.parse({
      ...FOREST,
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
      name: 'Wrath of God',
      manaCost: '{2}{W}{W}',
      typeLine: 'Sorcery',
      types: ['SORCERY'],
      subtypes: [],
      rules: ['Destroy all creatures.'],
    });
    gv.stack = { [wrath.id]: wrath };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const stackEntry = screen.getByTestId('stack-entry');
    const glyphs = stackEntry.querySelectorAll(
      '[data-testid="mana-cost"] i',
    );
    expect(glyphs).toHaveLength(3);
    expect(glyphs[0]).toHaveClass('ms-2');
    expect(glyphs[1]).toHaveClass('ms-w');
    expect(glyphs[2]).toHaveClass('ms-w');
  });

  it('hybrid mana costs strip the slash for the class name', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const card = webCardViewSchema.parse({
      ...FOREST,
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
      name: 'Boros Charm',
      manaCost: '{R/W}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: [],
    });
    gv.stack = { [card.id]: card };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const glyph = screen
      .getByTestId('stack-entry')
      .querySelector('[data-testid="mana-cost"] i')!;
    expect(glyph).toHaveClass('ms-rw');
  });

  /* ---------- slice 31: zone browsers (graveyard + exile) ---------- */

  function gameViewWithZone(
    zone: 'graveyard' | 'exile',
    cards: Record<string, ReturnType<typeof webCardViewSchema.parse>>,
  ) {
    const gv = buildGameView();
    const me = gv.players.find((p) => p.controlled)!;
    if (zone === 'graveyard') me.graveyard = cards;
    else me.exile = cards;
    return gv;
  }

  it('graveyard count is plain text when empty', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const counts = screen.getAllByTestId('zone-count-graveyard');
    expect(counts[0]!.tagName).toBe('SPAN');
  });

  it('graveyard count becomes a button when non-empty', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const lightning = webCardViewSchema.parse({
      ...FOREST,
      id: '99999999-9999-9999-9999-999999999999',
      name: 'Lightning Bolt',
      manaCost: '{R}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: ['Lightning Bolt deals 3 damage to any target.'],
    });
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: gameViewWithZone('graveyard', { [lightning.id]: lightning }),
      });
    });
    const counts = screen.getAllByTestId('zone-count-graveyard');
    const myCount = counts.find((el) => el.tagName === 'BUTTON')!;
    expect(myCount).toBeInTheDocument();
    expect(myCount).toHaveTextContent('1');
  });

  it('clicking the graveyard count opens the zone browser', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const lightning = webCardViewSchema.parse({
      ...FOREST,
      id: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      name: 'Lightning Bolt',
      manaCost: '{R}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: ['Lightning Bolt deals 3 damage to any target.'],
    });
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: gameViewWithZone('graveyard', { [lightning.id]: lightning }),
      });
    });
    const counts = screen.getAllByTestId('zone-count-graveyard');
    const myButton = counts.find((el) => el.tagName === 'BUTTON')!;
    await user.click(myButton);
    expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('graveyard'),
    );
    // 2026-05-02 — modal redesign uses card-id-suffixed testids so
    // multi-card zones can be addressed individually. Match by id.
    expect(
      screen.getByTestId(`zone-browser-card-${lightning.id}`),
    ).toBeInTheDocument();
  });

  it('Esc closes the zone browser without firing ActionPanel hotkeys', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const card = webCardViewSchema.parse({
      ...FOREST,
      id: 'bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb',
      name: 'Wrath of God',
      manaCost: '{2}{W}{W}',
      typeLine: 'Sorcery',
      types: ['SORCERY'],
      subtypes: [],
      rules: ['Destroy all creatures.'],
    });
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: gameViewWithZone('graveyard', { [card.id]: card }),
      });
    });
    const myButton = screen
      .getAllByTestId('zone-count-graveyard')
      .find((el) => el.tagName === 'BUTTON')!;
    await user.click(myButton);
    expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('zone-browser')).toBeNull();
  });

  it('clicking the close button closes the zone browser', async () => {
    // 2026-05-02 — backdrop is no longer a close target. The modal
    // is draggable, doesn't render a scrim, and clicks outside it
    // pass through to the underlying battlefield. Only the close
    // button + Esc dismiss it.
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const card = webCardViewSchema.parse({
      ...FOREST,
      id: 'cccccccc-3333-3333-3333-cccccccccccc',
      name: 'Counterspell',
      manaCost: '{U}{U}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
      rules: ['Counter target spell.'],
    });
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: gameViewWithZone('exile', { [card.id]: card }),
      });
    });
    const myButton = screen
      .getAllByTestId('zone-count-exile')
      .find((el) => el.tagName === 'BUTTON')!;
    await user.click(myButton);
    expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    await user.click(screen.getByTestId('zone-browser-close'));
    expect(screen.queryByTestId('zone-browser')).toBeNull();
  });

  it('exile counter is rendered alongside the graveyard counter', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    expect(screen.getAllByTestId('zone-count-exile').length).toBeGreaterThan(0);
  });

  /* ---------- slice 19: game-end overlay ---------- */

  it('renders game-over banner when gameOverPending is set and gameEnd is null', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameOverPending: true,
        lastWrapped: {
          gameView: null,
          message: 'alice has won the game',
          targets: [],
          cardsView1: {},
          min: 0,
          max: 0,
          flag: false,
          choice: null,
          options: {
            leftBtnText: '',
            rightBtnText: '',
            possibleAttackers: [],
            possibleBlockers: [],
            specialButton: '',
          },
        },
      });
    });
    const banner = screen.getByTestId('game-over-banner');
    expect(banner).toHaveTextContent(/Game over/i);
    expect(banner).toHaveTextContent(/alice has won the game/);
    expect(banner).toHaveTextContent(/Waiting for the next game/);
  });

  it('renders match-end summary modal when gameEnd is set', async () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameEnd: {
          gameInfo: 'You won the game on turn 7.',
          matchInfo: 'You won the match!',
          additionalInfo: '',
          won: true,
          wins: 1,
          winsNeeded: 1,
          players: [],
        },
      });
    });
    const modal = screen.getByTestId('game-end-modal');
    expect(modal).toHaveTextContent(/Match won/i);
    expect(modal).toHaveTextContent(/You won the match/);
    expect(modal).toHaveTextContent(/1\/1/);
  });

  it('match-end modal shows "Match lost" + red styling when won=false', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameEnd: {
          gameInfo: '',
          matchInfo: 'You lost the match.',
          additionalInfo: '',
          won: false,
          wins: 0,
          winsNeeded: 1,
          players: [],
        },
      });
    });
    expect(screen.getByTestId('game-end-modal')).toHaveTextContent(/Match lost/i);
  });

  it('match-end Back to lobby button invokes onLeave', async () => {
    const onLeave = vi.fn();
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={onLeave} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameEnd: {
          gameInfo: '',
          matchInfo: '',
          additionalInfo: '',
          won: true,
          wins: 1,
          winsNeeded: 1,
          players: [],
        },
      });
    });
    await user.click(screen.getByRole('button', { name: /back to lobby/i }));
    expect(onLeave).toHaveBeenCalled();
  });

  it('match-end modal takes precedence over the game-over banner', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameOverPending: true,
        gameEnd: {
          gameInfo: '',
          matchInfo: 'GG',
          additionalInfo: '',
          won: true,
          wins: 1,
          winsNeeded: 1,
          players: [],
        },
      });
    });
    expect(screen.queryByTestId('game-over-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('game-end-modal')).toBeInTheDocument();
  });

  it('Leave button invokes onLeave', async () => {
    const onLeave = vi.fn();
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={onLeave} />);
    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).toHaveBeenCalled();
  });

  /* ---------- Phase 5 deliverable: Save game log download ---------- */

  it('renders Save game log button on the match-end modal when gameLog has entries', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameEnd: {
          gameInfo: '',
          matchInfo: 'GG',
          additionalInfo: '',
          won: true,
          wins: 1,
          winsNeeded: 1,
          players: [],
        },
        gameLog: [
          { id: 1, message: 'alice plays Forest', turn: 1, phase: 'PRECOMBAT_MAIN' },
          { id: 2, message: 'alice taps Forest for green', turn: 1, phase: 'PRECOMBAT_MAIN' },
        ],
      });
    });
    const button = screen.getByTestId('save-game-log');
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent(/save game log/i);
  });

  it('Save game log button is disabled when gameLog is empty', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameEnd: {
          gameInfo: '',
          matchInfo: 'GG',
          additionalInfo: '',
          won: true,
          wins: 1,
          winsNeeded: 1,
          players: [],
        },
        gameLog: [],
      });
    });
    const button = screen.getByTestId('save-game-log');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/no game-log/i));
  });

  it('Save game log button triggers a JSON download with the expected payload', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();

    // Capture the Blob fed to URL.createObjectURL so we can read its
    // text and assert on the JSON payload structure.
    const capturedBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlobs.push(blob);
      return 'blob:mock-url';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    // Intercept the synthetic anchor click so the test runner doesn't
    // actually attempt navigation.
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const entries = [
      { id: 1, message: 'alice plays Forest', turn: 1, phase: 'PRECOMBAT_MAIN' },
      { id: 2, message: 'alice ends turn', turn: 1, phase: 'CLEANUP' },
    ];

    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
        gameEnd: {
          gameInfo: 'You won the game on turn 7.',
          matchInfo: 'You won the match!',
          additionalInfo: '',
          won: true,
          wins: 1,
          winsNeeded: 1,
          players: [],
        },
        gameLog: entries,
      });
    });

    await user.click(screen.getByTestId('save-game-log'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    expect(capturedBlobs).toHaveLength(1);
    const blob = capturedBlobs[0]!;
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const payload = JSON.parse(text);
    expect(payload.schemaVersion).toBe('1.19');
    expect(payload.gameId).toBe(FAKE_GAME_ID);
    expect(typeof payload.exportedAt).toBe('string');
    expect(Date.parse(payload.exportedAt)).not.toBeNaN();
    expect(payload.match).toMatchObject({
      won: true,
      wins: 1,
      winsNeeded: 1,
      matchInfo: 'You won the match!',
    });
    expect(payload.entries).toEqual(entries);

    clickSpy.mockRestore();
  });

  /* ---------- slice 51: animated life total ---------- */

  it('shows each player\'s current life total verbatim', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    // Slice 70-D — LifeCounter testids are per-perspective so the
    // CommanderDamageTracker (slice 70-F) can host multiple counters
    // without collisions. Match all variants via regex.
    const totals = screen
      .getAllByTestId(/^life-counter-value/)
      .map((el) => el.textContent);
    // alice = 18, AI = 20 (per buildGameView).
    expect(totals).toEqual(expect.arrayContaining(['18', '20']));
  });

  it('floats a delta indicator when life decreases', async () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    // No deltas before any life change.
    expect(screen.queryAllByTestId('life-delta')).toHaveLength(0);

    // Apply 3 damage → life 18 → 15.
    const after = buildGameView();
    after.players[0].life = 15;
    act(() => {
      useGameStore.setState({ gameView: after });
    });

    const deltas = screen.getAllByTestId('life-delta');
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    // Loss → rose-tinted delta showing -3.
    const loss = deltas.find((el) => el.textContent === '-3');
    expect(loss).toBeDefined();
    // Slice 70-C — LifeCounter migrated from text-rose-400 to the
    // status-danger token. Token resolves to a similar red.
    expect(loss).toHaveClass('text-status-danger');
  });

  it('floats a positive delta with emerald tint when life increases', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });

    const after = buildGameView();
    after.players[0].life = 22; // +4 from 18
    act(() => {
      useGameStore.setState({ gameView: after });
    });

    const deltas = screen.getAllByTestId('life-delta');
    const gain = deltas.find((el) => el.textContent === '+4');
    expect(gain).toBeDefined();
    // Slice 70-C — LifeCounter migrated from text-emerald-300 to
    // the status-success token.
    expect(gain).toHaveClass('text-status-success');
  });

  /* ---------- slice 52c: cross-zone Framer Motion layoutId ---------- */
  //
  // The wrapping motion.div for each zone-tile component carries a
  // `layoutId={card.cardId}` so Framer can match the same physical
  // Magic card across stack / battlefield / hand and glide it. We
  // assert via a `data-layout-id` data attribute (mirror of the
  // layoutId prop, robust against framer-motion internals churn).

  it('battlefield permanents render a layoutId data attribute matching their cardId', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    // TAPPED_FOREST_PERMANENT's card was built off FOREST (no
    // explicit cardId), so the schema default '' is in place. To
    // exercise the happy path, swap in a fresh card with a real
    // cardId field.
    const me = gv.players.find((p) => p.controlled)!;
    const stableId = '88888888-8888-8888-8888-888888888888';
    const animatedCard = webCardViewSchema.parse({
      ...FOREST,
      id: stableId,
      cardId: stableId,
      name: 'Animated Forest',
    });
    me.battlefield = {
      [stableId]: webPermanentViewSchema.parse({
        card: animatedCard,
        controllerName: 'alice',
        tapped: false,
        flipped: false,
        transformed: false,
        phasedIn: true,
        summoningSickness: false,
        damage: 0,
        attachments: [],
        attachedTo: '',
        attachedToPermanent: false,
      }),
    };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    // The motion.div wraps the BattlefieldTile button; query the
    // DOM ancestor that carries data-layout-id. Each permanent's
    // button is testid="permanent" — its closest data-layout-id
    // ancestor is the motion.div.
    const button = screen.getByTestId('permanent');
    const motionWrapper = button.closest('[data-layout-id]');
    expect(motionWrapper).not.toBeNull();
    expect(motionWrapper).toHaveAttribute('data-layout-id', stableId);
  });

  it('stack entries render a layoutId data attribute matching their cardId', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const stableId = '99999999-9999-9999-9999-999999999999';
    // Spell.id ≠ Card.id upstream — the wire's `id` for a stack
    // entry is the Spell UUID; `cardId` is the underlying Card's
    // UUID and matches the resolved permanent's id. Here we use
    // distinct values to mirror the real protocol, and assert the
    // motion-wrapper carries cardId (not id).
    const spell = webCardViewSchema.parse({
      ...FOREST,
      id: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      cardId: stableId,
      name: 'Lightning Bolt',
      manaCost: '{R}',
      typeLine: 'Instant',
      types: ['INSTANT'],
      subtypes: [],
    });
    gv.stack = { [spell.id]: spell };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const entry = screen.getByTestId('stack-entry');
    const motionWrapper = entry.closest('[data-layout-id]');
    expect(motionWrapper).not.toBeNull();
    expect(motionWrapper).toHaveAttribute('data-layout-id', stableId);
  });

  it('omits the layoutId data attribute when cardId is empty', () => {
    // Slice 52b defaults missing cardId to ''. Animation layer
    // treats '' as "do not animate" — passing '' as layoutId would
    // collide every "missing" card into one shared id. The
    // motion.div for an empty cardId should have no
    // data-layout-id attribute (it's set to undefined when empty).
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    // The default fixture's TAPPED_FOREST_PERMANENT was built
    // before slice 52a, so its `cardId` parses to '' via the
    // schema default. That's exactly the empty-string path we
    // want to exercise.
    act(() => {
      useGameStore.setState({
        connection: 'open',
        gameView: buildGameView(),
      });
    });
    const button = screen.getByTestId('permanent');
    // The motion.div sits as an ancestor of the permanent button.
    // With layoutId === undefined, React emits no data-layout-id
    // attribute, so closest('[data-layout-id]') must return null
    // (no animated wrapper participates in the layoutId graph).
    const wrapper = button.closest('[data-layout-id]');
    expect(wrapper).toBeNull();
  });

  it('hand cards render a layoutId data attribute matching their cardId', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    const gv = buildGameView();
    const stableId = 'cccccccc-1111-1111-1111-cccccccccccc';
    const handCard = webCardViewSchema.parse({
      ...FOREST,
      id: stableId,
      cardId: stableId,
      name: 'Hand Forest',
    });
    gv.myHand = { [stableId]: handCard };
    act(() => {
      useGameStore.setState({ connection: 'open', gameView: gv });
    });
    const handButton = screen.getByTestId('hand-card');
    // The HandCardSlot puts the motion.div INSIDE the button
    // (around HandCardFace), so the data-layout-id sits beneath
    // the button. Use querySelector rather than closest().
    const inner = handButton.querySelector('[data-layout-id]');
    expect(inner).not.toBeNull();
    expect(inner).toHaveAttribute('data-layout-id', stableId);
  });
});
