import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useGameStore } from './store';
import { buildDemoGameView } from './devFixtures';
import { PriorityEdgeGlow } from './PriorityEdgeGlow';

const SELF_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

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

describe('PriorityEdgeGlow', () => {
  afterEach(() => {
    useGameStore.setState({ gameView: null });
  });

  it('renders the ring when the local player has priority', () => {
    setSelfPriority(true);
    render(<PriorityEdgeGlow />);
    expect(screen.getByTestId('priority-edge-glow')).toBeInTheDocument();
  });

  it('renders nothing when an opponent has priority', () => {
    setSelfPriority(false);
    render(<PriorityEdgeGlow />);
    expect(screen.queryByTestId('priority-edge-glow')).toBeNull();
  });

  it('renders nothing when there is no gameView', () => {
    useGameStore.setState({ gameView: null });
    render(<PriorityEdgeGlow />);
    expect(screen.queryByTestId('priority-edge-glow')).toBeNull();
  });

  it('the ring is pointer-events-none + aria-hidden so it never intercepts input or screen-reader output', () => {
    setSelfPriority(true);
    render(<PriorityEdgeGlow />);
    const ring = screen.getByTestId('priority-edge-glow');
    expect(ring.className).toContain('pointer-events-none');
    expect(ring.getAttribute('aria-hidden')).toBe('true');
  });
});
