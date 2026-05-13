import { describe, expect, it, beforeEach } from 'vitest';
import {
  endFlightHide,
  isCinematicCastActive,
  isFlyingTo,
  resetAnimationState,
  snapshotFlyingTiles,
  startCinematicCast,
  startFlightHide,
  subscribeToAnimationState,
  __resetForTests,
} from './animationState';
import { castKindByCardId, exitKindByCardId } from './eventBus';

beforeEach(() => {
  __resetForTests();
});

describe('animationState', () => {
  it('resetAnimationState clears the active-cinematic set', () => {
    startCinematicCast('aaaa');
    expect(isCinematicCastActive('aaaa')).toBe(true);
    resetAnimationState();
    expect(isCinematicCastActive('aaaa')).toBe(false);
  });

  // P0 audit fix — the eventBus's per-cardId metadata Maps
  // (castKindByCardId, exitKindByCardId) accumulate one entry per
  // cast / per-permanent-leaving-battlefield across the whole game.
  // Without resetAnimationState clearing them between games, a long
  // session leaks stale entries indefinitely (memory + correctness:
  // a future "look up cast kind for cardId" path could read a wrong-
  // zone hit). Lock the cross-game clear here so a future refactor
  // that drops the .clear() calls breaks visibly.
  it('resetAnimationState clears castKindByCardId', () => {
    castKindByCardId.set('aaaa', 'cinematic');
    castKindByCardId.set('bbbb', 'standard');
    expect(castKindByCardId.size).toBe(2);
    resetAnimationState();
    expect(castKindByCardId.size).toBe(0);
  });

  it('resetAnimationState clears exitKindByCardId', () => {
    exitKindByCardId.set('aaaa', 'dust');
    exitKindByCardId.set('bbbb', 'exile');
    expect(exitKindByCardId.size).toBe(2);
    resetAnimationState();
    expect(exitKindByCardId.size).toBe(0);
  });

  it('__resetForTests also clears the eventBus Maps', () => {
    castKindByCardId.set('aaaa', 'cinematic');
    exitKindByCardId.set('bbbb', 'dust');
    __resetForTests();
    expect(castKindByCardId.size).toBe(0);
    expect(exitKindByCardId.size).toBe(0);
  });
});

// Playtester-feedback fix (2026-05-13, item 4) — flying-tiles set
// powers the synchronous-before-React-render hide of the destination
// battlefield tile while a ResolveFlightOverlay arc is in flight.
// Without this, the destination tile painted at opacity 1 the
// instant the layout-glide reached its slot, producing a one-frame
// visible duplicate alongside the arc.
describe('animationState — flying tiles', () => {
  it('startFlightHide + isFlyingTo + endFlightHide round-trip', () => {
    expect(isFlyingTo('card-1')).toBe(false);
    startFlightHide('card-1');
    expect(isFlyingTo('card-1')).toBe(true);
    endFlightHide('card-1');
    expect(isFlyingTo('card-1')).toBe(false);
  });

  it('supports multiple concurrent flights (cascade resolve)', () => {
    startFlightHide('card-a');
    startFlightHide('card-b');
    expect(isFlyingTo('card-a')).toBe(true);
    expect(isFlyingTo('card-b')).toBe(true);
    endFlightHide('card-a');
    expect(isFlyingTo('card-a')).toBe(false);
    expect(isFlyingTo('card-b')).toBe(true);
  });

  it('endFlightHide on a non-flying cardId is a no-op', () => {
    let fired = 0;
    const unsub = subscribeToAnimationState(() => {
      fired += 1;
    });
    endFlightHide('never-flew');
    expect(fired).toBe(0);
    unsub();
  });

  it('snapshotFlyingTiles returns a fresh Set each call', () => {
    startFlightHide('card-x');
    const snap1 = snapshotFlyingTiles();
    const snap2 = snapshotFlyingTiles();
    expect(snap1).not.toBe(snap2);
    expect(snap1.has('card-x')).toBe(true);
    expect(snap2.has('card-x')).toBe(true);
  });

  it('subscribers fire on both start and end', () => {
    let fired = 0;
    const unsub = subscribeToAnimationState(() => {
      fired += 1;
    });
    startFlightHide('card-y');
    expect(fired).toBe(1);
    endFlightHide('card-y');
    expect(fired).toBe(2);
    unsub();
  });

  it('resetAnimationState clears the flying-tiles set', () => {
    startFlightHide('card-z');
    expect(isFlyingTo('card-z')).toBe(true);
    resetAnimationState();
    expect(isFlyingTo('card-z')).toBe(false);
  });

  it('__resetForTests clears the flying-tiles set', () => {
    startFlightHide('card-q');
    __resetForTests();
    expect(isFlyingTo('card-q')).toBe(false);
  });

  // Technical critic 2026-05-13 — multiple endFlightHide call paths
  // exist (rAF early-return + overlay onComplete + safety setTimeout
  // + layer cancellation). They CAN fire in sequence for the same
  // cardId if the timing races: e.g., the rAF early-return fires
  // endFlightHide, then the safety setTimeout fires it again 850ms
  // later. The fireListeners gate uses Set.delete()'s return value,
  // so the second call is a no-op (no listener spam, no state
  // corruption). Lock that here.
  it('endFlightHide is idempotent across repeated calls', () => {
    let fired = 0;
    const unsub = subscribeToAnimationState(() => {
      fired += 1;
    });
    startFlightHide('card-idem');
    expect(fired).toBe(1);
    endFlightHide('card-idem');
    expect(fired).toBe(2);
    // Second + third call on a cardId that's already cleared must
    // not re-fire listeners and must not throw.
    endFlightHide('card-idem');
    endFlightHide('card-idem');
    expect(fired).toBe(2);
    expect(isFlyingTo('card-idem')).toBe(false);
    unsub();
  });
});
