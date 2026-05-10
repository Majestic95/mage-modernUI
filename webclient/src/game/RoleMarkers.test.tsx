/**
 * Bundle 4 / Slice 4-A — RoleMarkers tests.
 *
 * Coverage matrix per the scope brief in
 * docs/design/combat-bundle-4-role-markers.md slice 4-A:
 *   - combatRole=undefined → returns null (no DOM mounted).
 *   - combatRole='attacker' → renders wrapper with data-role + 4 SVG
 *     corner brackets, each using var(--color-attacker).
 *   - combatRole='blocker' → renders wrapper with data-role + 4 SVG
 *     corner brackets PLUS the 45° inward stub (deuteranopia
 *     redundant signal), using var(--color-blocker).
 *   - Wrapper is pointer-events:none and aria-hidden=true (T1
 *     footprint preservation + decorative-overlay accessibility).
 *   - Bracket count is exactly 4 (not 8, not 0) regardless of role.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  LOD_FALLBACK_WIDTH_PX,
  RoleMarkers,
  RoleOuterHalo,
} from './RoleMarkers';
import { TabletopCardButton } from './tabletopBucketStacking';
import {
  webCardViewSchema,
  webPermanentViewSchema,
  type WebPermanentView,
} from '../api/schemas';

/** Minimal battlefield perm fixture for DOM-order regression test. */
function makePerm(): WebPermanentView {
  return webPermanentViewSchema.parse({
    card: webCardViewSchema.parse({
      id: '00000000-0000-0000-0000-00000000aaaa',
      cardId: '00000000-0000-0000-0000-00000000aaaa',
      name: 'Llanowar Elves',
      displayName: 'Llanowar Elves',
      expansionSetCode: 'TST',
      cardNumber: '001',
      manaCost: '{G}',
      manaValue: 1,
      typeLine: 'CREATURE',
      supertypes: [],
      types: ['CREATURE'],
      subtypes: ['ELF', 'DRUID'],
      colors: ['G'],
      rarity: 'COMMON',
      power: '1',
      toughness: '1',
      startingLoyalty: '',
      rules: [],
      faceDown: false,
      counters: {},
      transformable: false,
      transformed: false,
      secondCardFace: null,
    }),
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

describe('RoleMarkers', () => {
  it('renders null when combatRole is undefined', () => {
    const { queryByTestId } = render(<RoleMarkers combatRole={undefined} />);
    expect(queryByTestId('role-markers')).toBeNull();
  });

  it('renders null when combatRole is null (matches TabletopCardButton convention)', () => {
    const { queryByTestId } = render(<RoleMarkers combatRole={null} />);
    expect(queryByTestId('role-markers')).toBeNull();
  });

  it('renders wrapper with data-role="attacker" when role is attacker', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    expect(wrapper.getAttribute('data-role')).toBe('attacker');
  });

  it('renders wrapper with data-role="blocker" when role is blocker', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="blocker" />);
    const wrapper = getByTestId('role-markers');
    expect(wrapper.getAttribute('data-role')).toBe('blocker');
  });

  it('renders exactly 4 corner brackets for attackers', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    const corners = wrapper.querySelectorAll('[data-corner]');
    expect(corners).toHaveLength(4);
    // One corner per cardinal: tl / tr / br / bl.
    const cornerKeys = Array.from(corners).map((c) =>
      c.getAttribute('data-corner'),
    );
    expect(cornerKeys.sort()).toEqual(['bl', 'br', 'tl', 'tr']);
  });

  it('renders exactly 4 corner brackets for blockers', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="blocker" />);
    const wrapper = getByTestId('role-markers');
    expect(wrapper.querySelectorAll('[data-corner]')).toHaveLength(4);
  });

  it('attacker brackets use var(--color-attacker) on every stroke', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    const strokes = wrapper.querySelectorAll('line');
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of Array.from(strokes)) {
      expect(stroke.getAttribute('stroke')).toBe('var(--color-attacker)');
    }
  });

  it('blocker brackets use var(--color-blocker) on every stroke', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="blocker" />);
    const wrapper = getByTestId('role-markers');
    const strokes = wrapper.querySelectorAll('line');
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of Array.from(strokes)) {
      expect(stroke.getAttribute('stroke')).toBe('var(--color-blocker)');
    }
  });

  it('attacker has 2 strokes per corner (no inward stub)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    // 4 corners × 2 strokes (vertical leg + horizontal leg) = 8.
    expect(wrapper.querySelectorAll('line')).toHaveLength(8);
    // No blocker-only stub renders for attackers.
    expect(wrapper.querySelectorAll('[data-testid="blocker-stub"]')).toHaveLength(
      0,
    );
  });

  it('blocker has 3 strokes per corner (legs + inward stub)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="blocker" />);
    const wrapper = getByTestId('role-markers');
    // 4 corners × 3 strokes (vertical leg + horizontal leg + 45° stub) = 12.
    expect(wrapper.querySelectorAll('line')).toHaveLength(12);
    // Color-blind redundant signal — exactly 4 stubs (one per corner).
    expect(wrapper.querySelectorAll('[data-testid="blocker-stub"]')).toHaveLength(
      4,
    );
  });

  it('wrapper is pointer-events:none (T1 — must not intercept clicks)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    expect(wrapper.style.pointerEvents).toBe('none');
  });

  it('wrapper is aria-hidden=true (decorative; ATK/BLK badge inside CardFace is the SR surface)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    expect(wrapper.getAttribute('aria-hidden')).toBe('true');
  });

  it('wrapper sits on negative inset (brackets outside cardart — T3 art preservation)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    // inset: -2 → -2px on all four sides. Tuned in slice 4-A's UI
    // critic pass to leave 2px clearance between adjacent cards in
    // BucketCardsRow's 6px gap (otherwise neighbor brackets abut and
    // read as one continuous strip).
    expect(wrapper.style.inset).toBe('-2px');
  });

  it('marker overlay never participates in normal-flow layout (T1 footprint preservation)', () => {
    // Brief acceptance: "Mount inside <TabletopCardButton> does not
    // change the button's bounding box". jsdom returns 0x0 for
    // unstyled elements so an absolute getBoundingClientRect()
    // assertion isn't load-bearing here — instead we pin the three
    // properties that together prove the overlay can't displace
    // anything: position:absolute removes it from flow,
    // pointer-events:none keeps it inert, inset places it relative
    // to its positioning ancestor (the button's `relative` class).
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    expect(wrapper.style.position).toBe('absolute');
    expect(wrapper.style.pointerEvents).toBe('none');
    expect(wrapper.style.inset).toBe('-2px');
  });

  it('each corner is rotated to its matching cardinal so the bracket vertex sits at the parent corner', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const wrapper = getByTestId('role-markers');
    const tl = wrapper.querySelector('[data-corner="tl"]') as HTMLElement;
    const tr = wrapper.querySelector('[data-corner="tr"]') as HTMLElement;
    const br = wrapper.querySelector('[data-corner="br"]') as HTMLElement;
    const bl = wrapper.querySelector('[data-corner="bl"]') as HTMLElement;
    expect(tl.style.transform).toBe('rotate(0deg)');
    expect(tr.style.transform).toBe('rotate(90deg)');
    expect(br.style.transform).toBe('rotate(180deg)');
    expect(bl.style.transform).toBe('rotate(270deg)');
  });
});

