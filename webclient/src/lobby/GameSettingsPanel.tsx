/**
 * Slice L1 — left-column read-only summary of MatchOptions + host
 * Edit Settings button. Slice L4 wires the modal.
 */
import type { LobbyMatchOptions } from './fixtures';

const FORMAT_DISPLAY: Record<LobbyMatchOptions['format'], string> = {
  commander: 'Commander',
  standard: 'Standard',
  modern: 'Modern',
  pauper: 'Pauper',
};

interface Props {
  options: LobbyMatchOptions;
  isHost: boolean;
}

export function GameSettingsPanel({ options, isHost }: Props) {
  return (
    <aside
      data-testid="game-settings-panel"
      className="flex flex-col gap-4 rounded-xl border border-card-frame-default/60 p-5"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <h2
        className="text-xs font-semibold uppercase text-text-secondary"
        style={{ letterSpacing: '0.14em' }}
      >
        Game Settings
      </h2>

      <dl className="flex flex-col gap-3 text-sm">
        <SettingRow label="Format" value={FORMAT_DISPLAY[options.format]} />
        <SettingRow label="Starting Life" value={String(options.startingLife)} />
        {options.format === 'commander' && (
          <SettingRow
            label="Commander Damage"
            value={String(options.commanderDamage)}
          />
        )}
        <SettingRow label="Mulligan" value={options.mulliganLabel} />
        <SettingRow label="Privacy" value={options.privacyLabel} />
      </dl>

      {isHost && (
        <button
          type="button"
          data-testid="edit-settings-button"
          className="mt-2 rounded-md border border-card-frame-default/80 px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:border-accent-primary/60 hover:bg-surface-card-hover"
        >
          Edit Settings
        </button>
      )}
    </aside>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase text-text-muted" style={{ letterSpacing: '0.08em' }}>
        {label}
      </dt>
      <dd className="font-medium text-text-primary">{value}</dd>
    </div>
  );
}
