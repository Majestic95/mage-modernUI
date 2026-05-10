import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  webCardViewSchema,
  webCombatGroupViewSchema,
  webGameViewSchema,
  webPermanentViewSchema,
  webPlayerViewSchema,
  type WebCardView,
  type WebPermanentView,
} from '../api/schemas';
import { useGameStore } from './store';
import { DefenderBeams } from './DefenderBeams';

const ME_ID = '11111111-1111-1111-1111-111111111111';
const OPP1_ID = '22222222-2222-2222-2222-222222222222';
const OPP2_ID = '33333333-3333-3333-3333-333333333333';
const OPP3_ID = '44444444-4444-4444-4444-444444444444';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  readonly observed = new Set<Element>();
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }
  observe = (target: Element) => {
    this.observed.add(target);
  };
  unobserve = (target: Element) => {
    this.observed.delete(target);
  };
  disconnect = () => {
    this.observed.clear();
  };
  fire = () => {
    this.callback([], this as unknown as ResizeObserver);
  };
}

const originalResizeObserver = globalThis.ResizeObserver;
// Slice 1-X.3 critic-pass (BH-1) — capture the original viewport
// dimensions so afterEach can restore them. Without this, the
// 2560x1440 pin we set in beforeEach leaks into any subsequent
// test in the same Vitest worker if the project ever flips
// `pool.threads.isolate` to false. Defensive symmetry with the
// existing `originalResizeObserver` capture.
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