/* ===================================================================
 * Slice 4-B — inner ring tests (rendered inside <RoleMarkers>) +
 * <RoleOuterHalo> tests (separate sibling component).
 * =================================================================*/

describe('RoleMarkers (slice 4-B inner ring)', () => {
  it('renders inner ring sibling when role is defined', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    expect(getByTestId('role-inner-ring')).toBeTruthy();
  });

  it('does NOT render inner ring when role is null/undefined', () => {
    const { queryByTestId: q1 } = render(<RoleMarkers combatRole={null} />);
    expect(q1('role-inner-ring')).toBeNull();
    const { queryByTestId: q2 } = render(<RoleMarkers combatRole={undefined} />);
    expect(q2('role-inner-ring')).toBeNull();
  });

  it('attacker inner ring uses var(--color-attacker) inset shadow', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const ring = getByTestId('role-inner-ring');
    expect(ring.style.boxShadow).toContain('var(--color-attacker)');
    expect(ring.style.boxShadow).toContain('inset');
  });

  it('blocker inner ring uses var(--color-blocker) inset shadow', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="blocker" />);
    const ring = getByTestId('role-inner-ring');
    expect(ring.style.boxShadow).toContain('var(--color-blocker)');
    expect(ring.style.boxShadow).toContain('inset');
  });

  it('inner ring is pointer-events:none and aria-hidden (decorative on cardart)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const ring = getByTestId('role-inner-ring');
    expect(ring.style.pointerEvents).toBe('none');
    expect(ring.getAttribute('aria-hidden')).toBe('true');
  });

  it('inner ring sits exactly on cardart bounds (inset: BRACKET_OUTSET cancels wrapper)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const ring = getByTestId('role-inner-ring');
    // Wrapper is at inset: -2; inner ring is at inset: 2. Net offset
    // from cardart bounds = 0 → ring sits exactly on the cardart.
    expect(ring.style.inset).toBe('2px');
  });

  it('inner ring inherits CardFace radius via var(--radius-md)', () => {
    const { getByTestId } = render(<RoleMarkers combatRole="attacker" />);
    const ring = getByTestId('role-inner-ring');
    expect(ring.style.borderRadius).toContain('var(--radius-md');
  });
});

