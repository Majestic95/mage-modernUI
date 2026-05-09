import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useGameStore } from './store';
import { buildDemoGameView } from './devFixtures';
import { TurnEdgeGlow } from './TurnEdgeGlow';

const SELF_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function setSelf(opts: {
  isActive: boolean;
  hasPriority?: boolean;
  colorIdentity?: string[];
  hasLeft?: boolean;
}) {
  const gv = buildDemoGameView();
  const opponent = gv.players.find((p) => p.playerId !== SELF_ID);
  const opponentId = opponent?.playerId ?? '';
  useGameStore.setState({
    gameView: {
      ...gv,
      myPlayerId: SELF_ID,
      players: gv.players.map((p) => {
        if (p.playerId === SELF_ID) {
          return {
            ...p,
            isActive: opts.isActive,
            hasPriority: opts.hasPriority ?? opts.isActive,
            colorIdentity: opts.colorIdentity ?? p.colorIdentity,
            hasLeft: opts.hasLeft ?? false,
          };
        }
        // Opponent gets the inverse of self's active state.
        return {
          ...p,
          isActive: !opts.isActive && p.playerId === opponentId,
          hasPriority: !opts.isActive && p.playerId === opponentId,
        };
      }),
    },
  });
}

describe('TurnEdgeGlow', () => {
  afterEach(() => {
    useGameStore.setState({ gameView: null });
  });

  it("renders the ring when it's the player's turn (isActive=true)", () => {
    setSelf({ isActive: true });
    render(<TurnEdgeGlow />);
    expect(screen.getByTestId('turn-edge-glow')).toBeInTheDocument();
  });

  it('renders nothing when it is the opponent turn (self.isActive=false)', () => {
    setSelf({ isActive: false });
    render(<TurnEdgeGlow />);
    expect(screen.queryByTestId('turn-edge-glow')).toBeNull();
  });

  it('renders nothing when self has priority but it is NOT their turn', () => {
    // E.g. opponent casts a spell, you have priority to respond.
    setSelf({ isActive: false, hasPriority: true });
    render(<TurnEdgeGlow />);
    expect(screen.queryByTestId('turn-edge-glow')).toBeNull();
  });

  it('renders nothing when there is no gameView', () => {
    useGameStore.setState({ gameView: null });
    render(<TurnEdgeGlow />);
    expect(screen.queryByTestId('turn-edge-glow')).toBeNull();
  });

  it('paints a single solid mana-color background for mono-color commanders', () => {
    setSelf({ isActive: true, colorIdentity: ['R'] });
    render(<TurnEdgeGlow />);
    const ring = screen.getByTestId('turn-edge-glow');
    expect(ring.style.background).toContain('var(--color-mana-red)');
    expect(ring.getAttribute('data-color-identity')).toBe('R');
  });

  it('paints a banded conic-gradient for multicolor commanders', () => {
    setSelf({ isActive: true, colorIdentity: ['W', 'R'] });
    render(<TurnEdgeGlow />);
    const ring = screen.getByTestId('turn-edge-glow');
    expect(ring.style.background).toContain('conic-gradient');
    expect(ring.style.background).toContain('var(--halo-angle');
    expect(ring.style.background).toContain('var(--color-mana-white)');
    expect(ring.style.background).toContain('var(--color-mana-red)');
    expect(ring.getAttribute('data-color-identity')).toBe('WR');
  });

  it('falls back to the neutral team color for colorless commanders', () => {
    setSelf({ isActive: true, colorIdentity: [] });
    render(<TurnEdgeGlow />);
    const ring = screen.getByTestId('turn-edge-glow');
    expect(ring.style.background).toContain('var(--color-team-neutral)');
    expect(ring.getAttribute('data-color-identity')).toBe('C');
  });

  it('the ring is pointer-events-none + aria-hidden so it never intercepts input or screen-reader output', () => {
    setSelf({ isActive: true });
    render(<TurnEdgeGlow />);
    const ring = screen.getByTestId('turn-edge-glow');
    expect(ring.className).toContain('pointer-events-none');
    expect(ring.getAttribute('aria-hidden')).toBe('true');
  });
});
