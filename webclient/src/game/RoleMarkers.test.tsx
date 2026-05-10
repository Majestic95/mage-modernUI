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
import { RoleMarkers } from './RoleMarkers';

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
