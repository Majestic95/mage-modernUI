import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Game } from './Game';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import {
  webCardViewSchema,
  webGameViewSchema,
  webPermanentViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';

const ANON_SESSION = {
  schemaVersion: '1.11',
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

  it('renders waiting state when no gameView is present', () => {
    render(<Game gameId={FAKE_GAME_ID} onLeave={() => {}} />);
    // Two "Connecting" matches exist (header dot label + centered
    // status); the centered message ends with the ellipsis char.
    expect(screen.getByText(/Connecting…/)).toBeInTheDocument();
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

  it('Leave button invokes onLeave', async () => {
    const onLeave = vi.fn();
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    render(<Game gameId={FAKE_GAME_ID} onLeave={onLeave} />);
    await user.click(screen.getByRole('button', { name: /leave/i }));
    expect(onLeave).toHaveBeenCalled();
  });
});
