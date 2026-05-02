/**
 * Slice L1 — flex row of N seat cards (filled or open). Layout
 * reshapes for player count: 4 → 4 columns, 2 → centered 2-up,
 * 6 → 6 cards in a single row that scales down with the column.
 */
import type { LobbySeat } from './fixtures';
import { OpenSeatCard } from './OpenSeatCard';
import { SeatCard } from './SeatCard';

interface Props {
  seats: LobbySeat[];
  currentUsername: string;
}

export function SeatRow({ seats, currentUsername }: Props) {
  return (
    <div
      data-testid="seat-row"
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${seats.length}, minmax(0, 1fr))`,
      }}
    >
      {seats.map((seat) =>
        seat.occupied ? (
          <SeatCard
            key={seat.seatId}
            seat={seat}
            isCurrentUser={seat.playerName === currentUsername}
          />
        ) : (
          <OpenSeatCard key={seat.seatId} />
        ),
      )}
    </div>
  );
}
