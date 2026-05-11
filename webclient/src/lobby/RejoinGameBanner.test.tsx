import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebMyGame } from '../api/schemas';
import { RejoinGameBanner } from './RejoinGameBanner';

const ONE_GAME: WebMyGame = {
  gameId: '11111111-1111-1111-1111-111111111111',
  tableId: '22222222-2222-2222-2222-222222222222',
  tableName: "alice's table",
  opponentNames: ['bob', 'carol'],
};

const TWO_GAMES: ReadonlyArray<WebMyGame> = [
  ONE_GAME,
  {
    gameId: '33333333-3333-3333-3333-333333333333',
    tableId: '44444444-4444-4444-4444-444444444444',
    tableName: 'late-night EDH',
    opponentNames: ['dave'],
  },
];

describe('RejoinGameBanner', () => {
  it('renders nothing when games list is empty', () => {
    const { container } = render(
      <RejoinGameBanner games={[]} onRejoin={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('rejoin-game-banner')).toBeNull();
  });

  it('renders one row with table name and opponents when one game is present', () => {
    render(<RejoinGameBanner games={[ONE_GAME]} onRejoin={() => {}} />);
    expect(screen.getByTestId('rejoin-game-banner')).toBeInTheDocument();
    // Singular header copy
    expect(
      screen.getByText('You have a game in progress'),
    ).toBeInTheDocument();
    expect(screen.getByText("alice's table")).toBeInTheDocument();
    expect(screen.getByText('vs bob, carol')).toBeInTheDocument();
    const rows = screen.getAllByTestId('rejoin-game-row');
    expect(rows).toHaveLength(1);
  });

  it('renders plural header and N rows when multiple games are present', () => {
    render(<RejoinGameBanner games={TWO_GAMES} onRejoin={() => {}} />);
    expect(
      screen.getByText('You have 2 games in progress'),
    ).toBeInTheDocument();
    const rows = screen.getAllByTestId('rejoin-game-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('late-night EDH')).toBeInTheDocument();
    expect(screen.getByText('vs dave')).toBeInTheDocument();
  });

  it('renders fallback when tableName is empty', () => {
    const blank: WebMyGame = { ...ONE_GAME, tableName: '' };
    render(<RejoinGameBanner games={[blank]} onRejoin={() => {}} />);
    expect(screen.getByText('Untitled table')).toBeInTheDocument();
  });

  it('omits the "vs ..." line when there are no opponent names', () => {
    const solo: WebMyGame = { ...ONE_GAME, opponentNames: [] };
    render(<RejoinGameBanner games={[solo]} onRejoin={() => {}} />);
    expect(screen.queryByText(/^vs /)).toBeNull();
    // Table name still renders.
    expect(screen.getByText("alice's table")).toBeInTheDocument();
  });

  it('calls onRejoin with the row gameId when the button is clicked', async () => {
    const user = userEvent.setup();
    const onRejoin = vi.fn();
    render(<RejoinGameBanner games={TWO_GAMES} onRejoin={onRejoin} />);
    // Each button's accessible name is "Rejoin <tableName>" so SR users
    // hear distinct labels per row. Match by regex.
    const buttons = screen.getAllByRole('button', { name: /^Rejoin / });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);
    expect(onRejoin).toHaveBeenCalledTimes(1);
    expect(onRejoin).toHaveBeenCalledWith(
      '33333333-3333-3333-3333-333333333333',
    );
  });

  it('collapses opponent list to "first +N more" when 3+ opponents', () => {
    const crowded: WebMyGame = {
      ...ONE_GAME,
      opponentNames: ['alice', 'bob', 'carol', 'dave'],
    };
    render(<RejoinGameBanner games={[crowded]} onRejoin={() => {}} />);
    expect(screen.getByText('vs alice +3 more')).toBeInTheDocument();
    // The collapsed names should NOT appear verbatim in the row.
    expect(screen.queryByText(/bob/)).toBeNull();
    expect(screen.queryByText(/carol/)).toBeNull();
  });

  it('preserves verbatim opponent list at exactly 2 opponents', () => {
    // Boundary check — N=2 stays as "vs a, b", N=3 flips to collapsed.
    render(<RejoinGameBanner games={[ONE_GAME]} onRejoin={() => {}} />);
    expect(screen.getByText('vs bob, carol')).toBeInTheDocument();
  });

  it('declares aria-live="polite" so mid-session arrivals are announced', () => {
    render(<RejoinGameBanner games={[ONE_GAME]} onRejoin={() => {}} />);
    const banner = screen.getByTestId('rejoin-game-banner');
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('uses per-row aria-label so SR users hear distinct buttons', () => {
    render(<RejoinGameBanner games={TWO_GAMES} onRejoin={() => {}} />);
    expect(
      screen.getByRole('button', { name: "Rejoin alice's table" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Rejoin late-night EDH' }),
    ).toBeInTheDocument();
  });
});
