import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  webGameViewSchema,
  webPlayerViewSchema,
  type WebGameView,
  type WebPlayerView,
} from '../api/schemas';

// Slice 70-L — flag-mock at file level. Existing 8 tests run
// against REDESIGN=false; new 2×2-grid tests flip the flag on.
const flagState = vi.hoisted(() => ({
  redesign: false,
  keepEliminated: true,
}));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
  get KEEP_ELIMINATED() {
    return flagState.keepEliminated;
  },
}));

import { CommanderDamageTracker } from './CommanderDamageTracker';

function makeOpponent(name: string, commanderName?: string): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId: `${name}-id`,
    name,
    life: 40,
    wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false, isHuman: true, isActive: false, hasPriority: false,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
    commandList: commanderName
      ? [
          {
            id: `${name}-cmdr-id`,
            kind: 'commander',
            name: commanderName,
            expansionSetCode: 'CMR',
            imageFileName: '',
            imageNumber: 0,
            rules: [],
          },
        ]
      : [],
  });
}

function makeGameView(opponents: WebPlayerView[]): WebGameView {
  const me = webPlayerViewSchema.parse({
    playerId: 'me-id',
    name: 'me',
    life: 40,
    wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'me',
    priorityPlayerName: 'me',
    special: false, rollbackTurnsAllowed: false,
    totalErrorsCount: 0, totalEffectsCount: 0, gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: {}, stack: {}, combat: [],
    players: [me, ...opponents],
  });
}

describe('CommanderDamageTracker', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('renders nothing when no opponent has a commander', () => {
    const opps = [makeOpponent('alice'), makeOpponent('bob')];
    const { container } = render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per opponent commander', () => {
    const opps = [
      makeOpponent('alice', 'Atraxa, Praetors’ Voice'),
      makeOpponent('bob', 'Edgar Markov'),
    ];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    expect(screen.getByTestId('commander-damage-tracker')).toBeInTheDocument();
    // One row per commander; the row's testid encodes (opponent, commander).
    expect(
      screen.getByTestId('cmdr-dmg-row-alice-id-alice-cmdr-id'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cmdr-dmg-row-bob-id-bob-cmdr-id'),
    ).toBeInTheDocument();
  });

  it('initial damage is 0 when no localStorage value exists', () => {
    const opps = [makeOpponent('alice', 'Atraxa')];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const value = screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id');
    expect(value.textContent).toBe('0');
  });

  it('persists damage to localStorage on adjust + reads on remount', async () => {
    const opps = [makeOpponent('alice', 'Atraxa')];
    const user = userEvent.setup();
    const { unmount } = render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );

    // Click + 3 times → 3 damage.
    const incrementBtn = screen.getByLabelText('Increment Atraxa damage to you');
    await user.click(incrementBtn);
    await user.click(incrementBtn);
    await user.click(incrementBtn);
    expect(
      screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id').textContent,
    ).toBe('3');

    // Storage should now have the value.
    expect(
      localStorage.getItem('mage-cmdr-dmg:g1:alice-id:alice-cmdr-id'),
    ).toBe('3');

    // Remount — fresh component instance reads the persisted value.
    unmount();
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    expect(
      screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id').textContent,
    ).toBe('3');
  });

  it('does not go below 0 on decrement', async () => {
    const opps = [makeOpponent('alice', 'Atraxa')];
    const user = userEvent.setup();
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const decrementBtn = screen.getByLabelText('Decrement Atraxa damage to you');
    await user.click(decrementBtn);
    await user.click(decrementBtn);
    expect(
      screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id').textContent,
    ).toBe('0');
  });

  it('flags lethal (≥21) damage with the danger token', async () => {
    // 21 commander damage from a single commander ends the game; row
    // tints red so the user notices.
    const opps = [makeOpponent('alice', 'Atraxa')];
    // Pre-seed storage so we don't have to click 21 times.
    localStorage.setItem('mage-cmdr-dmg:g1:alice-id:alice-cmdr-id', '21');
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const row = screen.getByTestId('cmdr-dmg-row-alice-id-alice-cmdr-id');
    expect(row.className).toContain('text-status-danger');
  });

  // Slice 70-G critic UX-3 — per-click flash feedback.
  it('flashes on each adjust click (rapid-logging affordance)', async () => {
    const opps = [makeOpponent('alice', 'Atraxa')];
    const user = userEvent.setup();
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const incrementBtn = screen.getByLabelText('Increment Atraxa damage to you');

    // Initial mount — no flash overlay yet (flashTrigger is 0).
    expect(
      screen.queryByTestId('cmdr-dmg-flash-alice-id-alice-cmdr-id'),
    ).toBeNull();

    // Click +1 → flash overlay mounts; rapid follow-up click
    // remounts the SAME overlay (same testid) which restarts the
    // keyframe from frame 0. The overlay being a sibling (not
    // wrapper) means the LifeCounter button reference stays valid.
    await user.click(incrementBtn);
    expect(
      screen.getByTestId('cmdr-dmg-flash-alice-id-alice-cmdr-id'),
    ).toBeInTheDocument();
    await user.click(incrementBtn);
    // Overlay still present; `key={flashTrigger}` bumped so it
    // remounted (animation replays).
    expect(
      screen.getByTestId('cmdr-dmg-flash-alice-id-alice-cmdr-id'),
    ).toBeInTheDocument();
    // Damage actually accrued (the bug this restructuring fixes).
    expect(
      screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id').textContent,
    ).toBe('2');
  });

  it('different gameId reads different storage (no cross-game leakage)', () => {
    localStorage.setItem('mage-cmdr-dmg:g1:alice-id:alice-cmdr-id', '15');
    localStorage.setItem('mage-cmdr-dmg:g2:alice-id:alice-cmdr-id', '0');
    const opps = [makeOpponent('alice', 'Atraxa')];

    const { unmount } = render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    expect(
      screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id').textContent,
    ).toBe('15');
    unmount();

    render(
      <CommanderDamageTracker
        gameId="g2"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    expect(
      screen.getByTestId('cmdr-dmg-value-alice-id-alice-cmdr-id').textContent,
    ).toBe('0');
  });
});

