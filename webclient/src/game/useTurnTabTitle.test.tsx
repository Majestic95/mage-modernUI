import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useGameStore } from './store';
import { buildDemoGameView } from './devFixtures';
import { useTurnTabTitle } from './useTurnTabTitle';

const SELF_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORIGINAL_TITLE = 'Modern Mage';
const PRIORITY_PREFIX = '🎲 Your turn — ';

function setSelfPriority(hasPriority: boolean) {
  const gv = buildDemoGameView();
  const opponent = gv.players.find((p) => p.playerId !== SELF_ID);
  const opponentId = opponent?.playerId ?? '';
  useGameStore.setState({
    gameView: {
      ...gv,
      myPlayerId: SELF_ID,
      players: gv.players.map((p) => ({
        ...p,
        isActive: hasPriority
          ? p.playerId === SELF_ID
          : p.playerId !== SELF_ID && p.playerId === opponentId,
        hasPriority: hasPriority
          ? p.playerId === SELF_ID
          : p.playerId !== SELF_ID && p.playerId === opponentId,
      })),
    },
  });
}

function Harness() {
  useTurnTabTitle();
  return null;
}

describe('useTurnTabTitle', () => {
  beforeEach(() => {
    document.title = ORIGINAL_TITLE;
    useGameStore.setState({ gameView: null });
  });
  afterEach(() => {
    document.title = ORIGINAL_TITLE;
    useGameStore.setState({ gameView: null });
  });

  it('does not modify the title when self does not have priority', () => {
    setSelfPriority(false);
    render(<Harness />);
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it('prefixes the title with the priority indicator when self has priority', () => {
    setSelfPriority(true);
    render(<Harness />);
    expect(document.title).toBe(PRIORITY_PREFIX + ORIGINAL_TITLE);
  });

  it('restores the original title on unmount', () => {
    setSelfPriority(true);
    const { unmount } = render(<Harness />);
    expect(document.title).toBe(PRIORITY_PREFIX + ORIGINAL_TITLE);
    unmount();
    expect(document.title).toBe(ORIGINAL_TITLE);
  });

  it('removes the prefix when priority leaves', () => {
    setSelfPriority(true);
    const { rerender } = render(<Harness />);
    expect(document.title).toBe(PRIORITY_PREFIX + ORIGINAL_TITLE);
    setSelfPriority(false);
    rerender(<Harness />);
    expect(document.title).toBe(ORIGINAL_TITLE);
  });
});
