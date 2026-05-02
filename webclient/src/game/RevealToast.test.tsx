/**
 * Bug fix (2026-05-02) — reveal toast tests.
 *
 * Two layers under test:
 *   1. Store reducer detects "<player> reveals <card>" gameInform
 *      messages and queues them in {@code recentReveals}.
 *   2. {@link RevealToast} component renders unexpired entries and
 *      stops rendering them after {@link REVEAL_TOAST_TTL_MS}.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  webGameClientMessageSchema,
  webStreamFrameSchema,
} from '../api/schemas';
import { REVEAL_TOAST_TTL_MS, useGameStore } from './store';
import { RevealToast } from './RevealToast';

function makeInformFrame(message: string, messageId = 1) {
  const wrapped = webGameClientMessageSchema.parse({
    gameView: null,
    message,
    targets: [],
    cardsView1: {},
    min: 0,
    max: 0,
    flag: false,
    choice: null,
  });
  const frame = webStreamFrameSchema.parse({
    schemaVersion: '1.15',
    method: 'gameInform',
    messageId,
    objectId: null,
    data: wrapped,
  });
  return { frame, wrapped };
}

describe('RevealToast — reveal-detection reducer', () => {
  afterEach(() => {
    useGameStore.getState().reset();
  });

  it('appends a reveal entry when a gameInform with "reveals" arrives', () => {
    const { frame, wrapped } = makeInformFrame('alice reveals Lightning Bolt');
    act(() => {
      useGameStore.getState().applyFrame(frame, wrapped);
    });
    const reveals = useGameStore.getState().recentReveals;
    expect(reveals).toHaveLength(1);
    expect(reveals[0].message).toContain('reveals Lightning Bolt');
  });

  it('does NOT push a reveal entry for unrelated gameInform messages', () => {
    const { frame, wrapped } = makeInformFrame('alice draws a card', 2);
    act(() => {
      useGameStore.getState().applyFrame(frame, wrapped);
    });
    expect(useGameStore.getState().recentReveals).toHaveLength(0);
  });
});

describe('RevealToast — TTL-based rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useGameStore.getState().reset();
  });

  it('renders an unexpired reveal then hides it after the TTL', () => {
    const t0 = Date.now();
    act(() => {
      useGameStore.setState({
        recentReveals: [
          { id: 1, message: 'alice reveals Lightning Bolt', addedAt: t0 },
        ],
      });
    });
    render(<RevealToast />);
    expect(screen.getByTestId('reveal-toast')).toHaveTextContent(
      /reveals Lightning Bolt/i,
    );

    act(() => {
      vi.advanceTimersByTime(REVEAL_TOAST_TTL_MS + 500);
    });
    expect(screen.queryByTestId('reveal-toast')).toBeNull();
  });

  it('mounts nothing when the recentReveals queue is empty', () => {
    render(<RevealToast />);
    expect(screen.queryByTestId('reveal-toast-stack')).toBeNull();
  });
});