describe('RoleOuterHalo', () => {
  it('renders null when combatRole is undefined', () => {
    const { queryByTestId } = render(
      <RoleOuterHalo combatRole={undefined} controllerColorIdentity={[]} />,
    );
    expect(queryByTestId('role-outer-halo')).toBeNull();
  });

  it('renders null when combatRole is null (suppressed for non-combat creatures)', () => {
    const { queryByTestId } = render(
      <RoleOuterHalo combatRole={null} controllerColorIdentity={['G']} />,
    );
    expect(queryByTestId('role-outer-halo')).toBeNull();
  });

  it('renders the wrapper with data-role when role is set', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={['G']} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.getAttribute('data-role')).toBe('attacker');
  });

  it('mono-G controller paints var(--color-mana-green-glow) background', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={['G']} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.style.background).toContain('var(--color-mana-green-glow)');
  });

  it('multicolor BR controller paints a 2-arc conic gradient', () => {
    const { getByTestId } = render(
      <RoleOuterHalo
        combatRole="attacker"
        controllerColorIdentity={['B', 'R']}
      />,
    );
    const halo = getByTestId('role-outer-halo');
    // jsdom collapses to lowercase. Match the constructed gradient
    // shape directly via the function name.
    expect(halo.style.background).toContain('conic-gradient');
    expect(halo.style.background).toContain('var(--color-mana-black-glow)');
    expect(halo.style.background).toContain('var(--color-mana-red-glow)');
  });

  it('colorless controller (empty identity) paints the silver-grey neutral', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={[]} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.style.background).toContain('var(--color-team-neutral)');
  });

  it('undefined controllerColorIdentity falls back to neutral (legacy variant safety net)', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={undefined} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.style.background).toContain('var(--color-team-neutral)');
  });

  it('halo is pointer-events:none and aria-hidden (T1 + decorative)', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={['G']} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.style.pointerEvents).toBe('none');
    expect(halo.getAttribute('aria-hidden')).toBe('true');
  });

  it('halo sits at -2.5px inset (frame around cardart, T3-safe — cardart paints over center)', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={['G']} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.style.inset).toBe('-2.5px');
  });

  it('halo border-radius is calc(--radius-md + 2.5px) — uniform-thickness frame at corners', () => {
    const { getByTestId } = render(
      <RoleOuterHalo combatRole="attacker" controllerColorIdentity={['G']} />,
    );
    const halo = getByTestId('role-outer-halo');
    expect(halo.style.borderRadius).toContain('calc(');
    expect(halo.style.borderRadius).toContain('var(--radius-md');
  });
});

/* ===================================================================
 * Slice 4-B — DOM-order invariant inside TabletopCardButton.
 *
 * Pinned because the design relies on RoleOuterHalo painting BEFORE
 * <CardFace> (so cardart covers the center and only the halo frame
 * remains visible) and RoleMarkers painting AFTER <CardFace> (so the
 * inner ring + brackets aren't occluded by cardart pixels). A future
 * refactor that reorders TabletopCardButton's children would silently
 * break the visual without this regression test.
 * =================================================================*/

