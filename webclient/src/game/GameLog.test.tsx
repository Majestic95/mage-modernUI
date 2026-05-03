/**
 * Slice 70-L — GameLog test coverage. The component existed since
 * slice 18 but had no dedicated test file; the redesign push is
 * the right moment to add one since it ships a meaningful new
 * branch (avatar + actor resolution).
 *
 * <p>Pattern mirrors PlayerFrame.test.tsx — flag-mock at the file
 * level so legacy + redesign paths both verify in one file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GameLogEntry } from './store';
import {
  webCardViewSchema,
  webPlayerViewSchema,
  type WebCardView,
  type WebCommandObjectView,
  type WebPlayerView,
} from '../api/schemas';

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

// Mock the Zustand store so tests can supply their own gameLog +
// gameView snapshots. Pattern mirrors how the store is consumed
// elsewhere — the tests don't need to construct a full store.
const storeState = vi.hoisted(() => ({
  gameLog: [] as GameLogEntry[],
  gameView: null as { myPlayerId: string } | null,
}));
vi.mock('./store', async () => {
  const actual =
    await vi.importActual<typeof import('./store')>('./store');
  return {
    ...actual,
    useGameStore: <T,>(selector: (s: typeof storeState) => T) =>
      selector(storeState),
  };
});

import { GameLog } from './GameLog';

function makeCommander(
  overrides: Partial<WebCommandObjectView> = {},
): WebCommandObjectView {
  return {
    id: 'cmdr-1',
    kind: 'commander',
    name: 'Atraxa, Praetors\' Voice',
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
    playerId: 'player-1',
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
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    commandList: [makeCommander()],
    colorIdentity: ['W', 'U', 'B', 'G'],
    connectionState: 'connected',
    ...overrides,
  });
}

function makeEntry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    id: 1,
    message: 'alice plays Forest',
    turn: 1,
    phase: 'PRECOMBAT_MAIN',
    cardsByName: {},
    ...overrides,
  };
}

function makeCard(name: string, overrides: Partial<WebCardView> = {}): WebCardView {
  return webCardViewSchema.parse({
    id: `card-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    displayName: name,
    expansionSetCode: 'M21',
    cardNumber: '1',
    manaCost: '',
    manaValue: 0,
    typeLine: 'Land',
    supertypes: [],
    types: ['LAND'],
    subtypes: [],
    colors: [],
    rarity: 'common',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
    ...overrides,
  });
}

afterEach(() => {
  flagState.redesign = false;
  storeState.gameLog = [];
  storeState.gameView = null;
});

describe('GameLog — legacy (REDESIGN=false)', () => {
  it('renders empty state when no entries', () => {
    storeState.gameLog = [];
    render(<GameLog />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });

  it('does NOT render a T<turn>·<phase> prefix (2026-05-03 directive)', () => {
    storeState.gameLog = [
      makeEntry({ turn: 3, phase: 'PRECOMBAT_MAIN' }),
    ];
    render(<GameLog />);
    expect(screen.queryByText(/T3·PREC/)).toBeNull();
  });

  it('renders the highlighted card name with the upstream color', () => {
    storeState.gameLog = [
      makeEntry({
        message: 'alice plays <font color=#ffff00>Blood Crypt</font>',
      }),
    ];
    render(<GameLog />);
    const entry = screen.getByTestId('game-log-entry');
    expect(entry).toHaveTextContent(/alice plays.*Blood Crypt/);
  });

  it('header shows entry count', () => {
    storeState.gameLog = [
      makeEntry({ id: 1 }),
      makeEntry({ id: 2 }),
      makeEntry({ id: 3 }),
    ];
    render(<GameLog />);
    expect(screen.getByText(/Game log \(3\)/)).toBeInTheDocument();
  });
});

describe('GameLog — REDESIGN flag on (slice 70-L)', () => {
  it('renders the empty state the same way', () => {
    flagState.redesign = true;
    storeState.gameLog = [];
    render(<GameLog />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });

  it('resolves the actor via players prop and renders a portrait avatar', () => {
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({ message: 'alice plays Forest' }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    const entry = screen.getByTestId('game-log-entry');
    expect(entry).toHaveAttribute('data-redesign', 'true');
    // PlayerPortrait rendered (commander art available in fixture)
    expect(within(entry).getByTestId('player-portrait')).toBeInTheDocument();
  });

  it('strips the actor name from the action text once the avatar takes over', () => {
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({ message: 'alice plays Forest' }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    const entry = screen.getByTestId('game-log-entry');
    // Actor name appears as the heading, not in the action text.
    // Heading: "alice" (or "You" when local). Action: "plays Forest".
    const heading = within(entry).getByText('alice');
    expect(heading).toHaveClass(/font-semibold/);
    // Verify the action body has the trimmed text — "plays Forest"
    // alongside the turn-phase prefix.
    expect(entry).toHaveTextContent(/plays Forest/);
  });

  it('uses "You" when the actor is the local player', () => {
    // Picture-catalog §5.A: the local player's log entries read
    // "You cast The Locust God" rather than "alice cast ...".
    flagState.redesign = true;
    storeState.gameView = { myPlayerId: 'player-1' };
    storeState.gameLog = [
      makeEntry({ message: 'alice cast The Locust God' }),
    ];
    render(
      <GameLog
        players={[makePlayer({ playerId: 'player-1', name: 'alice' })]}
      />,
    );
    const entry = screen.getByTestId('game-log-entry');
    expect(within(entry).getByText('You')).toBeInTheDocument();
    expect(within(entry).queryByText('alice')).toBeNull();
  });

  it('preserves card-name highlights via renderUpstreamMarkup', () => {
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({
        message: 'alice plays <font color=#ffff00>Blood Crypt</font>',
      }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    const entry = screen.getByTestId('game-log-entry');
    // Card name renders as a styled span — find it by content.
    const cardName = within(entry).getByText('Blood Crypt');
    expect(cardName.tagName).toBe('SPAN');
    expect(cardName).toHaveStyle({ color: '#ffff00' });
  });

  it('renders a placeholder gutter when actor cannot be resolved', () => {
    // Engine emits messages without a player-name leading word
    // — e.g. event narration, system announcements. Layout
    // preserves the 32px gutter for vertical alignment.
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({ message: 'Bolt deals 3 to bob' }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    const entry = screen.getByTestId('game-log-entry');
    expect(within(entry).queryByTestId('player-portrait')).toBeNull();
    expect(
      within(entry).getByTestId('game-log-entry-no-avatar'),
    ).toBeInTheDocument();
  });

  it('matches actor with case-insensitivity', () => {
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({ message: 'Alice plays Forest' }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    const entry = screen.getByTestId('game-log-entry');
    expect(within(entry).getByTestId('player-portrait')).toBeInTheDocument();
  });

  it('resolves actor for possessive forms ("alice\'s turn")', () => {
    // Engine emits "alice's turn begins" — strip trailing
    // possessive when matching.
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({ message: "alice's turn begins" }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    const entry = screen.getByTestId('game-log-entry');
    expect(within(entry).getByTestId('player-portrait')).toBeInTheDocument();
  });

  it('falls back to no-portrait when players prop is empty', () => {
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({ message: 'alice plays Forest' }),
    ];
    render(<GameLog />);
    const entry = screen.getByTestId('game-log-entry');
    expect(within(entry).queryByTestId('player-portrait')).toBeNull();
  });

  it('does NOT render the T<turn>·<phase> prefix on redesigned entries', () => {
    flagState.redesign = true;
    storeState.gameLog = [
      makeEntry({
        turn: 5,
        phase: 'PRECOMBAT_MAIN',
        message: 'alice plays Forest',
      }),
    ];
    render(<GameLog players={[makePlayer({ name: 'alice' })]} />);
    expect(screen.queryByText(/T5·PREC/)).toBeNull();
  });
});

describe('GameLog — card-hover wrapping (2026-05-03)', () => {
  it('wraps highlighted card names that are present in cardsByName with a hover trigger', () => {
    storeState.gameLog = [
      makeEntry({
        message: 'alice plays <font color=#ffff00>Blood Crypt</font>',
        cardsByName: { 'blood crypt': makeCard('Blood Crypt') },
      }),
    ];
    render(<GameLog />);
    const hover = screen.getByTestId('game-log-card-hover');
    expect(hover.getAttribute('data-card-name')).toBe('Blood Crypt');
    expect(hover.className).toContain('cursor-help');
  });

  it('renders highlighted names without a hover wrapper when not in cardsByName', () => {
    storeState.gameLog = [
      makeEntry({
        message: 'alice plays <font color=#ffff00>Blood Crypt</font>',
        cardsByName: {},
      }),
    ];
    render(<GameLog />);
    expect(screen.queryByTestId('game-log-card-hover')).toBeNull();
    // Plain colored span still renders so the message reads.
    expect(screen.getByTestId('game-log-entry')).toHaveTextContent('Blood Crypt');
  });

  it('case-insensitively resolves card names to the cardsByName index', () => {
    storeState.gameLog = [
      makeEntry({
        message: 'alice plays <font color=#ffff00>BLOOD CRYPT</font>',
        cardsByName: { 'blood crypt': makeCard('Blood Crypt') },
      }),
    ];
    render(<GameLog />);
    expect(
      screen.getByTestId('game-log-card-hover').getAttribute('data-card-name'),
    ).toBe('Blood Crypt');
  });

  it('strips a trailing parenthesized disambiguator before lookup', () => {
    storeState.gameLog = [
      makeEntry({
        message: 'alice plays <font color=#ffff00>Forest (a)</font>',
        cardsByName: { forest: makeCard('Forest') },
      }),
    ];
    render(<GameLog />);
    expect(
      screen.getByTestId('game-log-card-hover').getAttribute('data-card-name'),
    ).toBe('Forest');
  });
});
