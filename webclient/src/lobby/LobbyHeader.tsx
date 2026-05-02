/**
 * Slice L1 — page header. Title + subtitle on the left, central
 * status pill summarizing seat readiness.
 */
import type { LobbyFormatId, LobbyModeId } from './fixtures';

const FORMAT_LABEL: Record<LobbyFormatId, string> = {
  commander: 'Commander',
  standard: 'Standard',
  modern: 'Modern',
  pauper: 'Pauper',
};

const MODE_LABEL: Record<LobbyModeId, string> = {
  'free-for-all': 'Free-for-All',
  'two-player-duel': '1v1 Duel',
  'two-headed-giant': 'Two-Headed Giant',
  'tiny-leaders': 'Tiny Leaders',
};

interface Props {
  format: LobbyFormatId;
  mode: LobbyModeId;
  playerCount: number;
  readyCount: number;
  totalSeats: number;
}

export function LobbyHeader({
  format,
  mode,
  playerCount,
  readyCount,
  totalSeats,
}: Props) {
  const formatLabel = FORMAT_LABEL[format] ?? format;
  const modeLabel = MODE_LABEL[mode] ?? mode;
  const allReady = readyCount === totalSeats;
  const statusLabel = allReady ? 'READY TO START' : 'WAITING FOR PLAYERS';

  return (
    <header
      data-testid="lobby-header"
      className="grid items-end gap-4 pt-4"
      style={{ gridTemplateColumns: '1fr auto 1fr' }}
    >
      <div className="flex flex-col gap-1">
        <h1
          data-testid="lobby-title"
          className="font-semibold uppercase leading-tight"
          style={{
            fontSize: 'var(--font-size-display)',
            letterSpacing: '0.04em',
          }}
        >
          <span className="text-text-primary">{formatLabel}</span>{' '}
          <span className="text-accent-primary">Lobby</span>
        </h1>
        <p
          data-testid="lobby-subtitle"
          className="text-sm text-text-secondary"
          style={{ letterSpacing: '0.02em' }}
        >
          {modeLabel} · {playerCount} Players
        </p>
      </div>

      <StatusPill
        label={statusLabel}
        readyCount={readyCount}
        totalSeats={totalSeats}
        allReady={allReady}
      />

      <div aria-hidden="true" />
    </header>
  );
}

function StatusPill({
  label,
  readyCount,
  totalSeats,
  allReady,
}: {
  label: string;
  readyCount: number;
  totalSeats: number;
  allReady: boolean;
}) {
  const accentClass = allReady
    ? 'border-status-success/60 text-status-success'
    : 'border-card-frame-default/80 text-text-primary';
  return (
    <div
      data-testid="lobby-status-pill"
      data-all-ready={allReady || undefined}
      className={
        'flex flex-col items-center gap-0.5 rounded-xl border px-6 py-3 text-center backdrop-blur-sm ' +
        accentClass
      }
      style={{
        background: 'rgba(26, 38, 48, 0.7)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <span
        className="text-xs font-semibold uppercase"
        style={{ letterSpacing: '0.12em' }}
      >
        {label}
      </span>
      <span className="text-sm text-text-secondary">
        <span className="font-semibold text-text-primary">{readyCount}</span> /{' '}
        {totalSeats} Players Ready
      </span>
    </div>
  );
}
