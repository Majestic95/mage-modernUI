import { describe, expect, it } from 'vitest';
import { opponentRowClassname, selectOpponents } from './battlefieldLayout';
import { webPlayerViewSchema, type WebPlayerView } from '../api/schemas';

function basePlayer(overrides: Partial<WebPlayerView>): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId: '00000000-0000-0000-0000-000000000000',
    name: 'p',
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    ...overrides,
  });
}

/**
 * Slice 69b (ADR 0010 v2 D5) — opponent-row layout invariants.
 *
 * The full Battlefield component pulls in GameStream + store + dialog
 * router and is exercised end-to-end via the e2e specs in slice 69e.
 * What's worth locking here is the *className branching*: the
 * D5-mandated layout shape per opponent count, so a future tweak can't
 * silently revert 4p FFA to a vertical stack (which fails the layout
 * audit at FFA densities).
 */
describe('Battlefield opponentRowClassname (slice 69b D5)', () => {
  it('1 opponent → vertical stack (1v1 unchanged)', () => {
    const cls = opponentRowClassname(1);
    expect(cls).toContain('space-y-4');
    expect(cls).not.toContain('grid');
  });

  it('0 opponents → vertical stack (degenerate "no opponents" message)', () => {
    // Empty-state message ("No opponents in this view.") renders inside
    // the same section. Vertical layout is correct for that string.
    const cls = opponentRowClassname(0);
    expect(cls).toContain('space-y-4');
    expect(cls).not.toContain('grid');
  });

  it('2 opponents → 2-col grid (3p FFA, 2HG opponent row)', () => {
    const cls = opponentRowClassname(2);
    expect(cls).toContain('grid grid-cols-2 gap-4');
    expect(cls).not.toContain('space-y-4');
  });

  it('3 opponents → 3-col grid (4p FFA)', () => {
    const cls = opponentRowClassname(3);
    expect(cls).toContain('grid grid-cols-3 gap-4');
    expect(cls).not.toContain('space-y-4');
  });

  it('4+ opponents → still 3-col (5p+ formats fall through, polished in v3)', () => {
    // v2 ships FFA up to 4p. 5p+ formats are deferred per ADR scope.
    // Falling through to 3-col rather than throwing keeps the UI
    // sane if a server somehow emits an unsupported format.
    expect(opponentRowClassname(4)).toContain('grid-cols-3');
    expect(opponentRowClassname(5)).toContain('grid-cols-3');
  });

  it('shape is stable (always carries the section base classes)', () => {
    // The base classes (flex-shrink-0, border-b, p-4) form the
    // contract the parent flex layout depends on. Any branch that
    // dropped them would push the opponents row off the screen.
    for (const n of [0, 1, 2, 3, 4]) {
      const cls = opponentRowClassname(n);
      expect(cls).toContain('flex-shrink-0');
      expect(cls).toContain('border-b');
      expect(cls).toContain('p-4');
    }
  });
});

describe('Battlefield selectOpponents (slice 69b D11a)', () => {
  const ME = '11111111-1111-1111-1111-111111111111';
  const A = '22222222-2222-2222-2222-222222222222';
  const B = '33333333-3333-3333-3333-333333333333';
  const C = '44444444-4444-4444-4444-444444444444';

  it('drops the local player (1v1 → 1 opponent)', () => {
    const players = [
      basePlayer({ playerId: ME, name: 'me' }),
      basePlayer({ playerId: A, name: 'opp' }),
    ];
    const result = selectOpponents(players, ME);
    expect(result).toHaveLength(1);
    expect(result[0]?.playerId).toBe(A);
  });

  it('drops eliminated opponents (4p FFA, one player has left)', () => {
    // ADR D11a — eliminated player's seat collapses out of the
    // opponents row entirely in v2. The collapsed-stub variant is
    // tracked for slice 69d polish.
    const players = [
      basePlayer({ playerId: ME, name: 'me' }),
      basePlayer({ playerId: A, name: 'alice' }),
      basePlayer({ playerId: B, name: 'bob', hasLeft: true }),
      basePlayer({ playerId: C, name: 'carol' }),
    ];
    const result = selectOpponents(players, ME);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.playerId)).toEqual([A, C]);
  });

  it('drops the local player even if they have left (degenerate)', () => {
    // The local player can't appear in the opponents row regardless
    // of their hasLeft state — that's a state for the self-section
    // to handle, not the opponents loop.
    const players = [
      basePlayer({ playerId: ME, name: 'me', hasLeft: true }),
      basePlayer({ playerId: A, name: 'opp' }),
    ];
    const result = selectOpponents(players, ME);
    expect(result).toHaveLength(1);
    expect(result[0]?.playerId).toBe(A);
  });

  it('preserves turn order from upstream', () => {
    // Order matters for D5 layout (clockwise tab order) and for
    // priority-pass visual flow. Filter must NOT reorder.
    const players = [
      basePlayer({ playerId: ME }),
      basePlayer({ playerId: C, name: 'carol' }),
      basePlayer({ playerId: A, name: 'alice' }),
      basePlayer({ playerId: B, name: 'bob' }),
    ];
    const result = selectOpponents(players, ME);
    expect(result.map((p) => p.playerId)).toEqual([C, A, B]);
  });

  it('returns empty when local player is alone (spectator-style edge case)', () => {
    const result = selectOpponents([basePlayer({ playerId: ME })], ME);
    expect(result).toEqual([]);
  });
});
