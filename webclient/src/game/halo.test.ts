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
import {
  arrowStrokeForColorIdentity,
  computeTabletopZoneBackground,
  DEFENDER_DASH_PATTERNS,
  defenderColorIdentity,
  defenderDashPattern,
} from './halo';

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

/* ===================================================================
 * Bundle 1 / Slice 1-A — defender color + dash helpers.
 * =================================================================*/

describe('defenderColorIdentity', () => {
  const players = [
    { playerId: 'p1', colorIdentity: ['G'] as readonly string[] },
    { playerId: 'p2', colorIdentity: ['U', 'B'] as readonly string[] },
    { playerId: 'p3', colorIdentity: [] as readonly string[] },
  ];

  it('returns the matched player\'s colorIdentity', () => {
    expect(defenderColorIdentity('p1', players)).toEqual(['G']);
    expect(defenderColorIdentity('p2', players)).toEqual(['U', 'B']);
  });

  it('returns [] for an unknown defenderId', () => {
    expect(defenderColorIdentity('not-here', players)).toEqual([]);
  });

  it('returns [] for an empty defenderId (mid-game removal / fixture drift)', () => {
    expect(defenderColorIdentity('', players)).toEqual([]);
  });

  it('returns [] for an empty players list', () => {
    expect(defenderColorIdentity('p1', [])).toEqual([]);
  });

  it('preserves a colorless commander\'s empty identity (does not crash)', () => {
    expect(defenderColorIdentity('p3', players)).toEqual([]);
  });
});

describe('arrowStrokeForColorIdentity', () => {
  it('empty identity → solid neutral targeting-arrow color', () => {
    expect(arrowStrokeForColorIdentity([])).toEqual({
      kind: 'solid',
      color: 'var(--color-targeting-arrow)',
    });
  });

  it.each([
    ['W', 'white'],
    ['U', 'blue'],
    ['B', 'black'],
    ['R', 'red'],
    ['G', 'green'],
  ])('single color %s → solid var(--color-mana-%s)', (code, name) => {
    expect(arrowStrokeForColorIdentity([code])).toEqual({
      kind: 'solid',
      color: `var(--color-mana-${name})`,
    });
  });

  it('unknown single color → solid neutral team-ring (defensive)', () => {
    // manaTokenForCode falls back to --color-team-neutral on unknown
    // codes; the stroke helper inherits that defense.
    expect(arrowStrokeForColorIdentity(['X'])).toEqual({
      kind: 'solid',
      color: 'var(--color-team-neutral)',
    });
  });

  it('two colors → gradient with 4 duplicate-offset stops (hard band)', () => {
    const stroke = arrowStrokeForColorIdentity(['U', 'G']);
    expect(stroke.kind).toBe('gradient');
    if (stroke.kind !== 'gradient') return; // narrow for TS
    expect(stroke.stops).toHaveLength(4);
    expect(stroke.stops[0]).toEqual({
      offset: 0,
      color: 'var(--color-mana-blue)',
    });
    expect(stroke.stops[1]).toEqual({
      offset: 0.5,
      color: 'var(--color-mana-blue)',
    });
    expect(stroke.stops[2]).toEqual({
      offset: 0.5,
      color: 'var(--color-mana-green)',
    });
    expect(stroke.stops[3]).toEqual({
      offset: 1,
      color: 'var(--color-mana-green)',
    });
  });

  it('three colors (Sultai UBG) → 6 stops at 0/1/3 - 1/3/2/3 - 2/3/1 boundaries', () => {
    const stroke = arrowStrokeForColorIdentity(['U', 'B', 'G']);
    expect(stroke.kind).toBe('gradient');
    if (stroke.kind !== 'gradient') return;
    expect(stroke.stops).toHaveLength(6);
    // First color band: 0 → 1/3.
    expect(stroke.stops[0]?.offset).toBe(0);
    expect(stroke.stops[0]?.color).toBe('var(--color-mana-blue)');
    expect(stroke.stops[1]?.offset).toBeCloseTo(1 / 3, 6);
    expect(stroke.stops[1]?.color).toBe('var(--color-mana-blue)');
    // Second color band: 1/3 → 2/3 (hard band — duplicate offset at 1/3).
    expect(stroke.stops[2]?.offset).toBeCloseTo(1 / 3, 6);
    expect(stroke.stops[2]?.color).toBe('var(--color-mana-black)');
    expect(stroke.stops[3]?.offset).toBeCloseTo(2 / 3, 6);
    // Third color band terminates at 1.
    expect(stroke.stops[5]?.offset).toBe(1);
    expect(stroke.stops[5]?.color).toBe('var(--color-mana-green)');
  });

  it('five colors (WUBRG) → 10 stops at evenly-spaced bands', () => {
    const stroke = arrowStrokeForColorIdentity(['W', 'U', 'B', 'R', 'G']);
    expect(stroke.kind).toBe('gradient');
    if (stroke.kind !== 'gradient') return;
    expect(stroke.stops).toHaveLength(10);
    // First and last colors anchor at 0 and 1.
    expect(stroke.stops[0]?.offset).toBe(0);
    expect(stroke.stops[0]?.color).toBe('var(--color-mana-white)');
    expect(stroke.stops[9]?.offset).toBe(1);
    expect(stroke.stops[9]?.color).toBe('var(--color-mana-green)');
  });

  it('hard-band assertion: each color\'s pair shares its color across both stops', () => {
    // Regression guard — a future refactor that produces single-stop
    // gradients (smooth blend instead of bands) would change the
    // visual character of multicolor arrows. This test pins the
    // duplicate-offset shape.
    const stroke = arrowStrokeForColorIdentity(['R', 'G', 'W']);
    expect(stroke.kind).toBe('gradient');
    if (stroke.kind !== 'gradient') return;
    for (let i = 0; i < stroke.stops.length; i += 2) {
      expect(stroke.stops[i]?.color).toBe(stroke.stops[i + 1]?.color);
    }
  });
});

describe('defenderDashPattern + DEFENDER_DASH_PATTERNS', () => {
  it('exposes 4 pre-canned patterns: solid / dashed / dotted / ticked', () => {
    expect(DEFENDER_DASH_PATTERNS).toHaveLength(4);
    expect(DEFENDER_DASH_PATTERNS[0]).toBe(''); // solid (no dash)
    expect(DEFENDER_DASH_PATTERNS[1]).toBe('8 6'); // dashed
    expect(DEFENDER_DASH_PATTERNS[2]).toBe('2 5'); // dotted
    expect(DEFENDER_DASH_PATTERNS[3]).toBe('1 6'); // ticked (single-pixel ticks)
  });

  it('indexes patterns by defender position', () => {
    expect(defenderDashPattern(0)).toBe('');
    expect(defenderDashPattern(1)).toBe('8 6');
    expect(defenderDashPattern(2)).toBe('2 5');
    expect(defenderDashPattern(3)).toBe('1 6');
  });

  it('wraps via modulo for 5+ defenders (exotic format degradation)', () => {
    expect(defenderDashPattern(4)).toBe(''); // wraps back to solid
    expect(defenderDashPattern(5)).toBe('8 6');
    expect(defenderDashPattern(7)).toBe('1 6');
  });

  it('returns solid for negative index (defensive)', () => {
    expect(defenderDashPattern(-1)).toBe('');
  });
});
