/**
 * CombatArrows — tests for endpoint-fan + hover-isolation
 * (extracted from StackZone.tsx, 2026-05-08).
 *
 * <p>Existing combat-mode behavior (count of arrows emitted, the
 * data-stack-mode attribute lifecycle, and the unblocked→portrait
 * vs blocked→tile target resolution) is exercised by the existing
 * StackZone.test.tsx combat-mode block. This file adds coverage for
 * the new behavior the slice introduces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import {
  webCardViewSchema,
  webCombatGroupViewSchema,
  webPermanentViewSchema,
  type WebCardView,
  type WebCombatGroupView,
  type WebPermanentView,
  type WebPlayerView,
} from '../api/schemas';
import { CombatArrows } from './CombatArrows';
import {
  resetCombatArrowsStaggered,
  useArrowIsolation,
} from './arrowIsolationStore';

/* =====================================================================
 * Slice 1-A — minimal player fixtures for defender-color tests. Tests
 * only need {playerId, colorIdentity} so we cast a partial; full
 * WebPlayerView fixtures would balloon every assertion. The cast is
 * safe because CombatArrows only reads those two fields off players.
 * =====================================================================*/
function makePlayers(
  list: { playerId: string; colorIdentity: readonly string[] }[],
): readonly WebPlayerView[] {
  return list as unknown as readonly WebPlayerView[];
}

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

function makeCard(overrides: Partial<WebCardView> = {}): WebCardView {
  return webCardViewSchema.parse({
    id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
    cardId: overrides.cardId ?? '22222222-2222-2222-2222-222222222222',
    name: 'Test Creature',
    displayName: 'Test Creature',
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
    ...overrides,
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

function makeCombatGroup(
  overrides: Partial<WebCombatGroupView>,
): WebCombatGroupView {
  return webCombatGroupViewSchema.parse({
    defenderId: '00000000-0000-0000-0000-000000000aaa',
    defenderName: 'bob',
    attackers: {},
    blockers: {},
    blocked: false,
    ...overrides,
  });
}

/**
 * Mounts a permanent DOM node at a fixed viewport rect so
 * getBoundingClientRect() returns deterministic coordinates in
 * jsdom (which would otherwise return all zeros).
 */
function mountPermanentNode(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
) {
  const node = document.createElement('div');
  node.setAttribute('data-permanent-id', id);
  let currentRect = rect;
  Object.defineProperty(node, 'getBoundingClientRect', {
    value: () =>
      ({
        x: currentRect.x,
        y: currentRect.y,
        left: currentRect.x,
        top: currentRect.y,
        right: currentRect.x + currentRect.w,
        bottom: currentRect.y + currentRect.h,
        width: currentRect.w,
        height: currentRect.h,
        toJSON: () => ({}),
      }) as DOMRect,
    configurable: true,
  });
  document.body.appendChild(node);
  return {
    node,
    setRect: (next: { x: number; y: number; w: number; h: number }) => {
      currentRect = next;
    },
  };
}

function mountPortraitNode(playerId: string, rect: { x: number; y: number; w: number; h: number }) {
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
  // Slice 1-B — clear any pin lingering from a prior test before
  // each render. The store is a module singleton; without this the
  // pin would leak across tests.
  useArrowIsolation.getState().clearPin();
  // Slice 1-C — reset the module-level stagger flag so each test
  // starts in "first-paint eligible" state. Production callers get
  // this for free via the phase watcher; tests need it explicit.
  resetCombatArrowsStaggered();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.ResizeObserver = originalResizeObserver;
  document.body.innerHTML = '';
  // Slice 1-B — extra safety: clear pin after each test so a
  // failure that didn't unmount cleanly doesn't poison the next.
  useArrowIsolation.getState().clearPin();
  resetCombatArrowsStaggered();
});

// --- Endpoint convergence (no-fan, 2026-05-10) ----------------------
//
// User direction: all damage arrows targeting the same defender's
// portrait converge to a single pixel — the portrait center. The
// earlier endpoint-fan that splayed shared-target arrows along the
// perpendicular has been removed. Multiple arrows now land on
// exactly the same point; their arrowheads paint over each other,
// reading as "this many attackers aimed at the same target."

describe('CombatArrows — endpoint convergence', () => {
  it('lands a single attacker→defender arrow on the portrait center', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    mountPermanentNode('att-1', { x: 100, y: 100, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1000, y: 100, w: 60, h: 60 });

    const attacker = makeCard({ id: 'att-1', cardId: 'att-1' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(attacker) },
    });
    const { container } = render(<CombatArrows combat={[group]} />);

    const paths = container.querySelectorAll('path[marker-end]');
    expect(paths.length).toBe(1);
    // Target = portrait center at (1030, 130).
    expect(paths[0]?.getAttribute('d')).toMatch(/Q .+ 1030 130$/);
  });

  it('all multi-attacker arrows converge on the SAME portrait pixel (no fan offset)', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    // 3 attackers spread horizontally — each has a distinct DOM tile,
    // so their sources differ. The targets must all collapse to the
    // single portrait center.
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-2', { x: 300, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-3', { x: 500, y: 200, w: 80, h: 112 });
    // One shared defender portrait — center at (1230, 130).
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });

    const a1 = makeCard({ id: 'att-1', cardId: 'att-1' });
    const a2 = makeCard({ id: 'att-2', cardId: 'att-2' });
    const a3 = makeCard({ id: 'att-3', cardId: 'att-3' });
    const group = makeCombatGroup({
      defenderId,
      attackers: {
        'att-1': makePerm(a1),
        'att-2': makePerm(a2),
        'att-3': makePerm(a3),
      },
    });
    const { container } = render(<CombatArrows combat={[group]} />);

    const paths = container.querySelectorAll('path[marker-end]');
    expect(paths.length).toBe(3);

    // Extract the target coordinate (last "x y" of each `d` attribute).
    const targets = Array.from(paths).map((p) => {
      const d = p.getAttribute('d') ?? '';
      const m = d.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
      return m ? { x: parseFloat(m[1]!), y: parseFloat(m[2]!) } : null;
    });

    // Every arrow lands on (1230, 130) — no fan offset applied.
    for (const t of targets) {
      expect(t?.x).toBe(1230);
      expect(t?.y).toBe(130);
    }
    // Sanity: all targets are exactly the same point.
    const distinct = new Set(targets.map((t) => JSON.stringify(t)));
    expect(distinct.size).toBe(1);
  });
});

