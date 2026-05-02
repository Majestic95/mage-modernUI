/**
 * Slice L1 — single occupied seat in the seat row. Shows portrait,
 * name + commander subtitle, full commander card art, deck plate,
 * and ready status.
 */
import type { LobbySeat } from './fixtures';
import { LobbySeatPortrait } from './LobbySeatPortrait';

interface Props {
  seat: LobbySeat;
  /** Pulses the active border when this seat belongs to the viewer. */
  isCurrentUser: boolean;
}

export function SeatCard({ seat, isCurrentUser }: Props) {
  return (
    <div
      data-testid="seat-card"
      data-host={seat.isHost || undefined}
      data-ready={seat.ready || undefined}
      data-current={isCurrentUser || undefined}
      className="relative flex flex-col items-center gap-3 rounded-xl border p-4 transition-colors"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        borderColor: isCurrentUser
          ? 'var(--color-accent-primary)'
          : 'var(--color-card-frame-default)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      {/* Portrait + name block */}
      <div className="flex w-full flex-col items-center gap-1.5 pt-2">
        <LobbySeatPortrait
          name={seat.playerName}
          artUrl={seat.commanderArtUrl}
          colorIdentity={seat.colorIdentity}
          isHost={seat.isHost}
          isReady={seat.ready}
          isActive={false}
        />
        <div className="mt-1 text-center">
          <p className="text-base font-semibold leading-tight text-text-primary">
            {seat.playerName}
          </p>
          {seat.subtitle && (
            <p className="text-xs text-text-secondary">{seat.subtitle}</p>
          )}
        </div>
      </div>

      {/* Commander card */}
      <CommanderCard
        cardImageUrl={seat.commanderCardImageUrl}
        commanderName={seat.commanderName}
      />

      {/* Deck plate */}
      <DeckPlate
        deckName={seat.deckName}
        size={seat.deckSize}
        required={seat.deckRequired}
        artUrl={seat.commanderArtUrl}
      />

      {/* Ready status */}
      <ReadyStatus ready={seat.ready} />
    </div>
  );
}

function CommanderCard({
  cardImageUrl,
  commanderName,
}: {
  cardImageUrl: string | null;
  commanderName: string;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      style={{
        aspectRatio: '5 / 7',
        background: 'var(--color-surface-card)',
        boxShadow: 'var(--shadow-medium)',
        border: '1px solid var(--color-card-frame-default)',
      }}
    >
      {cardImageUrl ? (
        <img
          src={cardImageUrl}
          alt={commanderName}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-3 text-center text-xs text-text-muted">
          {commanderName || 'No commander selected'}
        </div>
      )}
    </div>
  );
}

function DeckPlate({
  deckName,
  size,
  required,
  artUrl,
}: {
  deckName: string;
  size: number;
  required: number;
  artUrl: string | null;
}) {
  const valid = size === required && size > 0;
  return (
    <div
      data-testid="seat-deck-plate"
      className="flex w-full items-center gap-3 rounded-lg border border-card-frame-default/60 p-2"
      style={{ background: 'var(--color-surface-card)' }}
    >
      <div
        className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md"
        style={{ background: 'var(--color-bg-elevated)' }}
      >
        {artUrl ? (
          <img
            src={artUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col">
        <p
          className="truncate text-sm font-medium text-text-primary"
          title={deckName}
        >
          {deckName}
        </p>
        <p
          className={
            'text-xs ' +
            (valid ? 'text-text-secondary' : 'text-status-warning')
          }
        >
          {size}/{required} Cards
        </p>
      </div>
    </div>
  );
}

function ReadyStatus({ ready }: { ready: boolean }) {
  return (
    <div
      data-testid="seat-ready-status"
      data-ready={ready || undefined}
      className={
        'flex items-center gap-1.5 text-xs font-semibold uppercase ' +
        (ready ? 'text-status-success' : 'text-text-muted')
      }
      style={{ letterSpacing: '0.1em' }}
    >
      {ready ? <CheckIcon /> : <CircleIcon />}
      <span>{ready ? 'Ready' : 'Not Ready'}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3,8 7,12 13,4" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}