describe('TabletopCardButton DOM-order invariant (slice 4-B layering)', () => {
  it('outer halo paints BEFORE card face, markers paint AFTER (combat creature)', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    const children = Array.from(button!.children);
    const haloIdx = children.findIndex(
      (c) => c.querySelector('[data-testid="role-outer-halo"]') !== null
        || c.getAttribute('data-testid') === 'role-outer-halo',
    );
    const markersIdx = children.findIndex(
      (c) => c.querySelector('[data-testid="role-markers"]') !== null
        || c.getAttribute('data-testid') === 'role-markers',
    );
    expect(haloIdx).toBeGreaterThanOrEqual(0);
    expect(markersIdx).toBeGreaterThanOrEqual(0);
    // Halo MUST come before markers in DOM order (paints behind
    // cardart; markers paint on top).
    expect(haloIdx).toBeLessThan(markersIdx);
  });

  it('non-combat creature has neither halo nor markers in the DOM', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole={null}
        controllerColorIdentity={['G']}
      />,
    );
    expect(
      container.querySelector('[data-testid="role-outer-halo"]'),
    ).toBeNull();
    expect(container.querySelector('[data-testid="role-markers"]')).toBeNull();
  });
});

/* ===================================================================
 * Slice 4-D — LOD fallback for crowded boards.
 *
 * jsdom doesn't have a real ResizeObserver, so we install a mock
 * that records constructed instances + lets tests fire callbacks
 * manually. getBoundingClientRect on the parent button is stubbed
 * per-test to control the measured width that drives lodMode.
 * =================================================================*/

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  readonly observed = new Set<Element>();
  readonly callback: ResizeObserverCallback;
  // Slice 4-D Tech critic notable T-2 — count disconnect calls so
  // the cleanup test asserts the production code actually invokes
  // observer.disconnect() on unmount, not just that the mock's
  // `observed` set is empty (which it would also be if disconnect
  // were removed entirely and observe() never fired).
  disconnectCount = 0;
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
    this.disconnectCount += 1;
  };
  fire = () => {
    this.callback([], this as unknown as ResizeObserver);
  };
}

const originalResizeObserver = globalThis.ResizeObserver;

/**
 * Stub `getBoundingClientRect` on `el` to return the given width
 * (height clamped to width × 7/5 for plausibility — cards have a
 * 5:7 aspect ratio).
 */
function pinWidth(el: Element, width: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        width,
        height: (width * 7) / 5,
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: (width * 7) / 5,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  });
}