// --- Dynamic geometry -------------------------------------------------

describe('CombatArrows — dynamic geometry', () => {
  it('remeasures attacker position when a nested scroll container scrolls', async () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    const attackerNode = mountPermanentNode('att-1', {
      x: 100,
      y: 300,
      w: 80,
      h: 112,
    });
    mountPortraitNode(defenderId, { x: 1000, y: 100, w: 60, h: 60 });

    const attacker = makeCard({ id: 'att-1', cardId: 'att-1' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(attacker) },
    });
    const { container } = render(<CombatArrows combat={[group]} />);

    const path = () => container.querySelector('path[marker-end]');
    expect(path()?.getAttribute('d')).toMatch(/^M 140 356 /);

    attackerNode.setRect({ x: 100, y: 180, w: 80, h: 112 });
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    scroller.dispatchEvent(new Event('scroll', { bubbles: false }));

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(path()?.getAttribute('d')).toMatch(/^M 140 236 /);
  });

  it('observes combat endpoint nodes and remeasures on resize observer callbacks', async () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    const attackerNode = mountPermanentNode('att-1', {
      x: 100,
      y: 300,
      w: 80,
      h: 112,
    });
    const portraitNode = mountPortraitNode(defenderId, {
      x: 1000,
      y: 100,
      w: 60,
      h: 60,
    });

    const attacker = makeCard({ id: 'att-1', cardId: 'att-1' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(attacker) },
    });
    const { container } = render(<CombatArrows combat={[group]} />);
    const observer = ResizeObserverMock.instances[0]!;
    expect(observer.observed.has(document.body)).toBe(true);
    expect(observer.observed.has(attackerNode.node)).toBe(true);
    expect(observer.observed.has(portraitNode)).toBe(true);

    const path = () => container.querySelector('path[marker-end]');
    expect(path()?.getAttribute('d')).toMatch(/^M 140 356 /);
    attackerNode.setRect({ x: 100, y: 180, w: 80, h: 112 });
    observer.fire();

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(path()?.getAttribute('d')).toMatch(/^M 140 236 /);
  });

  it('cancels a queued measurement after unmount', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    mountPermanentNode('att-1', { x: 100, y: 300, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1000, y: 100, w: 60, h: 60 });
    const attacker = makeCard({ id: 'att-1', cardId: 'att-1' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(attacker) },
    });
    const { unmount } = render(<CombatArrows combat={[group]} />);
    document.dispatchEvent(new Event('scroll', { bubbles: false }));
    unmount();
    expect(() => vi.runOnlyPendingTimers()).not.toThrow();
  });
});

// --- Hover isolation -------------------------------------------------

