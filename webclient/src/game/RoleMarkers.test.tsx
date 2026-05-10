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
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RoleMarkers, RoleOuterHalo } from './RoleMarkers';
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