describe('RoleMarkers / RoleOuterHalo LOD fallback (slice 4-D)', () => {
  beforeEach(() => {
    ResizeObserverMock.instances = [];
    globalThis.ResizeObserver =
      ResizeObserverMock as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('exports LOD_FALLBACK_WIDTH_PX = 72 (slice 4-D UI-critic-tuned threshold)', () => {
    // 72 px keeps the canonical `--card-size-medium` (80 px) tile
    // in full LOD; only stack-peek strips and `--card-size-small`
    // tiles drop to sigil mode.
    expect(LOD_FALLBACK_WIDTH_PX).toBe(72);
  });

  it('full LOD at 200 px tile width: 4 brackets + inner ring + no sigil', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 200);
    // Fire the observer's callback so the hook re-measures with the
    // pinned width.
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const markers = container.querySelector('[data-testid="role-markers"]')!;
    expect(markers.getAttribute('data-lod-mode')).toBe('full');
    expect(markers.querySelectorAll('[data-corner]')).toHaveLength(4);
    expect(
      container.querySelector('[data-testid="role-inner-ring"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="role-sigil"]')).toBeNull();
    // Outer halo also stays in full mode.
    expect(
      container.querySelector('[data-testid="role-outer-halo"]'),
    ).not.toBeNull();
  });

  it('sigil LOD at 60 px tile width: 0 brackets + 0 inner ring + 1 sigil + outer halo PERSISTS', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 60);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const markers = container.querySelector('[data-testid="role-markers"]')!;
    expect(markers.getAttribute('data-lod-mode')).toBe('sigil');
    expect(markers.querySelectorAll('[data-corner]')).toHaveLength(0);
    expect(
      container.querySelector('[data-testid="role-inner-ring"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="role-sigil"]'),
    ).not.toBeNull();
    // Slice 4-D UI critic ratification: outer halo PERSISTS at
    // sigil mode — controller-color cue is preserved at small sizes,
    // only the bracket+inner-ring chrome collapses.
    expect(
      container.querySelector('[data-testid="role-outer-halo"]'),
    ).not.toBeNull();
  });

  it('strict less-than threshold: 71 px → sigil; 72 px → full', () => {
    const { container, rerender } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 71);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    expect(
      container
        .querySelector('[data-testid="role-markers"]')
        ?.getAttribute('data-lod-mode'),
    ).toBe('sigil');
    pinWidth(button, 72);
    rerender(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    expect(
      container
        .querySelector('[data-testid="role-markers"]')
        ?.getAttribute('data-lod-mode'),
    ).toBe('full');
  });

  it('canonical --card-size-medium (80 px) stays in full LOD (UI-2 regression guard)', () => {
    // Slice 4-D UI critic blocker UI-2 — original threshold of 88
    // would have silently collapsed every 80 px battlefield tile to
    // sigil mode, regressing slices 4-A + 4-B output. Pin the
    // 80 px → full guarantee so a future threshold tuning can't
    // re-introduce the regression without flipping this test.
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 80);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    expect(
      container
        .querySelector('[data-testid="role-markers"]')
        ?.getAttribute('data-lod-mode'),
    ).toBe('full');
  });

  it('attacker sigil uses --color-attacker bg + letter A', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 60);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const sigil = container.querySelector(
      '[data-testid="role-sigil"]',
    ) as HTMLElement;
    expect(sigil.getAttribute('data-role')).toBe('attacker');
    expect(sigil.style.background).toContain('var(--color-attacker)');
    expect(sigil.textContent).toBe('A');
  });

  it('blocker sigil uses --color-blocker bg + letter B', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="blocker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 60);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const sigil = container.querySelector(
      '[data-testid="role-sigil"]',
    ) as HTMLElement;
    expect(sigil.getAttribute('data-role')).toBe('blocker');
    expect(sigil.style.background).toContain('var(--color-blocker)');
    expect(sigil.textContent).toBe('B');
  });

  it('sigil is pointer-events:none and aria-hidden (T1 + decorative)', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 60);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const sigil = container.querySelector(
      '[data-testid="role-sigil"]',
    ) as HTMLElement;
    expect(sigil.style.pointerEvents).toBe('none');
    expect(sigil.getAttribute('aria-hidden')).toBe('true');
  });

  it('exactly 2 observers per combat creature (one in RoleOuterHalo, one in RoleMarkers); each observed parent + disconnected on unmount', () => {
    const { unmount } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    // Tech critic notable T-3 — pin exact count rather than the
    // looser >= 2 floor. RoleMarkers' useTileLodMode + RoleOuterHalo's
    // useTileLodMode each instantiate one observer.
    expect(ResizeObserverMock.instances).toHaveLength(2);
    // Slice 4-X.0 BugHunter HIGH-1 — assert observe() was actually
    // called BEFORE unmount. Without this, a hypothetical bug
    // where useLayoutEffect short-circuits before observer.observe()
    // would still pass the disconnectCount assertion (the cleanup
    // arrow always fires on unmount whether or not observe ran).
    for (const obs of ResizeObserverMock.instances) {
      expect(obs.observed.size).toBe(1);
    }
    unmount();
    // Tech critic notable T-2 — assert disconnect was actually
    // called (not just that the mock's `observed` set ended up
    // empty, which would also pass if disconnect were removed).
    for (const obs of ResizeObserverMock.instances) {
      expect(obs.disconnectCount).toBe(1);
      expect(obs.observed.size).toBe(0);
    }
  });

  it('attacker sigil is a circle (border-radius 50%) for WCAG 1.4.1 redundant-shape signal', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 60);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const sigil = container.querySelector(
      '[data-testid="role-sigil"]',
    ) as HTMLElement;
    expect(sigil.style.borderRadius).toBe('50%');
  });

  it('blocker sigil is a rounded square (border-radius 4px) — distinct shape from attacker', () => {
    // Slice 4-X.0 N-F — at sigil mode the brackets are gone; only
    // the letter glyph + sigil shape distinguish role for color-blind
    // viewers. Circle (attacker) vs rounded-square (blocker)
    // restores the WCAG 1.4.1 redundant-shape signal.
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="blocker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    pinWidth(button, 60);
    act(() => {
      for (const obs of ResizeObserverMock.instances) obs.fire();
    });
    const sigil = container.querySelector(
      '[data-testid="role-sigil"]',
    ) as HTMLElement;
    expect(sigil.style.borderRadius).toBe('4px');
  });

  it('graceful fallback to full LOD when ResizeObserver is undefined', () => {
    globalThis.ResizeObserver =
      undefined as unknown as typeof ResizeObserver;
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    // Without ResizeObserver, the hook still runs the initial
    // measure() — jsdom returns 0×0, and the `w > 0` guard means
    // we default to 'full'.
    const markers = container.querySelector('[data-testid="role-markers"]');
    expect(markers?.getAttribute('data-lod-mode')).toBe('full');
  });

  it('outer halo has NO data-lod-mode attribute (BugHunter MED-3 / LOW-7 — halo persists at all LOD modes; attribute would lie)', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const halo = container.querySelector('[data-testid="role-outer-halo"]');
    expect(halo).not.toBeNull();
    // Halo persists at all LOD modes per slice 4-D ratification.
    // The data-lod-mode attribute (which exists on RoleMarkers'
    // wrapper) would be a dead lie if also surfaced on the halo.
    expect(halo?.getAttribute('data-lod-mode')).toBeNull();
  });
});