describe('CombatArrows — hover isolation', () => {
  it('renders all arrows at full opacity when nothing is hovered', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-2', { x: 300, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });

    const a1 = makeCard({ id: 'att-1', cardId: 'att-1' });
    const a2 = makeCard({ id: 'att-2', cardId: 'att-2' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(a1), 'att-2': makePerm(a2) },
    });
    const { container } = render(<CombatArrows combat={[group]} />);

    const paths = container.querySelectorAll('path[marker-end]');
    expect(paths.length).toBe(2);
    for (const p of paths) {
      // Default opacity = 1 when no hover is active.
      expect(p.getAttribute('opacity')).toBe('1');
    }
  });

  it('dims non-matching arrows when an attacker is hovered', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    const { node: att1Node } = mountPermanentNode('att-1', {
      x: 100,
      y: 200,
      w: 80,
      h: 112,
    });
    mountPermanentNode('att-2', { x: 300, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });

    const a1 = makeCard({ id: 'att-1', cardId: 'att-1' });
    const a2 = makeCard({ id: 'att-2', cardId: 'att-2' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(a1), 'att-2': makePerm(a2) },
    });
    const { container } = render(<CombatArrows combat={[group]} />);

    fireEvent.pointerOver(att1Node);

    const paths = container.querySelectorAll('path[marker-end]');
    expect(paths.length).toBe(2);
    // Map each path to the attacker id in its `d` attribute is
    // tricky from the path alone; instead, find the path whose
    // source (the M command's coords) starts at att-1's center
    // (140, 256) vs att-2's center (340, 256).
    const opacityBySourceX = new Map<number, string | null>();
    for (const p of paths) {
      const d = p.getAttribute('d') ?? '';
      const m = d.match(/^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
      if (!m) continue;
      opacityBySourceX.set(parseFloat(m[1]!), p.getAttribute('opacity'));
    }
    // Hovered attacker (att-1, source.x=140) → full opacity.
    expect(opacityBySourceX.get(140)).toBe('1');
    // Non-hovered attacker (att-2, source.x=340) → dimmed.
    const dimmed = opacityBySourceX.get(340);
    expect(dimmed).not.toBe('1');
    // User-tuned dim — non-hovered arrows drop to ~0.2 so the
    // isolated arrow visually owns the canvas. Test pins the band
    // strictly below 1 (must dim) and strictly above 0 (must
    // remain pickable / not fully removed).
    const dimVal = dimmed ? parseFloat(dimmed) : 1;
    expect(dimVal).toBeLessThan(1);
    expect(dimVal).toBeGreaterThan(0);
  });

  it('full-opacity restored when hover moves to a non-combat element', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    const { node: att1Node } = mountPermanentNode('att-1', {
      x: 100,
      y: 200,
      w: 80,
      h: 112,
    });
    mountPermanentNode('att-2', { x: 300, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });

    const a1 = makeCard({ id: 'att-1', cardId: 'att-1' });
    const a2 = makeCard({ id: 'att-2', cardId: 'att-2' });
    const group = makeCombatGroup({
      defenderId,
      attackers: { 'att-1': makePerm(a1), 'att-2': makePerm(a2) },
    });
    const { container } = render(<CombatArrows combat={[group]} />);

    // Activate isolation on att-1, then hover an unrelated DOM node.
    fireEvent.pointerOver(att1Node);
    const noise = document.createElement('div');
    noise.setAttribute('data-testid', 'noise');
    document.body.appendChild(noise);
    fireEvent.pointerOver(noise);

    const paths = container.querySelectorAll('path[marker-end]');
    for (const p of paths) {
      expect(p.getAttribute('opacity')).toBe('1');
    }
  });
});

// --- Bundle 1 / Slice 1-A — defender color + dash pattern ------------

