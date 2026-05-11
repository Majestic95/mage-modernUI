/**
 * Bundle 5 / Slice 5-X.1 — lifecycle coverage for
 * {@link CardDeathSequence} (slice 5-D).
 *
 * <p>The diff that emits {@code creature_died} events is covered by
 * {@link gameDelta.test.ts}. This file mocks {@code useGameDelta}
 * so events can be fired directly, then asserts the DOM-mutation
 * side-effect contract: matching {@code [data-permanent-id]} nodes
 * receive the {@code animate-card-death-desaturate} class for
 * {@link CREATURE_DEATH_DESATURATE_MS}, multi-death frames apply
 * the class to every dying card simultaneously, multiple nodes
 * with the same {@code data-permanent-id} (duplicate-stack peek)
 * all get the class, and unmount cancels pending class removals.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../animation/gameDelta';
import { CREATURE_DEATH_DESATURATE_MS } from '../animation/transitions';
import { CardDeathSequence } from './CardDeathSequence';

const deltaMock = vi.hoisted(() => ({
  callback: null as ((events: GameEvent[]) => void) | null,
}));

vi.mock('../animation/useGameDelta', () => ({
  useGameDelta: (onEvents: (events: GameEvent[]) => void) => {
    deltaMock.callback = onEvents;
  },
}));

function fireEvents(events: GameEvent[]) {
  act(() => {
    deltaMock.callback?.(events);
  });
}

const DESATURATE_CLASS = 'animate-card-death-desaturate';

function appendPermanentNode(permanentId: string): HTMLElement {
  const node = document.createElement('div');
  node.setAttribute('data-permanent-id', permanentId);
  document.body.appendChild(node);
  return node;
}

function died(cardId: string, ownerSeat = 0): GameEvent {
  return { kind: 'creature_died', cardId, ownerSeat };
}

describe('CardDeathSequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deltaMock.callback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    // Remove any test-added nodes so subsequent tests start from
    // a clean DOM.
    for (const n of Array.from(
      document.querySelectorAll('[data-permanent-id]'),
    )) {
      n.remove();
    }
  });

  it('mounts a hidden sentinel with the expected testid', () => {
    const { getByTestId } = render(<CardDeathSequence />);
    const sentinel = getByTestId('card-death-sequence');
    expect(sentinel).toBeInTheDocument();
    // Sentinel is purely a mount-marker; should not visually paint.
    expect(sentinel.style.display).toBe('none');
  });

  it('adds the desaturate class to the matching permanent node on creature_died', () => {
    const node = appendPermanentNode('card-1');
    render(<CardDeathSequence />);
    fireEvents([died('card-1')]);
    expect(node.classList.contains(DESATURATE_CLASS)).toBe(true);
  });

  it('removes the desaturate class after CREATURE_DEATH_DESATURATE_MS', () => {
    const node = appendPermanentNode('card-1');
    render(<CardDeathSequence />);
    fireEvents([died('card-1')]);
    expect(node.classList.contains(DESATURATE_CLASS)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(CREATURE_DEATH_DESATURATE_MS);
    });
    expect(node.classList.contains(DESATURATE_CLASS)).toBe(false);
  });

  it('applies the class to ALL nodes sharing the same data-permanent-id (duplicate-stack peek)', () => {
    const a = appendPermanentNode('card-1');
    const b = appendPermanentNode('card-1');
    render(<CardDeathSequence />);
    fireEvents([died('card-1')]);
    expect(a.classList.contains(DESATURATE_CLASS)).toBe(true);
    expect(b.classList.contains(DESATURATE_CLASS)).toBe(true);
  });

  it('multi-death frame: every dying creature desaturates simultaneously', () => {
    const a = appendPermanentNode('card-1');
    const b = appendPermanentNode('card-2');
    const c = appendPermanentNode('card-3');
    render(<CardDeathSequence />);
    fireEvents([died('card-1'), died('card-2'), died('card-3')]);
    expect(a.classList.contains(DESATURATE_CLASS)).toBe(true);
    expect(b.classList.contains(DESATURATE_CLASS)).toBe(true);
    expect(c.classList.contains(DESATURATE_CLASS)).toBe(true);
  });

  it('non-creature_died events are ignored', () => {
    const node = appendPermanentNode('card-1');
    render(<CardDeathSequence />);
    fireEvents([
      { kind: 'cast', cardId: 'card-1', cinematic: false, colors: [], from: 'hand', ownerSeat: 0 },
      { kind: 'resolve_to_board', cardId: 'card-1', ownerSeat: 0 },
      { kind: 'permanent_exiled', cardId: 'card-1', ownerSeat: 0 },
    ]);
    expect(node.classList.contains(DESATURATE_CLASS)).toBe(false);
  });

  it('event for a missing permanent-id is a no-op (no crash)', () => {
    // Slice 5-D's `if (nodes.length === 0) continue;` guard. A death
    // event for a card whose battlefield node was already removed
    // (race with AnimatePresence exit) should NOT crash or leave
    // dangling timers.
    render(<CardDeathSequence />);
    expect(() => fireEvents([died('card-missing')])).not.toThrow();
    act(() => {
      vi.advanceTimersByTime(CREATURE_DEATH_DESATURATE_MS * 2);
    });
  });

  it('cancels pending class removals on unmount (timeouts cleared)', () => {
    const node = appendPermanentNode('card-1');
    const { unmount } = render(<CardDeathSequence />);
    fireEvents([died('card-1')]);
    expect(node.classList.contains(DESATURATE_CLASS)).toBe(true);
    unmount();
    // The cleanup timer-cancellation path. Advancing the timer past
    // CREATURE_DEATH_DESATURATE_MS would normally remove the class,
    // but with timers cleared the class STAYS on the node (it was
    // applied synchronously; only the removal callback is canceled).
    // This proves the cleanup happened — no orphan setTimeout
    // mutating the DOM after unmount.
    const beforeAdvance = node.classList.contains(DESATURATE_CLASS);
    act(() => {
      vi.advanceTimersByTime(CREATURE_DEATH_DESATURATE_MS * 2);
    });
    const afterAdvance = node.classList.contains(DESATURATE_CLASS);
    expect(beforeAdvance).toBe(true);
    expect(afterAdvance).toBe(true);
  });
});
