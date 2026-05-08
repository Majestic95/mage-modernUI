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
} from '../api/schemas';
import { CombatArrows } from './CombatArrows';

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
    expect(dimmed && parseFloat(dimmed)).toBeLessThan(0.5);
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