/* ===================================================================
 * Slice 4-X.0 — tap-rotation invariant.
 *
 * Pinned because Bundle 4's marker overlays are SIBLINGS of CardFace
 * (not children), so without this regression test a tapped attacker
 * would silently render a horizontal cardart inside an upright
 * orange-bracket frame. Same bug class as the 2026-05-04 commander-
 * halo desync at CardFace.tsx:382-387.
 * =================================================================*/

describe('TabletopCardButton aria-label + focus-visible (slice 4-X.0)', () => {
  it('aria-label is just the card name when combatRole is null', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole={null}
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Llanowar Elves');
  });

  it('aria-label suffixes role when combatRole is attacker (UX N-A — SR users hear the role)', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Llanowar Elves, attacker');
  });

  it('aria-label suffixes role when combatRole is blocker', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="blocker"
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Llanowar Elves, blocker');
  });

  it('button className includes focus-visible classes (UX B-1 — WCAG 2.4.7 keyboard focus indicator)', () => {
    const { container } = render(
      <TabletopCardButton
        perm={makePerm()}
        clickable={true}
        onObjectClick={() => {}}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole={null}
        controllerColorIdentity={['G']}
      />,
    );
    const button = container.querySelector('button')!;
    expect(button.className).toContain('focus-visible:outline');
    expect(button.className).toContain('focus-visible:outline-2');
    expect(button.className).toContain('focus-visible:outline-offset-2');
    expect(button.className).toContain('focus-visible:outline-amber-300');
  });
});

describe('RoleMarkers / RoleOuterHalo tap-rotation (slice 4-X.0)', () => {
  it('untapped creature: marker wrappers carry no rotation transform', () => {
    const perm = makePerm();
    // perm.tapped is false by default in makePerm
    const { container } = render(
      <TabletopCardButton
        perm={perm}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const halo = container.querySelector(
      '[data-testid="role-outer-halo"]',
    ) as HTMLElement;
    const markers = container.querySelector(
      '[data-testid="role-markers"]',
    ) as HTMLElement;
    // No rotation when not tapped (transform is the empty string in
    // jsdom for `undefined` inline values).
    expect(halo.style.transform).toBe('');
    expect(markers.style.transform).toBe('');
  });

  it('tapped creature: both halo and markers rotate 90° around center', () => {
    const tappedPerm = webPermanentViewSchema.parse({
      ...makePerm(),
      tapped: true,
    });
    const { container } = render(
      <TabletopCardButton
        perm={tappedPerm}
        clickable={false}
        onObjectClick={undefined}
        isEligibleTarget={false}
        isEligibleCombat={false}
        combatRole="attacker"
        controllerColorIdentity={['G']}
      />,
    );
    const halo = container.querySelector(
      '[data-testid="role-outer-halo"]',
    ) as HTMLElement;
    const markers = container.querySelector(
      '[data-testid="role-markers"]',
    ) as HTMLElement;
    expect(halo.style.transform).toBe('rotate(90deg)');
    expect(halo.style.transformOrigin).toBe('center');
    expect(markers.style.transform).toBe('rotate(90deg)');
    expect(markers.style.transformOrigin).toBe('center');
  });
});