// Slice 70-L — REDESIGN flag tests for the 2×2 grid layout.
describe('CommanderDamageTracker — REDESIGN flag on (slice 70-L, picture-catalog §5.B)', () => {
  beforeEach(() => {
    flagState.redesign = true;
    localStorage.clear();
  });
  afterEach(() => {
    flagState.redesign = false;
  });

  it('renders cells (not rows) when redesign is on', () => {
    const opps = [
      makeOpponent('alice', 'Atraxa'),
      makeOpponent('bob', 'Korvold'),
      makeOpponent('carol', 'Meren'),
    ];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    // Redesign attribute on the section root.
    expect(
      screen.getByTestId('commander-damage-tracker'),
    ).toHaveAttribute('data-redesign', 'true');
    // Per-cell test ids exist for each opponent commander.
    expect(
      screen.getByTestId('cmdr-dmg-cell-alice-id-alice-cmdr-id'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cmdr-dmg-cell-bob-id-bob-cmdr-id'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('cmdr-dmg-cell-carol-id-carol-cmdr-id'),
    ).toBeInTheDocument();
  });

  it('each cell hosts a PlayerPortrait (small, no halo)', () => {
    const opps = [makeOpponent('alice', 'Atraxa')];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const cell = screen.getByTestId('cmdr-dmg-cell-alice-id-alice-cmdr-id');
    const portrait = within(cell).getByTestId('player-portrait');
    expect(portrait).toHaveAttribute('data-size', 'small');
    // Halo suppressed in commander-damage cells per picture-catalog
    // §5.B (the cell border + lethal ring is the visual signal,
    // not a per-cell halo).
    expect(within(cell).queryByTestId('player-portrait-halo')).toBeNull();
  });

  it('lethal damage threshold (≥21) flags data-lethal + ring', async () => {
    localStorage.setItem(
      'mage-cmdr-dmg:g1:alice-id:alice-cmdr-id',
      '21',
    );
    const opps = [makeOpponent('alice', 'Atraxa')];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const cell = screen.getByTestId(
      'cmdr-dmg-cell-alice-id-alice-cmdr-id',
    );
    expect(cell).toHaveAttribute('data-lethal', 'true');
  });

  it('+/- buttons still work in cells', async () => {
    const opps = [makeOpponent('alice', 'Atraxa')];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const value = screen.getByTestId(
      'cmdr-dmg-value-alice-id-alice-cmdr-id',
    );
    expect(value.textContent).toBe('0');
    const buttons = screen.getAllByLabelText(/Increment.*damage to you/);
    await userEvent.click(buttons[0]!);
    await userEvent.click(buttons[0]!);
    await userEvent.click(buttons[0]!);
    expect(value.textContent).toBe('3');
  });

  it('cell layout uses CSS Grid 2-cols', () => {
    const opps = [
      makeOpponent('alice', 'Atraxa'),
      makeOpponent('bob', 'Korvold'),
    ];
    render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    const tracker = screen.getByTestId('commander-damage-tracker');
    // The grid container is the only child div with grid-cols-2 class.
    const grid = tracker.querySelector('.grid.grid-cols-2');
    expect(grid).not.toBeNull();
  });

  it('hides entirely when no commander entries (non-Commander format)', () => {
    const opps = [makeOpponent('alice')]; // no commander
    const { container } = render(
      <CommanderDamageTracker
        gameId="g1"
        gameView={makeGameView(opps)}
        opponents={opps}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
