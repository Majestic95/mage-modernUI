/**
 * Slice 70-Z.3 — CardAnimationLayer integration tests. Emits
 * synthetic events through the bus (skipping the diff path) and
 * asserts overlays mount, render with the right testids, and
 * unmount on time. Reduced-motion fixtures lock the contract that
 * cinematic + commander-return overlays do NOT mount under
 * `prefers-reduced-motion: reduce`.
 *
 * <p>The layer's internal state (active cinematic / active returns)
 * is module-singleton via `animationState`; tests reset between
 * cases to prevent leakage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { CardAnimationLayer } from './CardAnimationLayer';
import { emit, __resetForTests as resetBus } from './eventBus';
import { __resetForTests as resetAnimState } from './animationState';
import { CINEMATIC_HOLD_MS, COMMANDER_RETURN_MS } from './transitions';
import { useGameStore } from '../game/store';
import {
  webCardViewSchema,
  webGameViewSchema,
  webPlayerViewSchema,
  type WebCardView,
  type WebGameView,
} from '../api/schemas';

// ----- fixture builders ---------------------------------------------------

const COMMANDER_NAME = 'Atraxa, Praetors\' Voice';

function makeCard(
  cardId: string,
  name: string,
  types: string[] = ['CREATURE'],
): WebCardView {
  return webCardViewSchema.parse({
    id: cardId,
    cardId,
    name,
    displayName: name,
    expansionSetCode: 'TST',
    cardNumber: '1',
    manaCost: '',
    manaValue: 4,
    typeLine: types.join(' '),
    supertypes: [],
    types,
    subtypes: [],
    colors: ['B'],
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
}

function makeGameView(stackCard: WebCardView | null): WebGameView {
  const stack: Record<string, WebCardView> = {};
  if (stackCard) stack[stackCard.id] = stackCard;
  return webGameViewSchema.parse({
    turn: 1,
    phase: 'MAIN',
    step: 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: 'alice',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: 'pid-0',
    myHand: {},
    stack,
    combat: [],
    players: [
      webPlayerViewSchema.parse({
        playerId: 'pid-0',
        name: 'alice',
        life: 40,
        wins: 0,
        winsNeeded: 1,
        libraryCount: 60,
        handCount: 7,
        graveyard: {},
        exile: {},
        sideboard: {},
        battlefield: {},
        manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
        controlled: true,
        isHuman: true,
        isActive: true,
        hasPriority: true,
        hasLeft: false,
        monarch: false,
        initiative: false,
        designationNames: [],
        commandList: [
          {
            id: 'cmd-pid-0',
            kind: 'commander',
            name: COMMANDER_NAME,
            expansionSetCode: 'TST',
            imageFileName: '',
            imageNumber: 0,
            rules: ['Counters matter'],
          },
        ],
      }),
    ],
  });
}

function renderLayer() {
  return render(
    <MotionConfig reducedMotion="never">
      <LayoutGroup>
        <CardAnimationLayer />
      </LayoutGroup>
    </MotionConfig>,
  );
}

// ----- setup --------------------------------------------------------------

let originalMatchMedia: typeof window.matchMedia;

beforeEach(() => {
  resetBus();
  resetAnimState();
  // Default: prefers-reduced-motion off. Individual tests override.
  originalMatchMedia = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
  // Reset module-level reduced-motion cache so each test re-reads
  // matchMedia. The cache lives in CardAnimationLayer.tsx; we
  // can't directly clear it from outside, but the only writer is
  // `prefersReducedMotion()` on first call, and the layer reads
  // matchMedia FRESH per test render only if we forcibly clear it
  // — which we do by stubbing matchMedia BEFORE renderLayer().
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  resetBus();
  resetAnimState();
  window.matchMedia = originalMatchMedia;
  useGameStore.getState().reset();
});

// ----- tests --------------------------------------------------------------

describe('CardAnimationLayer — empty state', () => {
  it('renders the layer testid with no overlays initially', () => {
    renderLayer();
    expect(screen.getByTestId('card-animation-layer')).toBeInTheDocument();
    expect(screen.queryByTestId('casting-pose-overlay')).toBeNull();
    expect(screen.queryByTestId('ribbon-trail')).toBeNull();
    expect(screen.queryByTestId('commander-return-glide')).toBeNull();
  });
});

describe('CardAnimationLayer — cinematic cast', () => {
  it('mounts the casting-pose-overlay AND ribbon-trail when a cinematic cast event fires', () => {
    const card = makeCard('card-1', 'Test Commander', ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    // Synthesize the source DOM (my-hand) and the focal zone target
    // so the resolvers return concrete bboxes — without them the
    // ribbon component returns null per its graceful-degradation
    // contract.
    const myHand = document.createElement('div');
    myHand.setAttribute('data-testid', 'my-hand');
    myHand.getBoundingClientRect = () =>
      ({ left: 100, top: 800, width: 600, height: 200, right: 700, bottom: 1000, x: 100, y: 800, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(myHand);
    const focal = document.createElement('div');
    focal.setAttribute('data-testid', 'central-focal-zone');
    focal.getBoundingClientRect = () =>
      ({ left: 700, top: 400, width: 200, height: 280, right: 900, bottom: 680, x: 700, y: 400, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(focal);

    renderLayer();
    act(() => {
      emit({
        kind: 'cast',
        cardId: card.cardId,
        cinematic: true,
        colors: card.colors,
        from: 'hand',
        ownerSeat: 0,
      });
    });
    expect(screen.getByTestId('casting-pose-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-trail')).toBeInTheDocument();

    document.body.removeChild(myHand);
    document.body.removeChild(focal);
  });

  it('does NOT mount the overlay for a non-cinematic cast', () => {
    const card = makeCard('card-2', 'Lightning Bolt', ['INSTANT']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    renderLayer();
    act(() => {
      emit({
        kind: 'cast',
        cardId: card.cardId,
        cinematic: false,
        colors: card.colors,
        from: 'hand',
        ownerSeat: 0,
      });
    });
    expect(screen.queryByTestId('casting-pose-overlay')).toBeNull();
    expect(screen.queryByTestId('ribbon-trail')).toBeNull();
  });

  it('unmounts the casting-pose-overlay after CINEMATIC_HOLD_MS', () => {
    const card = makeCard('card-3', 'Big Spell', ['SORCERY']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    renderLayer();
    act(() => {
      emit({
        kind: 'cast',
        cardId: card.cardId,
        cinematic: true,
        colors: card.colors,
        from: 'hand',
        ownerSeat: 0,
      });
    });
    expect(screen.getByTestId('casting-pose-overlay')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(CINEMATIC_HOLD_MS + 50);
    });
    expect(screen.queryByTestId('casting-pose-overlay')).toBeNull();
  });
});

describe('CardAnimationLayer — reduced motion', () => {
  it('does NOT mount the cinematic overlay when prefers-reduced-motion is set', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
    const card = makeCard('card-4', 'Rapid Hybridization', ['INSTANT']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    renderLayer();
    act(() => {
      emit({
        kind: 'cast',
        cardId: card.cardId,
        cinematic: true,
        colors: card.colors,
        from: 'hand',
        ownerSeat: 0,
      });
    });
    expect(screen.queryByTestId('casting-pose-overlay')).toBeNull();
    expect(screen.queryByTestId('ribbon-trail')).toBeNull();
  });
});

describe('CardAnimationLayer — impact tier (slice 70-Z.4)', () => {
  function injectTile(cardId: string): HTMLElement {
    const tile = document.createElement('div');
    tile.setAttribute('data-card-id', cardId);
    tile.getBoundingClientRect = () =>
      ({ left: 200, top: 300, width: 80, height: 112, right: 280, bottom: 412, x: 200, y: 300, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(tile);
    return tile;
  }

  it('mounts tile-dust-overlay when creature_died fires for a tile in the DOM', () => {
    const card = makeCard('card-died', 'Bear Cub', ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    const tile = injectTile(card.cardId);
    renderLayer();
    act(() => {
      emit({ kind: 'creature_died', cardId: card.cardId, ownerSeat: 0 });
    });
    expect(screen.getByTestId('tile-dust-overlay')).toBeInTheDocument();
    document.body.removeChild(tile);
  });

  it('mounts tile-exile-overlay when permanent_exiled fires', () => {
    const card = makeCard('card-exiled', 'Sol Ring', ['ARTIFACT']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    const tile = injectTile(card.cardId);
    renderLayer();
    act(() => {
      emit({ kind: 'permanent_exiled', cardId: card.cardId, ownerSeat: 0 });
    });
    expect(screen.getByTestId('tile-exile-overlay')).toBeInTheDocument();
    document.body.removeChild(tile);
  });

  it('mounts board-wipe-ripple on board_wipe events', () => {
    const card = makeCard('card-wipe', 'Bear', ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    // Inject a portrait element so resolvePortraitCenter finds it.
    const portrait = document.createElement('div');
    portrait.setAttribute('data-portrait-target-player-id', 'pid-0');
    portrait.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(portrait);

    renderLayer();
    act(() => {
      emit({
        kind: 'board_wipe',
        cardIds: ['c1', 'c2', 'c3'],
        epicenterSeat: 0,
      });
    });
    expect(screen.getByTestId('board-wipe-ripple')).toBeInTheDocument();
    document.body.removeChild(portrait);
  });

  it('does NOT mount impact overlays when prefers-reduced-motion is set', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as typeof window.matchMedia;
    const card = makeCard('card-reduced', 'Bear', ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    const tile = injectTile(card.cardId);
    renderLayer();
    act(() => {
      emit({ kind: 'creature_died', cardId: card.cardId, ownerSeat: 0 });
    });
    expect(screen.queryByTestId('tile-dust-overlay')).toBeNull();
    expect(screen.queryByTestId('board-wipe-ripple')).toBeNull();
    document.body.removeChild(tile);
  });
});

describe('CardAnimationLayer — commander_returned', () => {
  it('does NOT mount the glide if no portrait DOM element matches the playerId', () => {
    // jsdom won't have a real PlayerPortrait mounted in this isolated
    // test — verify the layer degrades gracefully when the target
    // bbox can't be resolved.
    const card = makeCard('card-5', COMMANDER_NAME, ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    renderLayer();
    act(() => {
      emit({
        kind: 'commander_returned',
        cardId: card.cardId,
        ownerSeat: 0,
      });
    });
    expect(screen.queryByTestId('commander-return-glide')).toBeNull();
  });

  it('mounts the glide when a portrait element is present', () => {
    const card = makeCard('card-6', COMMANDER_NAME, ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    // Inject a synthetic portrait element so resolveCommanderReturnTarget
    // can find it. The selector matches what PlayerPortrait emits.
    const portrait = document.createElement('div');
    portrait.setAttribute('data-portrait-target-player-id', 'pid-0');
    portrait.style.width = '96px';
    portrait.style.height = '96px';
    portrait.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 96, height: 96, right: 196, bottom: 196, x: 100, y: 100, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(portrait);

    renderLayer();
    act(() => {
      emit({
        kind: 'commander_returned',
        cardId: card.cardId,
        ownerSeat: 0,
      });
    });
    expect(screen.getByTestId('commander-return-glide')).toBeInTheDocument();
    document.body.removeChild(portrait);
  });

  it('unmounts the glide after COMMANDER_RETURN_MS', () => {
    const card = makeCard('card-7', COMMANDER_NAME, ['CREATURE']);
    act(() => {
      useGameStore.setState({ gameView: makeGameView(card) });
    });
    const portrait = document.createElement('div');
    portrait.setAttribute('data-portrait-target-player-id', 'pid-0');
    portrait.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 96, height: 96, right: 96, bottom: 96, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(portrait);

    renderLayer();
    act(() => {
      emit({
        kind: 'commander_returned',
        cardId: card.cardId,
        ownerSeat: 0,
      });
    });
    expect(screen.getByTestId('commander-return-glide')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(COMMANDER_RETURN_MS + 50);
    });
    expect(screen.queryByTestId('commander-return-glide')).toBeNull();
    document.body.removeChild(portrait);
  });
});