describe('CombatArrows — defender color + dash (slice 1-A)', () => {
  it('routes per-defender stroke color from colorIdentity', () => {
    const greenDefender = '00000000-0000-0000-0000-0000000000aa';
    const blueDefender = '00000000-0000-0000-0000-0000000000bb';

    mountPermanentNode('att-g', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-b', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(greenDefender, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(blueDefender, { x: 1200, y: 500, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: greenDefender, colorIdentity: ['G'] },
      { playerId: blueDefender, colorIdentity: ['U'] },
    ]);
    const groups: WebCombatGroupView[] = [
      makeCombatGroup({
        defenderId: greenDefender,
        attackers: {
          'att-g': makePerm(makeCard({ id: 'att-g', cardId: 'att-g' })),
        },
      }),
      makeCombatGroup({
        defenderId: blueDefender,
        attackers: {
          'att-b': makePerm(makeCard({ id: 'att-b', cardId: 'att-b' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    const greenArrow = container.querySelector(
      `path[data-arrow-defender-id="${greenDefender}"]`,
    );
    const blueArrow = container.querySelector(
      `path[data-arrow-defender-id="${blueDefender}"]`,
    );
    expect(greenArrow?.getAttribute('stroke')).toBe(
      'var(--color-mana-green)',
    );
    expect(greenArrow?.getAttribute('data-arrow-stroke-kind')).toBe('solid');
    expect(blueArrow?.getAttribute('stroke')).toBe('var(--color-mana-blue)');
    expect(blueArrow?.getAttribute('data-arrow-stroke-kind')).toBe('solid');
  });

  it('emits a gradient stroke for multicolor defenders', () => {
    const sultaiDefender = '00000000-0000-0000-0000-0000000000cc';
    mountPermanentNode('att-s', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(sultaiDefender, { x: 1200, y: 100, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: sultaiDefender, colorIdentity: ['U', 'B', 'G'] },
    ]);
    const groups: WebCombatGroupView[] = [
      makeCombatGroup({
        defenderId: sultaiDefender,
        attackers: {
          'att-s': makePerm(makeCard({ id: 'att-s', cardId: 'att-s' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    const arrow = container.querySelector(
      `path[data-arrow-defender-id="${sultaiDefender}"]`,
    );
    expect(arrow?.getAttribute('data-arrow-stroke-kind')).toBe('gradient');
    expect(arrow?.getAttribute('stroke')).toMatch(
      /^url\(#targeting-arrow-grad-/,
    );
    // 3 colors × 2 stops each = 6 stops along the chord. jsdom's
    // descendant-selector path doesn't match SVG camelCase elements
    // reliably, so chain the queries instead of using
    // 'linearGradient stop' directly.
    const gradient = container.querySelector('linearGradient');
    const stops = gradient?.querySelectorAll('stop');
    expect(stops?.length).toBe(6);
  });

  it('all arrows use the same uniform dash pattern (slice 1-X-tunings round 7)', () => {
    // Slice 1-X-tunings round 7 (live-test verdict 2026-05-09):
    // dropped per-defender dash variation. All combat arrows now
    // share `'8 6'` (medium dashed); color is the sole defender
    // differentiator. WCAG 1.4.1 redundant-signal claim narrowed
    // accordingly — re-introduce per-defender dashes in a future
    // slice if a11y audit insists.
    const defA = '00000000-0000-0000-0000-0000000000aa';
    const defB = '00000000-0000-0000-0000-0000000000bb';
    const defC = '00000000-0000-0000-0000-0000000000cc';
    mountPermanentNode('att-a', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-b', { x: 100, y: 400, w: 80, h: 112 });
    mountPermanentNode('att-c', { x: 100, y: 600, w: 80, h: 112 });
    mountPortraitNode(defA, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(defB, { x: 1200, y: 350, w: 60, h: 60 });
    mountPortraitNode(defC, { x: 1200, y: 600, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: defA, colorIdentity: ['G'] },
      { playerId: defB, colorIdentity: ['R'] },
      { playerId: defC, colorIdentity: ['W'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: defA,
        attackers: {
          'att-a': makePerm(makeCard({ id: 'att-a', cardId: 'att-a' })),
        },
      }),
      makeCombatGroup({
        defenderId: defB,
        attackers: {
          'att-b': makePerm(makeCard({ id: 'att-b', cardId: 'att-b' })),
        },
      }),
      makeCombatGroup({
        defenderId: defC,
        attackers: {
          'att-c': makePerm(makeCard({ id: 'att-c', cardId: 'att-c' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    // Every arrow shares the same '8 6' dash pattern.
    const arrows = container.querySelectorAll('path[data-arrow-defender-id]');
    expect(arrows.length).toBe(3);
    for (const arrow of arrows) {
      expect(arrow.getAttribute('stroke-dasharray')).toBe('8 6');
    }
  });

  it('falls back to legacy neutral stroke when defender is not in players (graceful)', () => {
    const ghostDefender = '00000000-0000-0000-0000-00000000ffff';
    mountPermanentNode('att-x', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(ghostDefender, { x: 1200, y: 100, w: 60, h: 60 });

    // Players list does NOT contain the defender (mid-game removal,
    // fixture drift, etc.). Arrow renders with neutral fallback rather
    // than crashing.
    const players = makePlayers([
      {
        playerId: '00000000-0000-0000-0000-000000001111',
        colorIdentity: ['W'],
      },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: ghostDefender,
        attackers: {
          'att-x': makePerm(makeCard({ id: 'att-x', cardId: 'att-x' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );
    const arrow = container.querySelector(
      `path[data-arrow-defender-id="${ghostDefender}"]`,
    );
    expect(arrow?.getAttribute('stroke')).toBe(
      'var(--color-targeting-arrow)',
    );
    expect(arrow?.getAttribute('data-arrow-stroke-kind')).toBe('solid');
    // Slice 1-A fixer — CombatArrows normalizes defenderIndex=-1
    // (defender not in players) to undefined at the TargetingArrow
    // boundary, so the data-defender-index attribute is absent
    // rather than surfacing the "-1" sentinel to downstream readers.
    expect(arrow?.hasAttribute('data-defender-index')).toBe(false);
  });

  it('blocker arrows inherit the defender lane signal (color + dash from defender, not blocker)', () => {
    const defenderId = '00000000-0000-0000-0000-0000000000aa';
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('blk-1', { x: 600, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: defenderId, colorIdentity: ['R'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
        blockers: {
          'blk-1': makePerm(makeCard({ id: 'blk-1', cardId: 'blk-1' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    // Single arrow (attacker → blocker) — its defender-id metadata
    // should be the lane defender, not the blocker's owner. Stroke =
    // defender's red, NOT the blocker's color (which we don't even
    // pass in this fixture).
    const arrow = container.querySelector(
      `path[data-arrow-defender-id="${defenderId}"]`,
    );
    expect(arrow).not.toBeNull();
    expect(arrow?.getAttribute('stroke')).toBe('var(--color-mana-red)');
  });

  it('similar-color defenders (mono-G vs Selesnya WG) differ via stroke-kind (post-uniform-dash)', () => {
    // Slice 1-X-tunings round 7 (2026-05-09) reframed the WCAG
    // 1.4.1 redundancy: dash is uniform now, so the stroke-kind
    // axis (solid vs gradient) is the secondary signal beyond the
    // color itself. Mono-G renders as a solid green stroke; Selesnya
    // WG renders as a multi-stop gradient with white + green bands.
    // The test pins this distinction so a future refactor can't
    // collapse both into the same render shape.
    const monoGreenDef = '00000000-0000-0000-0000-00000000ee01';
    const selesnyaDef = '00000000-0000-0000-0000-00000000ee02';
    mountPermanentNode('att-mg', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-sl', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(monoGreenDef, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(selesnyaDef, { x: 1200, y: 500, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: monoGreenDef, colorIdentity: ['G'] },
      { playerId: selesnyaDef, colorIdentity: ['G', 'W'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: monoGreenDef,
        attackers: {
          'att-mg': makePerm(makeCard({ id: 'att-mg', cardId: 'att-mg' })),
        },
      }),
      makeCombatGroup({
        defenderId: selesnyaDef,
        attackers: {
          'att-sl': makePerm(makeCard({ id: 'att-sl', cardId: 'att-sl' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    const mgArrow = container.querySelector(
      `path[data-arrow-defender-id="${monoGreenDef}"]`,
    );
    const slArrow = container.querySelector(
      `path[data-arrow-defender-id="${selesnyaDef}"]`,
    );
    // Both arrows share the uniform dash pattern.
    expect(mgArrow?.getAttribute('stroke-dasharray')).toBe('8 6');
    expect(slArrow?.getAttribute('stroke-dasharray')).toBe('8 6');
    // But the stroke-kind axis still distinguishes them.
    expect(mgArrow?.getAttribute('data-arrow-stroke-kind')).toBe('solid');
    expect(slArrow?.getAttribute('data-arrow-stroke-kind')).toBe('gradient');
  });

  it('absent players prop falls back gracefully (legacy call sites)', () => {
    // Older mounts may not yet plumb players (e.g. before slice 1-A's
    // StackZone / Battlefield / asymmetricT updates land). All arrows
    // should render in the legacy neutral stroke without crashing.
    const defenderId = '00000000-0000-0000-0000-0000000000aa';
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });

    const groups = [
      makeCombatGroup({
        defenderId,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
      }),
    ];
    const { container } = render(<CombatArrows combat={groups} />);
    const arrow = container.querySelector('path[marker-end]');
    expect(arrow?.getAttribute('stroke')).toBe(
      'var(--color-targeting-arrow)',
    );
  });
});

// --- Bundle 1 / Slice 1-B — pinned-defender isolation ---------------

describe('CombatArrows — pinned-defender isolation (slice 1-B)', () => {
  it('pinned defender id dims arrows targeting other defenders', () => {
    const pinnedDef = '00000000-0000-0000-0000-0000000000aa';
    const otherDef = '00000000-0000-0000-0000-0000000000bb';
    mountPermanentNode('att-p', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-o', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(pinnedDef, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(otherDef, { x: 1200, y: 500, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: pinnedDef, colorIdentity: ['G'] },
      { playerId: otherDef, colorIdentity: ['U'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: pinnedDef,
        attackers: {
          'att-p': makePerm(makeCard({ id: 'att-p', cardId: 'att-p' })),
        },
      }),
      makeCombatGroup({
        defenderId: otherDef,
        attackers: {
          'att-o': makePerm(makeCard({ id: 'att-o', cardId: 'att-o' })),
        },
      }),
    ];

    // Pin BEFORE render so the very first paint already shows the
    // dim. Pin is read by CombatArrows on render.
    useArrowIsolation.getState().togglePin(pinnedDef);
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    const pinnedArrow = container.querySelector(
      `path[data-arrow-defender-id="${pinnedDef}"]`,
    );
    const otherArrow = container.querySelector(
      `path[data-arrow-defender-id="${otherDef}"]`,
    );
    // Pinned defender's arrow stays at full opacity.
    expect(pinnedArrow?.getAttribute('opacity')).toBe('1');
    // Other defender's arrow is dimmed (band strictly inside (0, 1) —
    // user-tuned default ~0.2).
    const otherOpacity = parseFloat(otherArrow?.getAttribute('opacity') ?? '1');
    expect(otherOpacity).toBeLessThan(1);
    expect(otherOpacity).toBeGreaterThan(0);
    // Stack-zone wrapper announces isolation is active.
    const stackZone = container.querySelector('[data-testid="stack-zone"]');
    expect(stackZone?.getAttribute('data-hover-isolating')).toBe('true');
  });

  it('clearing the pin restores all arrows to full opacity', () => {
    const defA = '00000000-0000-0000-0000-0000000000aa';
    const defB = '00000000-0000-0000-0000-0000000000bb';
    mountPermanentNode('att-a', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-b', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(defA, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(defB, { x: 1200, y: 500, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: defA, colorIdentity: ['G'] },
      { playerId: defB, colorIdentity: ['U'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: defA,
        attackers: {
          'att-a': makePerm(makeCard({ id: 'att-a', cardId: 'att-a' })),
        },
      }),
      makeCombatGroup({
        defenderId: defB,
        attackers: {
          'att-b': makePerm(makeCard({ id: 'att-b', cardId: 'att-b' })),
        },
      }),
    ];

    useArrowIsolation.getState().togglePin(defA);
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    // Confirm dimming is in effect first.
    expect(
      parseFloat(
        container
          .querySelector(`path[data-arrow-defender-id="${defB}"]`)
          ?.getAttribute('opacity') ?? '1',
      ),
    ).toBeLessThan(1);

    // Clear pin — arrows must re-render at full opacity.
    act(() => {
      useArrowIsolation.getState().clearPin();
    });

    const paths = container.querySelectorAll('path[marker-end]');
    for (const p of paths) {
      expect(p.getAttribute('opacity')).toBe('1');
    }
  });

  it('Escape clears the pin while CombatArrows is mounted', () => {
    const defenderId = '00000000-0000-0000-0000-0000000000aa';
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });
    const players = makePlayers([
      { playerId: defenderId, colorIdentity: ['G'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
      }),
    ];

    useArrowIsolation.getState().togglePin(defenderId);
    render(<CombatArrows combat={groups} players={players} />);
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(defenderId);

    // Fire Escape on document — CombatArrows registers a keydown
    // listener at the document level for exactly this case.
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(useArrowIsolation.getState().pinnedDefenderId).toBeNull();
  });

  it('unmounting CombatArrows preserves the pin (mid-combat stack push must not clear it)', () => {
    // Slice 1-B critic-pass fix: the pin's lifetime is "for one
    // combat phase," not "for the lifetime of the CombatArrows
    // component." StackZoneRedesigned unmounts CombatArrows every
    // time a stack appears mid-combat (instant cast, triggered
    // ability) and remounts on stack-resolution. If the pin died on
    // CombatArrows unmount, the user would lose their pin silently
    // on every stack push. Phase-driven auto-clear in the
    // arrowIsolationStore handles the actual "combat ends" case.
    const defenderId = '00000000-0000-0000-0000-0000000000aa';
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });
    const players = makePlayers([
      { playerId: defenderId, colorIdentity: ['G'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
      }),
    ];

    useArrowIsolation.getState().togglePin(defenderId);
    const { unmount } = render(
      <CombatArrows combat={groups} players={players} />,
    );
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(defenderId);

    unmount();
    // Pin SURVIVES the unmount — ready to re-engage when CombatArrows
    // remounts after the stack resolves.
    expect(useArrowIsolation.getState().pinnedDefenderId).toBe(defenderId);
  });

  /* =================================================================
   * Bundle 1 / Slice 1-C — wave-reveal stagger.
   * =================================================================*/

  it('first-paint applies per-defender stagger to the rendered transition-delay', () => {
    const def0 = '00000000-0000-0000-0000-0000000000aa';
    const def1 = '00000000-0000-0000-0000-0000000000bb';
    const def2 = '00000000-0000-0000-0000-0000000000cc';
    mountPermanentNode('att-0', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-1', { x: 100, y: 400, w: 80, h: 112 });
    mountPermanentNode('att-2', { x: 100, y: 600, w: 80, h: 112 });
    mountPortraitNode(def0, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(def1, { x: 1200, y: 350, w: 60, h: 60 });
    mountPortraitNode(def2, { x: 1200, y: 600, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: def0, colorIdentity: ['G'] },
      { playerId: def1, colorIdentity: ['R'] },
      { playerId: def2, colorIdentity: ['W'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: def0,
        attackers: {
          'att-0': makePerm(makeCard({ id: 'att-0', cardId: 'att-0' })),
        },
      }),
      makeCombatGroup({
        defenderId: def1,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
      }),
      makeCombatGroup({
        defenderId: def2,
        attackers: {
          'att-2': makePerm(makeCard({ id: 'att-2', cardId: 'att-2' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    const a0 = container.querySelector(
      `path[data-arrow-defender-id="${def0}"]`,
    );
    const a1 = container.querySelector(
      `path[data-arrow-defender-id="${def1}"]`,
    );
    const a2 = container.querySelector(
      `path[data-arrow-defender-id="${def2}"]`,
    );
    // First-paint stagger: defender 0 → 0ms, defender 1 → 90ms,
    // defender 2 → 180ms (per ARROW_REVEAL_STEP_MS = 90).
    expect(a0?.getAttribute('style') ?? '').toContain(
      'transition-delay: 0ms',
    );
    expect(a1?.getAttribute('style') ?? '').toContain(
      'transition-delay: 90ms',
    );
    expect(a2?.getAttribute('style') ?? '').toContain(
      'transition-delay: 180ms',
    );
  });

  it('subsequent re-render with already-painted arrows zeroes the stagger', () => {
    const defenderId = '00000000-0000-0000-0000-0000000000aa';
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(defenderId, { x: 1200, y: 100, w: 60, h: 60 });
    const players = makePlayers([
      { playerId: defenderId, colorIdentity: ['G'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
      }),
    ];
    const { rerender, container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    // Re-render with the same content — useRef has the previous
    // count, isFirstPaint flips false, all delays go to 0.
    rerender(<CombatArrows combat={groups} players={players} />);

    const arrow = container.querySelector(
      `path[data-arrow-defender-id="${defenderId}"]`,
    );
    expect(arrow?.getAttribute('style') ?? '').toContain(
      'transition-delay: 0ms',
    );
  });

  it('prefers-reduced-motion: reduce zeroes the first-paint stagger', () => {
    // matchMedia mock returning matches=true for the reduce query.
    // Pattern lifted from `transitions.reducedMotion.test.tsx` so the
    // mock shape (matches + addEventListener stubs) stays consistent
    // with the project's other reduced-motion consumers.
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));

    try {
      const def0 = '00000000-0000-0000-0000-0000000000aa';
      const def1 = '00000000-0000-0000-0000-0000000000bb';
      mountPermanentNode('att-0', { x: 100, y: 200, w: 80, h: 112 });
      mountPermanentNode('att-1', { x: 100, y: 400, w: 80, h: 112 });
      mountPortraitNode(def0, { x: 1200, y: 100, w: 60, h: 60 });
      mountPortraitNode(def1, { x: 1200, y: 500, w: 60, h: 60 });

      const players = makePlayers([
        { playerId: def0, colorIdentity: ['G'] },
        { playerId: def1, colorIdentity: ['U'] },
      ]);
      const groups = [
        makeCombatGroup({
          defenderId: def0,
          attackers: {
            'att-0': makePerm(makeCard({ id: 'att-0', cardId: 'att-0' })),
          },
        }),
        makeCombatGroup({
          defenderId: def1,
          attackers: {
            'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
          },
        }),
      ];
      const { container } = render(
        <CombatArrows combat={groups} players={players} />,
      );

      // Both defenders render at 0ms despite different defenderIndex
      // values — reduced-motion overrides the stagger.
      const a0 = container.querySelector(
        `path[data-arrow-defender-id="${def0}"]`,
      );
      const a1 = container.querySelector(
        `path[data-arrow-defender-id="${def1}"]`,
      );
      expect(a0?.getAttribute('style') ?? '').toContain(
        'transition-delay: 0ms',
      );
      expect(a1?.getAttribute('style') ?? '').toContain(
        'transition-delay: 0ms',
      );
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('sparse-attacked defenders get consecutive 0ms / 90ms cadence (combat-order, not players-array order)', () => {
    // Brief at line 147: `defenderOrder.indexOf(arrow.defenderId) * 90`.
    // If the only attacked opponents are at players-array indices
    // 2 and 3, the cadence should still start at 0 (first appearance
    // in combat) — not 180ms (their players-array position). The
    // pre-fix implementation produced 180/270 here; the fix
    // produces 0/90.
    const me = '00000000-0000-0000-0000-0000000000m1';
    const opp1 = '00000000-0000-0000-0000-0000000000o1';
    const def2 = '00000000-0000-0000-0000-0000000000d2';
    const def3 = '00000000-0000-0000-0000-0000000000d3';
    mountPermanentNode('att-2', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-3', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(def2, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(def3, { x: 1200, y: 500, w: 60, h: 60 });

    // Players list has 4 entries; only the last two are attacked.
    const players = makePlayers([
      { playerId: me, colorIdentity: ['G'] },
      { playerId: opp1, colorIdentity: ['U'] },
      { playerId: def2, colorIdentity: ['R'] },
      { playerId: def3, colorIdentity: ['W'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: def2,
        attackers: {
          'att-2': makePerm(makeCard({ id: 'att-2', cardId: 'att-2' })),
        },
      }),
      makeCombatGroup({
        defenderId: def3,
        attackers: {
          'att-3': makePerm(makeCard({ id: 'att-3', cardId: 'att-3' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    const a2 = container.querySelector(
      `path[data-arrow-defender-id="${def2}"]`,
    );
    const a3 = container.querySelector(
      `path[data-arrow-defender-id="${def3}"]`,
    );
    // Combat-order index: def2 → 0, def3 → 1. Cadence: 0ms, 90ms.
    expect(a2?.getAttribute('style') ?? '').toContain(
      'transition-delay: 0ms',
    );
    expect(a3?.getAttribute('style') ?? '').toContain(
      'transition-delay: 90ms',
    );
  });

  it('stagger does NOT replay on CombatArrows remount (stack-push during combat)', () => {
    // Slice 1-C critic-pass fix: StackZoneRedesigned unmounts
    // CombatArrows on every stack push during combat (instant cast,
    // triggered ability). With prevArrowCount in a useRef, each
    // remount would replay the full stagger. Module-level stagger
    // flag in arrowIsolationStore persists across unmounts; only
    // resets on COMBAT → non-COMBAT phase transition.
    const def0 = '00000000-0000-0000-0000-0000000000aa';
    const def1 = '00000000-0000-0000-0000-0000000000bb';
    mountPermanentNode('att-0', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-1', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(def0, { x: 1200, y: 100, w: 60, h: 60 });
    mountPortraitNode(def1, { x: 1200, y: 500, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: def0, colorIdentity: ['G'] },
      { playerId: def1, colorIdentity: ['U'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: def0,
        attackers: {
          'att-0': makePerm(makeCard({ id: 'att-0', cardId: 'att-0' })),
        },
      }),
      makeCombatGroup({
        defenderId: def1,
        attackers: {
          'att-1': makePerm(makeCard({ id: 'att-1', cardId: 'att-1' })),
        },
      }),
    ];

    // First render: stagger fires (first paint).
    const { unmount, container } = render(
      <CombatArrows combat={groups} players={players} />,
    );
    expect(
      container
        .querySelector(`path[data-arrow-defender-id="${def1}"]`)
        ?.getAttribute('style') ?? '',
    ).toContain('transition-delay: 90ms');
    unmount();

    // Simulated stack-push-then-resolve: same combat, fresh remount.
    const { container: container2 } = render(
      <CombatArrows combat={groups} players={players} />,
    );
    // Stagger does NOT replay — module-level flag remembers.
    const a0 = container2.querySelector(
      `path[data-arrow-defender-id="${def0}"]`,
    );
    const a1 = container2.querySelector(
      `path[data-arrow-defender-id="${def1}"]`,
    );
    expect(a0?.getAttribute('style') ?? '').toContain(
      'transition-delay: 0ms',
    );
    expect(a1?.getAttribute('style') ?? '').toContain(
      'transition-delay: 0ms',
    );
  });

  it('defenderIndex of -1 (defender not in players) clamps to 0ms (no negative-delay weirdness)', () => {
    const ghostDefender = '00000000-0000-0000-0000-00000000ffff';
    mountPermanentNode('att-x', { x: 100, y: 200, w: 80, h: 112 });
    mountPortraitNode(ghostDefender, { x: 1200, y: 100, w: 60, h: 60 });

    // Players list does NOT contain the defender.
    const players = makePlayers([
      {
        playerId: '00000000-0000-0000-0000-000000001111',
        colorIdentity: ['W'],
      },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: ghostDefender,
        attackers: {
          'att-x': makePerm(makeCard({ id: 'att-x', cardId: 'att-x' })),
        },
      }),
    ];
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );
    const arrow = container.querySelector(
      `path[data-arrow-defender-id="${ghostDefender}"]`,
    );
    // -1 defenderIndex → clamp(0, min(-1, 5)) = 0 → 0 * 90 = 0ms.
    expect(arrow?.getAttribute('style') ?? '').toContain(
      'transition-delay: 0ms',
    );
  });

  it('pin wins over hover (sticky filter takes precedence over cursor)', () => {
    const pinnedDef = '00000000-0000-0000-0000-0000000000aa';
    const hoverDef = '00000000-0000-0000-0000-0000000000bb';
    const { node: hoverPortraitNode } = (() => {
      const node = mountPortraitNode(hoverDef, {
        x: 1200,
        y: 500,
        w: 60,
        h: 60,
      });
      return { node };
    })();
    mountPermanentNode('att-p', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-h', { x: 100, y: 400, w: 80, h: 112 });
    mountPortraitNode(pinnedDef, { x: 1200, y: 100, w: 60, h: 60 });

    const players = makePlayers([
      { playerId: pinnedDef, colorIdentity: ['G'] },
      { playerId: hoverDef, colorIdentity: ['U'] },
    ]);
    const groups = [
      makeCombatGroup({
        defenderId: pinnedDef,
        attackers: {
          'att-p': makePerm(makeCard({ id: 'att-p', cardId: 'att-p' })),
        },
      }),
      makeCombatGroup({
        defenderId: hoverDef,
        attackers: {
          'att-h': makePerm(makeCard({ id: 'att-h', cardId: 'att-h' })),
        },
      }),
    ];

    useArrowIsolation.getState().togglePin(pinnedDef);
    const { container } = render(
      <CombatArrows combat={groups} players={players} />,
    );

    // Hover the OTHER defender's portrait. Without a pin, this would
    // pull isolation onto hoverDef's arrow. With pinnedDef pinned,
    // the pin must win.
    fireEvent.pointerOver(hoverPortraitNode);

    const pinnedArrow = container.querySelector(
      `path[data-arrow-defender-id="${pinnedDef}"]`,
    );
    const hoverArrow = container.querySelector(
      `path[data-arrow-defender-id="${hoverDef}"]`,
    );
    expect(pinnedArrow?.getAttribute('opacity')).toBe('1');
    expect(
      parseFloat(hoverArrow?.getAttribute('opacity') ?? '1'),
    ).toBeLessThan(1);
  });
});
