/**
 * Slice B-1 — tests for `computeTabletopZoneBackground`.
 *
 * Coverage matrix per the spec in docs/design/variant-tabletop.md
 * element #1:
 *   - Single-color (W / U / B / R / G) → solid `--color-mana-X-glow` token.
 *   - Two-color → conic-gradient with 2 bands at 180° each.
 *   - Three-color → 3 bands at 120°.
 *   - Four-color → 4 bands at 90°.
 *   - Five-color (WUBRG) → 5 bands at 72°.
 *   - Empty colorIdentity (colorless commander) → `--tabletop-zone-colorless`.
 *   - Eliminated → `--color-team-neutral` (overrides any colorIdentity).
 *   - Unknown color code → falls back to `--color-team-neutral` per the
 *     defensive `manaGlowTokenForCode` switch default.
 */
import { describe, it, expect } from 'vitest';
import { computeTabletopZoneBackground } from './halo';

describe('computeTabletopZoneBackground', () => {
  describe('single color → solid -glow token', () => {
    it.each([
      ['W', 'white'],
      ['U', 'blue'],
      ['B', 'black'],
      ['R', 'red'],
      ['G', 'green'],
    ])('%s → --color-mana-%s-glow', (code, name) => {
      expect(computeTabletopZoneBackground([code], false)).toBe(
        `var(--color-mana-${name}-glow)`,
      );
    });
  });

  it('two colors → conic-gradient with 2 arcs at 180° each', () => {
    const bg = computeTabletopZoneBackground(['W', 'U'], false);
    expect(bg).toMatch(/^conic-gradient\(from var\(--halo-angle, 0deg\),/);
    expect(bg).toContain('var(--color-mana-white-glow) 0deg 180deg');
    expect(bg).toContain('var(--color-mana-blue-glow) 180deg 360deg');
  });

  it('three colors → 3 arcs at 120° (Bant: WUG)', () => {
    const bg = computeTabletopZoneBackground(['W', 'U', 'G'], false);
    expect(bg).toContain('var(--color-mana-white-glow) 0deg 120deg');
    expect(bg).toContain('var(--color-mana-blue-glow) 120deg 240deg');
    expect(bg).toContain('var(--color-mana-green-glow) 240deg 360deg');
  });

  it('four colors → 4 arcs at 90° (e.g. Yidris-style WUBR omitted)', () => {
    const bg = computeTabletopZoneBackground(['W', 'U', 'B', 'R'], false);
    expect(bg).toContain('var(--color-mana-white-glow) 0deg 90deg');
    expect(bg).toContain('var(--color-mana-blue-glow) 90deg 180deg');
    expect(bg).toContain('var(--color-mana-black-glow) 180deg 270deg');
    expect(bg).toContain('var(--color-mana-red-glow) 270deg 360deg');
  });

  it('five colors WUBRG → 5 arcs at 72°', () => {
    const bg = computeTabletopZoneBackground(['W', 'U', 'B', 'R', 'G'], false);
    expect(bg).toContain('var(--color-mana-white-glow) 0deg 72deg');
    expect(bg).toContain('var(--color-mana-blue-glow) 72deg 144deg');
    expect(bg).toContain('var(--color-mana-black-glow) 144deg 216deg');
    expect(bg).toContain('var(--color-mana-red-glow) 216deg 288deg');
    expect(bg).toContain('var(--color-mana-green-glow) 288deg 360deg');
  });

  it('empty colorIdentity → --tabletop-zone-colorless (warm ivory + gold)', () => {
    expect(computeTabletopZoneBackground([], false)).toBe(
      'var(--tabletop-zone-colorless)',
    );
  });

  it('eliminated → --color-team-neutral regardless of colorIdentity', () => {
    expect(computeTabletopZoneBackground(['R'], true)).toBe(
      'var(--color-team-neutral)',
    );
    expect(computeTabletopZoneBackground(['W', 'U', 'B', 'R', 'G'], true)).toBe(
      'var(--color-team-neutral)',
    );
    expect(computeTabletopZoneBackground([], true)).toBe(
      'var(--color-team-neutral)',
    );
  });

  it('unknown color code defaults to --color-team-neutral inside the gradient', () => {
    // Defends against a future engine upgrade with a sixth color (e.g.
    // hypothetical 'X' for colorless mana). The fallback prevents a
    // transparent band from appearing in the gradient.
    const bg = computeTabletopZoneBackground(['W', 'X'], false);
    expect(bg).toContain('var(--color-mana-white-glow) 0deg 180deg');
    expect(bg).toContain('var(--color-team-neutral) 180deg 360deg');
  });

  it('returns a single-color token (NOT a gradient) for one-color identity', () => {
    // Sanity-check the 1-color short-circuit — no point wrapping a
    // single solid color in a conic-gradient.
    const bg = computeTabletopZoneBackground(['G'], false);
    expect(bg).not.toMatch(/conic-gradient/);
    expect(bg).toBe('var(--color-mana-green-glow)');
  });
});
