/**
 * Slice 70-O — GameHeader REDESIGN branch coverage. Tests the
 * synthesizeLobbyName helper, the 4-icon strip, the side-panel
 * toggle, fullscreen wiring, and SettingsModal mount on gear click.
 *
 * <p>Flag-mock pattern mirrors GameLog.test.tsx — toggle
 * {@code flagState.redesign} per test to exercise both branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type WebCommandObjectView,
  type WebGameView,
  type WebPlayerView,
} from '../api/schemas';

const flagState = vi.hoisted(() => ({ redesign: false }));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
}));

import { GameHeader } from './GameHeader';
import { synthesizeLobbyName } from './lobbyName';
import { useGameStore } from './store';

function makeCommander(
  overrides: Partial<WebCommandObjectView> = {},
): WebCommandObjectView {
  return {
    id: 'cmdr-1',
    kind: 'commander',
    name: 'Atraxa',
    expansionSetCode: 'C16',
    imageFileName: 'atraxa.jpg',
    imageNumber: 28,
    rules: [],
    ...overrides,
  };
}

function makePlayer(
  overrides: Partial<WebPlayerView> = {},
): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId: '11111111-1111-1111-1111-111111111111',
    name: 'alice',
    life: 40,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 99,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    ...overrides,
  });
}

function makeGameView(playerCount: number, withCommander: boolean): WebGameView {
  const players: WebPlayerView[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push(
      makePlayer({
        playerId: `${i}1111111-1111-1111-1111-111111111111`,
        name: `player${i}`,
        commandList: withCommander ? [makeCommander({ id: `cmdr-${i}` })] : [],
      }),
    );
  }
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'player0',
    priorityPlayerName: 'player0',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameId: 'g1',
    gameCycle: 1,
    myPlayerId: players[0]!.playerId,
    myHand: {},
    stack: {},
    combat: [],
    players,
  });
}

afterEach(() => {
  flagState.redesign = false;
  // Reset side-panel state between tests so toggle assertions are
  // deterministic.
  act(() => {
    useGameStore.getState().setSidePanelCollapsed(false);
  });
});

// --- synthesizeLobbyName helper --------------------------------------

describe('synthesizeLobbyName (picture-catalog §1.2)', () => {
  it('returns "GAME" fallback when gameView is null', () => {
    expect(synthesizeLobbyName(null)).toBe('GAME');
  });

  it('4 commander players → "COMMANDER — 4 PLAYER FREE-FOR-ALL"', () => {
    expect(synthesizeLobbyName(makeGameView(4, true))).toBe(
      'COMMANDER — 4 PLAYER FREE-FOR-ALL',
    );
  });

  it('3 commander players → "COMMANDER — 3 PLAYER FREE-FOR-ALL"', () => {
    expect(synthesizeLobbyName(makeGameView(3, true))).toBe(
      'COMMANDER — 3 PLAYER FREE-FOR-ALL',
    );
  });

  it('2 commander players → "COMMANDER — 1V1"', () => {
    expect(synthesizeLobbyName(makeGameView(2, true))).toBe(
      'COMMANDER — 1V1',
    );
  });

  it('non-commander 4 players drops the prefix', () => {
    expect(synthesizeLobbyName(makeGameView(4, false))).toBe(
      '4 PLAYER FREE-FOR-ALL',
    );
  });

  it('non-commander 2 players → "1V1" without prefix', () => {
    expect(synthesizeLobbyName(makeGameView(2, false))).toBe('1V1');
  });

  it('empty players defensive: returns "GAME" fallback (Tech critic I-7)', () => {
    // Build directly — makeGameView's myPlayerId requires ≥1 player.
    const gv = webGameViewSchema.parse({
      turn: 1,
      phase: 'PRECOMBAT_MAIN',
      step: 'PRECOMBAT_MAIN',
      activePlayerName: '',
      priorityPlayerName: '',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameId: 'g1',
      gameCycle: 1,
      myPlayerId: '',
      myHand: {},
      stack: {},
      combat: [],
      players: [],
    });
    expect(synthesizeLobbyName(gv)).toBe('GAME');
  });
});

// --- REDESIGN header ---------------------------------------------------

describe('GameHeader — REDESIGN branch (picture-catalog §1)', () => {
  function renderHeader(
    gv: WebGameView | null,
    overrides: { onLeave?: () => void; stream?: null } = {},
  ) {
    flagState.redesign = true;
    return render(
      <GameHeader
        gameId="game-1"
        connection="open"
        closeReason=""
        gameView={gv}
        onLeave={overrides.onLeave ?? (() => {})}
        stream={overrides.stream ?? null}
      />,
    );
  }

  it('renders the synthesized lobby name on the left', () => {
    renderHeader(makeGameView(4, true));
    expect(screen.getByTestId('header-lobby-name')).toHaveTextContent(
      'COMMANDER — 4 PLAYER FREE-FOR-ALL',
    );
  });

  it('renders the 4-icon strip on the right (chat / layout / fullscreen / settings)', () => {
    renderHeader(makeGameView(2, true));
    expect(screen.getByTestId('header-icon-chat')).toBeInTheDocument();
    expect(screen.getByTestId('header-icon-layout')).toBeInTheDocument();
    expect(screen.getByTestId('header-icon-fullscreen')).toBeInTheDocument();
    expect(screen.getByTestId('header-icon-settings')).toBeInTheDocument();
  });

  it('drops the legacy gameId / turn pill / priority subtext / Leave / connection dot', () => {
    renderHeader(makeGameView(2, true));
    expect(screen.queryByTestId('turn-indicator')).toBeNull();
    expect(screen.queryByTestId('priority-indicator')).toBeNull();
    expect(screen.queryByText('game-1')).toBeNull();
    expect(screen.queryByText('Leave')).toBeNull();
  });

  it('layout/zoom icon toggles sidePanelCollapsed in the store', async () => {
    renderHeader(makeGameView(2, true));
    expect(useGameStore.getState().sidePanelCollapsed).toBe(false);
    await userEvent.click(screen.getByTestId('header-icon-layout'));
    expect(useGameStore.getState().sidePanelCollapsed).toBe(true);
    await userEvent.click(screen.getByTestId('header-icon-layout'));
    expect(useGameStore.getState().sidePanelCollapsed).toBe(false);
  });

  it('layout icon aria-pressed reflects collapsed state', async () => {
    renderHeader(makeGameView(2, true));
    const btn = screen.getByTestId('header-icon-layout');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('settings icon click mounts the SettingsModal', async () => {
    renderHeader(makeGameView(2, true));
    expect(screen.queryByTestId('settings-modal')).toBeNull();
    await userEvent.click(screen.getByTestId('header-icon-settings'));
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  });

  it('fullscreen icon click calls document.documentElement.requestFullscreen', async () => {
    const requestFullscreen = vi.fn();
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: requestFullscreen,
    });
    renderHeader(makeGameView(2, true));
    await userEvent.click(screen.getByTestId('header-icon-fullscreen'));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('chat icon is disabled until slice 70-R lights up the slide-out', () => {
    renderHeader(makeGameView(2, true));
    const chat = screen.getByTestId('header-icon-chat');
    expect(chat).toBeDisabled();
  });

  it('renders the lobby name as empty during Waiting (gameView=null)', () => {
    renderHeader(null);
    // No flash of bare "GAME" purple text — lobby name is empty
    // until the first gameView arrives.
    expect(screen.getByTestId('header-lobby-name').textContent).toBe('');
  });
});

// --- legacy header preserved -------------------------------------------

describe('GameHeader — legacy branch (slice 23 verbatim)', () => {
  it('renders the legacy gameId + turn pill + Leave when REDESIGN=false', () => {
    flagState.redesign = false;
    render(
      <GameHeader
        gameId="legacy-game"
        connection="open"
        closeReason=""
        gameView={makeGameView(2, false)}
        onLeave={() => {}}
      />,
    );
    expect(screen.getByText('legacy-game')).toBeInTheDocument();
    expect(screen.getByTestId('turn-indicator')).toBeInTheDocument();
    expect(screen.getByText('Leave')).toBeInTheDocument();
    // No redesigned strip in legacy mode.
    expect(screen.queryByTestId('header-lobby-name')).toBeNull();
  });
});