function makeCard(id: string): WebCardView {
  return webCardViewSchema.parse({
    id,
    cardId: id,
    name: 'Test',
    displayName: 'Test',
    expansionSetCode: 'TST',
    cardNumber: '001',
    manaCost: '{1}{G}',
    manaValue: 2,
    typeLine: 'Creature — Beast',
    supertypes: [],
    types: ['CREATURE'],
    subtypes: ['BEAST'],
    colors: ['G'],
    rarity: 'COMMON',
    power: '2',
    toughness: '2',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

function makePerm(card: WebCardView): WebPermanentView {
  return webPermanentViewSchema.parse({
    card,
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
}

function basePlayer(playerId: string, colorIdentity: readonly string[]) {
  return webPlayerViewSchema.parse({
    playerId,
    name: playerId.slice(0, 4),
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 53,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: {
      red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0,
    },
    controlled: true,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    colorIdentity,
  });
}

interface CombatFixture {
  defenderId: string;
  attackerIds: readonly string[];
}

function setGameView(opts: {
  phase: string;
  combat: readonly CombatFixture[];
  players?: ReturnType<typeof basePlayer>[];
}) {
  const players =
    opts.players ?? [
      basePlayer(ME_ID, []),
      basePlayer(OPP1_ID, ['G']),
      basePlayer(OPP2_ID, ['U']),
      basePlayer(OPP3_ID, ['B', 'R']),
    ];
  const combat = opts.combat.map((c) =>
    webCombatGroupViewSchema.parse({
      defenderId: c.defenderId,
      defenderName: 'opp',
      attackers: Object.fromEntries(
        c.attackerIds.map((id) => [id, makePerm(makeCard(id))]),
      ),
      blockers: {},
      blocked: false,
    }),
  );
  const gameView = webGameViewSchema.parse({
    turn: 1,
    phase: opts.phase,
    step: opts.phase,
    activePlayerName: 'me',
    priorityPlayerName: 'me',
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: ME_ID,
    myHand: {},
    stack: {},
    combat,
    players,
  });
  useGameStore.setState({ gameView });
}

function mountPortrait(playerId: string, rect: { x: number; y: number; w: number; h: number }) {
  const node = document.createElement('div');
  node.setAttribute('data-portrait-target-player-id', playerId);
  Object.defineProperty(node, 'getBoundingClientRect', {
    value: () =>
      ({
        x: rect.x,
        y: rect.y,
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.w,
        bottom: rect.y + rect.h,
        width: rect.w,
        height: rect.h,
        toJSON: () => ({}),
      }) as DOMRect,
    configurable: true,
  });
  document.body.appendChild(node);
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverMock.instances = [];
  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
  // jsdom default viewport — pin to 1440p target so test geometry
  // matches the design-time tuning.
  Object.defineProperty(window, 'innerWidth', {
    value: 2560, configurable: true, writable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: 1440, configurable: true, writable: true,
  });
  useGameStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.ResizeObserver = originalResizeObserver;
  // Slice 1-X.3 critic-pass (BH-1) — restore the original viewport.
  Object.defineProperty(window, 'innerWidth', {
    value: originalInnerWidth, configurable: true, writable: true,
  });
  Object.defineProperty(window, 'innerHeight', {
    value: originalInnerHeight, configurable: true, writable: true,
  });
  document.body.innerHTML = '';
  useGameStore.getState().reset();
});

describe('DefenderBeams — render gates', () => {
  it('renders nothing when phase is not COMBAT', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'PRECOMBAT_MAIN',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no combat groups exist', () => {
    setGameView({ phase: 'COMBAT', combat: [] });
    const { container } = render(<DefenderBeams />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for combat groups with zero attackers', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: [] }],
    });
    const { container } = render(<DefenderBeams />);
    expect(container.firstChild).toBeNull();
  });

  it('suppresses the local player even if they appear as a defender', () => {
    mountPortrait(ME_ID, { x: 1280, y: 1300, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: ME_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    // Either nothing rendered, OR the wrapper rendered with no
    // beam children (depending on selector behavior). Either is
    // acceptable; assert no per-defender beam div exists.
    expect(
      container.querySelectorAll('[data-testid^="defender-beam-"]').length,
    ).toBe(0);
  });
});

describe('DefenderBeams — beam geometry + color', () => {
  it('renders one beam per active defender', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    mountPortrait(OPP2_ID, { x: 100, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [
        { defenderId: OPP1_ID, attackerIds: ['a-1'] },
        { defenderId: OPP2_ID, attackerIds: ['a-2'] },
      ],
    });
    const { container } = render(<DefenderBeams />);
    const beams = container.querySelectorAll(
      '[data-testid^="defender-beam-"]',
    );
    expect(beams.length).toBe(2);
    expect(
      container.querySelector(`[data-testid="defender-beam-${OPP1_ID}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`[data-testid="defender-beam-${OPP2_ID}"]`),
    ).not.toBeNull();
  });

  it('beam color reflects the defender\'s first commander color (alpha-reduced -glow token)', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    const beam = container.querySelector(
      `[data-testid="defender-beam-${OPP1_ID}"]`,
    );
    // OPP1 is mono-G in the default fixture players. Critic-pass
    // UC-N1 swapped to the alpha-reduced -glow variant so the beam
    // doesn't oversaturate against tabletop's existing -glow zone
    // backgrounds when both happen to be the same color.
    expect(beam?.getAttribute('style') ?? '').toContain(
      'var(--color-mana-green-glow)',
    );
  });

  it('multicolor identity uses the first color (documented simplification)', () => {
    mountPortrait(OPP3_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP3_ID, attackerIds: ['a-3'] }],
    });
    const { container } = render(<DefenderBeams />);
    const beam = container.querySelector(
      `[data-testid="defender-beam-${OPP3_ID}"]`,
    );
    // OPP3 is BR; first color is B (black). Beam uses the -glow
    // variant per critic-pass UC-N1.
    expect(beam?.getAttribute('style') ?? '').toContain(
      'var(--color-mana-black-glow)',
    );
  });

  it('colorless commander → --color-mana-colorless-glow (silver-grey) fallback', () => {
    // Brief: colorless commanders (Karn, Kozilek) get a wash. Slice
    // 1-X.3 critic-pass (Bundle-1 UI-2): switched from
    // var(--color-targeting-arrow) (cream/teal) to
    // var(--color-mana-colorless-glow) (silver-grey, alpha 0.45)
    // because the cream wash compounded against tabletop's
    // --tabletop-zone-colorless ivory+gold zone tint — the same
    // family of saturation collision UC-N1 was meant to prevent
    // for colored commanders.
    const colorlessOpp = OPP1_ID;
    mountPortrait(colorlessOpp, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: colorlessOpp, attackerIds: ['a-x'] }],
      players: [
        basePlayer(ME_ID, []),
        basePlayer(colorlessOpp, []), // colorless commander
      ],
    });
    const { container } = render(<DefenderBeams />);
    const beam = container.querySelector(
      `[data-testid="defender-beam-${colorlessOpp}"]`,
    );
    expect(beam?.getAttribute('style') ?? '').toContain(
      'var(--color-mana-colorless-glow)',
    );
  });

  it('beam carries the BEAM_OPACITY = 0.18 inline opacity (regression guard)', () => {
    // Critic-pass UC-N7 — opacity is a tuning knob with a worst-case
    // stack budget; pin the value so accidental tweaks surface in
    // diff review.
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    const beam = container.querySelector(
      `[data-testid="defender-beam-${OPP1_ID}"]`,
    );
    // Slice 1-X-tunings round 2 (live-test verdict 2026-05-09):
    // bumped BEAM_OPACITY 0.234 → 0.468 (doubled) because the
    // tighter π/24 cone covers less area and the colored beam
    // needed to register against the dark battlefield + glow zones.
    expect(beam?.getAttribute('style') ?? '').toContain('opacity: 0.468');
  });

  it('clip-path geometry aims the cone toward the defender (right-side opp → positive aim X)', () => {
    // 1440p viewport center: (1280, 720). OPP1 portrait center:
    // (2430, 630). Aim vector: (+1150, -90) → pointing up-right.
    // The clip-path's two outer corners should both have x > viewport
    // center (the cone opens to the right).
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    const beam = container.querySelector(
      `[data-testid="defender-beam-${OPP1_ID}"]`,
    );
    const style = beam?.getAttribute('style') ?? '';
    // clip-path: polygon(<cx>px <cy>px, <leftX>px <leftY>px, <rightX>px <rightY>px)
    const match = style.match(
      /clip-path:\s*polygon\(([^)]+)\)/,
    );
    expect(match).not.toBeNull();
    const points = match![1]!.split(',').map((p) => p.trim());
    expect(points.length).toBe(3);
    // First point (apex) is viewport center.
    expect(points[0]).toMatch(/^1280(\.0)?px 720(\.0)?px$/);
    // Other two points have x > 1280 (cone opens rightward toward
    // the right-side defender).
    const parsePoint = (s: string) => {
      const m = s.match(/^(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px$/);
      return m ? { x: parseFloat(m[1]!), y: parseFloat(m[2]!) } : null;
    };
    const left = parsePoint(points[1]!);
    const right = parsePoint(points[2]!);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    // For an aim pointing right + slightly up, the cone's outer corners
    // should both have x > 1280. (Depending on which corner is "left"
    // vs "right" of the aim, both still have positive x relative to
    // center.)
    expect(left!.x).toBeGreaterThan(1280);
    expect(right!.x).toBeGreaterThan(1280);
  });
});

describe('DefenderBeams — viewport overlay positioning (T1, T2)', () => {
  it('outer container is position: fixed with pointer-events: none', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    const wrapper = container.querySelector('[data-testid="defender-beams"]');
    const style = wrapper?.getAttribute('style') ?? '';
    expect(style).toContain('position: fixed');
    expect(style).toContain('pointer-events: none');
  });

  it('per-beam children inherit pointer-events: none (clicks pass through)', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { container } = render(<DefenderBeams />);
    const beam = container.querySelector(
      `[data-testid="defender-beam-${OPP1_ID}"]`,
    );
    expect(beam?.getAttribute('style') ?? '').toContain(
      'pointer-events: none',
    );
  });
});

describe('DefenderBeams — geometry remeasure', () => {
  it('observes portrait nodes via ResizeObserver and remeasures on change', async () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    render(<DefenderBeams />);
    const observer = ResizeObserverMock.instances[0];
    expect(observer).toBeDefined();
    expect(observer!.observed.has(document.body)).toBe(true);
    // Beam observed its portrait node too.
    const portraitNode = document.querySelector(
      `[data-portrait-target-player-id="${OPP1_ID}"]`,
    );
    expect(portraitNode).not.toBeNull();
    expect(observer!.observed.has(portraitNode!)).toBe(true);
  });

  it('cancels queued measurement after unmount (no test-runner crash)', () => {
    mountPortrait(OPP1_ID, { x: 2400, y: 600, w: 60, h: 60 });
    setGameView({
      phase: 'COMBAT',
      combat: [{ defenderId: OPP1_ID, attackerIds: ['a-1'] }],
    });
    const { unmount } = render(<DefenderBeams />);
    document.dispatchEvent(new Event('scroll', { bubbles: false }));
    unmount();
    expect(() => act(() => vi.runOnlyPendingTimers())).not.toThrow();
  });
});
