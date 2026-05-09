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
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.ResizeObserver = originalResizeObserver;
  document.body.innerHTML = '';
});

// --- Endpoint fan ----------------------------------------------------

describe('CombatArrows — endpoint fanning', () => {
  it('leaves a single attacker→defender arrow unfanned (N=1, offset=0)', () => {
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
    // Target = portrait center at (1030, 130). Single-arrow groups
    // pass through unchanged.
    expect(paths[0]?.getAttribute('d')).toMatch(/Q .+ 1030 130$/);
  });

  it('fans endpoints when multiple attackers share one defender', () => {
    const defenderId = '00000000-0000-0000-0000-00000000aaaa';
    // 3 attackers spread horizontally so source.x sort is well-defined.
    mountPermanentNode('att-1', { x: 100, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-2', { x: 300, y: 200, w: 80, h: 112 });
    mountPermanentNode('att-3', { x: 500, y: 200, w: 80, h: 112 });
    // One shared defender portrait.
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

    // All three target coordinates must be distinct (the fan offset
    // produced different points). Compare via JSON to dedupe.
    const distinct = new Set(targets.map((t) => JSON.stringify(t)));
    expect(distinct.size).toBe(3);

    // None of the three may sit at the raw un-fanned center
    // (1230, 130) — proves the fan offset was actually applied
    // to all arrows. The middle arrow (i=1, offset=0) is still
    // un-displaced by design; we accept that and just check that
    // no MORE THAN ONE arrow is at the raw center.
    const atRawCenter = targets.filter(
      (t) => t && Math.abs(t.x - 1230) < 0.01 && Math.abs(t.y - 130) < 0.01,
    );
    expect(atRawCenter.length).toBeLessThanOrEqual(1);

    // Mean X stays near the raw center — the fan is approximately
    // symmetric. Loose tolerance: the per-arrow perpendicular
    // vector differs slightly (each source→target angle is
    // distinct), so symmetry around X is only approximate.
    const meanX =
      targets.reduce((sum, t) => sum + (t?.x ?? 0), 0) / targets.length;
    expect(Math.abs(meanX - 1230)).toBeLessThan(5);
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
    // Slice 1-A — dim opacity raised from 0.25 to 0.5 to keep
    // dark-bias mana colors WCAG 1.4.11 compliant when isolated.
    // Pin the meaningful-but-not-invisible band: must be < 1 AND
    // ≥ 0.4 (loose lower bound around the new 0.5 default).
    const dimVal = dimmed ? parseFloat(dimmed) : 1;
    expect(dimVal).toBeLessThan(1);
    expect(dimVal).toBeGreaterThanOrEqual(0.4);
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

  it('assigns dash patterns by defender position in players (color-blind partner signal)', () => {
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

    // Defender 0 → solid (no dash attribute).
    const arrowA = container.querySelector(
      `path[data-arrow-defender-id="${defA}"]`,
    );
    expect(arrowA?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(arrowA?.getAttribute('data-defender-index')).toBe('0');
    // Defender 1 → dashed.
    const arrowB = container.querySelector(
      `path[data-arrow-defender-id="${defB}"]`,
    );
    expect(arrowB?.getAttribute('stroke-dasharray')).toBe('8 6');
    expect(arrowB?.getAttribute('data-defender-index')).toBe('1');
    // Defender 2 → dotted.
    const arrowC = container.querySelector(
      `path[data-arrow-defender-id="${defC}"]`,
    );
    expect(arrowC?.getAttribute('stroke-dasharray')).toBe('2 5');
    expect(arrowC?.getAttribute('data-defender-index')).toBe('2');
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

  it('similar-color defenders (mono-G vs Selesnya WG) remain distinguishable by dash (WCAG 1.4.1 redundancy)', () => {
    // Worst-case visual confusion: two opponents whose color
    // identities both lead with green. Without the dash signal a
    // color-blind player could not tell which arrow targets which
    // defender. Pin that the dash patterns disambiguate them so a
    // future "simplify" refactor can't quietly defeat the redundancy.
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
    // Mono-G defender at index 0 → solid + solid stroke.
    expect(mgArrow?.hasAttribute('stroke-dasharray')).toBe(false);
    expect(mgArrow?.getAttribute('data-arrow-stroke-kind')).toBe('solid');
    // Selesnya defender at index 1 → dashed pattern + gradient
    // stroke. The dash pattern is the load-bearing signal here; even
    // if a deuteranopic user collapses both gradients toward a
    // similar yellow-ish band, the dashed-vs-solid difference still
    // distinguishes the two arrows.
    expect(slArrow?.getAttribute('stroke-dasharray')).toBe('8 6');
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
