import { afterEach, describe, expect, it, vi } from 'vitest';
import { webPlayerViewSchema, type WebPlayerView } from '../api/schemas';

// Slice 70-D — feature-flag mock. Hoisted state so tests can flip
// the flag between describe blocks without rebuilding the module.
// The mock returns a getter so each call to KEEP_ELIMINATED re-reads
// the flag's current value.
const flagState = vi.hoisted(() => ({ keepEliminated: false }));

vi.mock('../featureFlags', () => ({
  get KEEP_ELIMINATED() {
    return flagState.keepEliminated;
  },
}));

import {
  formatEliminationAnnouncement,
  gridAreaForOpponent,
  selectOpponents,
} from './battlefieldLayout';

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
describe('Battlefield gridAreaForOpponent (slice 70-E D5)', () => {
  // Slice 70-E replaced opponentRowClassname (flat-row helper) with
  // a grid-area lookup for the new 4-pod arrangement: opponents at
  // top/left/right, self at bottom, central focal zone (Stack) in
  // the middle. The clockwise convention from slice 69b D13 is
  // preserved — opp-right (idx 0) → opp-top (idx 1) → opp-left
  // (idx 2) for 4p FFA.

  it('1 opponent (1v1) → top', () => {
    expect(gridAreaForOpponent(0, 1)).toBe('top');
  });

  it('2 opponents (3p FFA) → idx 0: right, idx 1: top', () => {
    // Cross-table read: opponent-right + opponent-opposite. Spec §2
    // doesn't lock 3p, but right+top reads more naturally than
    // right+left (which would leave the top empty).
    expect(gridAreaForOpponent(0, 2)).toBe('right');
    expect(gridAreaForOpponent(1, 2)).toBe('top');
  });

  it('3 opponents (4p FFA) → clockwise right/top/left', () => {
    expect(gridAreaForOpponent(0, 3)).toBe('right');
    expect(gridAreaForOpponent(1, 3)).toBe('top');
    expect(gridAreaForOpponent(2, 3)).toBe('left');
  });

  it('4+ opponents (5p+ unsupported format) → idx ≥ 3 falls back to top', () => {
    // v2 ships FFA up to 4p. Falling back to 'top' keeps the UI
    // sane if a server somehow emits an unsupported format
    // (engine supports up to 10 players).
    expect(gridAreaForOpponent(3, 4)).toBe('top');
    expect(gridAreaForOpponent(4, 5)).toBe('top');
  });

  it('returns one of the three valid grid areas for any input', () => {
    // Type-safety check: every (idx, count) pair lands on a known
    // area. The 4-pod grid template only declares top/left/right/
    // bottom/center; opponent positions are top/left/right.
    const valid = new Set(['top', 'left', 'right']);
    for (let count = 1; count <= 6; count++) {
      for (let idx = 0; idx < count; idx++) {
        expect(valid.has(gridAreaForOpponent(idx, count))).toBe(true);
      }
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

  it('flag-off (legacy): drops eliminated opponents (4p FFA)', () => {
    // ADR 0010 D11a — flag-off keeps the legacy collapse: an
    // eliminated player's seat disappears from the opponents row.
    // Slice 70-E flips KEEP_ELIMINATED to true; until then this
    // path is the production behavior.
    flagState.keepEliminated = false;
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

  // Slice 70-D (ADR 0011 D2 amended) — flag-on companion. Both
  // tests pin behavior; per critic I6 the legacy test is NOT
  // inverted (would silently lose the flag-off lock).
  it('flag-on: KEEPS eliminated opponents in the layout for slash overlay', () => {
    flagState.keepEliminated = true;
    const players = [
      basePlayer({ playerId: ME, name: 'me' }),
      basePlayer({ playerId: A, name: 'alice' }),
      basePlayer({ playerId: B, name: 'bob', hasLeft: true }),
      basePlayer({ playerId: C, name: 'carol' }),
    ];
    const result = selectOpponents(players, ME);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.playerId)).toEqual([A, B, C]);
    // Bob's hasLeft signal is preserved on the kept entry —
    // PlayerFrame branches on it to render the slash overlay.
    expect(result.find((p) => p.playerId === B)?.hasLeft).toBe(true);
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

  // Reset flag between describe blocks so cross-file test ordering
  // doesn't leak the flag-on state into unrelated assertions.
  afterEach(() => {
    flagState.keepEliminated = false;
  });
});

describe('Battlefield formatEliminationAnnouncement (slice 69d D11a + D13)', () => {
  // Lock the announcer text shape so a future refactor can't drift
  // the format (e.g., "Eliminated:" → "Players out:" or
  // ", " → " and ") and silently garble screen-reader output.

  it('returns empty string when no player has left', () => {
    // Empty result avoids triggering the live region's atomic
    // boundary — the region remains silent until something to
    // announce arrives.
    const players = [
      basePlayer({ playerId: '11111111-1111-1111-1111-111111111111' }),
      basePlayer({ playerId: '22222222-2222-2222-2222-222222222222' }),
    ];
    expect(formatEliminationAnnouncement(players)).toBe('');
  });

  it('announces a single eliminated player by name', () => {
    const players = [
      basePlayer({
        playerId: '11111111-1111-1111-1111-111111111111',
        name: 'alice',
      }),
      basePlayer({
        playerId: '22222222-2222-2222-2222-222222222222',
        name: 'bob',
        hasLeft: true,
      }),
    ];
    expect(formatEliminationAnnouncement(players)).toBe('Eliminated: bob');
  });

  it('announces multiple eliminated players comma-separated', () => {
    // 4p FFA late-game: alice + carol both out; bob and dave still
    // playing. Order follows the players array (turn order from
    // upstream); the announcer doesn't re-sort.
    const players = [
      basePlayer({
        playerId: '11111111-1111-1111-1111-111111111111',
        name: 'alice',
        hasLeft: true,
      }),
      basePlayer({
        playerId: '22222222-2222-2222-2222-222222222222',
        name: 'bob',
      }),
      basePlayer({
        playerId: '33333333-3333-3333-3333-333333333333',
        name: 'carol',
        hasLeft: true,
      }),
      basePlayer({
        playerId: '44444444-4444-4444-4444-444444444444',
        name: 'dave',
      }),
    ];
    expect(formatEliminationAnnouncement(players)).toBe(
      'Eliminated: alice, carol',
    );
  });

  it('falls back to "unknown" for missing names rather than crashing', () => {
    // Defensive — a malformed PlayerView with name="" shouldn't
    // produce "Eliminated: " (trailing colon, no content). Better
    // a degraded "Eliminated: unknown" announcement than a silent
    // a11y regression.
    const players = [
      basePlayer({
        playerId: '11111111-1111-1111-1111-111111111111',
        name: '',
        hasLeft: true,
      }),
    ];
    expect(formatEliminationAnnouncement(players)).toBe(
      'Eliminated: unknown',
    );
  });

  it('ignores players with hasLeft=false even when name suggests prior elimination', () => {
    // Sanity check: the filter is on hasLeft, not on any name
    // heuristic. A player named "DEFEATED" who's still in-game is
    // not announced.
    const players = [
      basePlayer({
        playerId: '11111111-1111-1111-1111-111111111111',
        name: 'DEFEATED',
        hasLeft: false,
      }),
    ];
    expect(formatEliminationAnnouncement(players)).toBe('');
  });

  // Slice 70-D (ADR 0011 D2 amended) — flag-on path silences the
  // announcer. The kept seat's PlayerFrame aria-label conveys the
  // same signal once at the seat level; the slash overlay carries
  // the visual cue. Critic I8 — double-firing produces SR spam.
  it('flag-on: returns empty even when players have left (PlayerFrame aria-label takes over)', () => {
    flagState.keepEliminated = true;
    const players = [
      basePlayer({
        playerId: '11111111-1111-1111-1111-111111111111',
        name: 'alice',
        hasLeft: true,
      }),
      basePlayer({
        playerId: '22222222-2222-2222-2222-222222222222',
        name: 'bob',
        hasLeft: true,
      }),
    ];
    expect(formatEliminationAnnouncement(players)).toBe('');
  });

  afterEach(() => {
    flagState.keepEliminated = false;
  });
});
