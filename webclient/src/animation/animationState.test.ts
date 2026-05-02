import { describe, expect, it, beforeEach } from 'vitest';
import {
  resetAnimationState,
  startCinematicCast,
  isCinematicCastActive,
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
