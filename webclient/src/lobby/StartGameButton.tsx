/**
 * Slice L1 — host-only Start Game CTA + gating tooltip.
 *
 * <p>The orange treatment matches the reference mockup. It is the
 * lobby's single primary affordance — distinct from the in-game
 * accent-primary (purple) End Step button so it doesn't read as
 * "the same button context."
 */
interface Props {
  enabled: boolean;
  isHost: boolean;
  allReady: boolean;
}

export function StartGameButton({ enabled, isHost, allReady }: Props) {
  const subtitle = !isHost
    ? 'Only the host can start'
    : !allReady
      ? 'All players must be ready'
      : 'Ready to play';
  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        data-testid="start-game-button"
        data-enabled={enabled || undefined}
        disabled={!enabled}
        className="relative rounded-xl px-12 py-4 text-2xl font-semibold uppercase tracking-wide transition-all"
        style={{
          background: enabled
            ? 'linear-gradient(180deg, #FF8C42 0%, #E5602A 100%)'
            : 'var(--color-surface-card)',
          color: enabled ? '#1A0F05' : 'var(--color-text-muted)',
          boxShadow: enabled
            ? '0 6px 20px rgba(229, 96, 42, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25)'
            : 'var(--shadow-low)',
          border: enabled
            ? '1px solid rgba(255, 140, 66, 0.6)'
            : '1px solid var(--color-card-frame-default)',
          cursor: enabled ? 'pointer' : 'not-allowed',
          letterSpacing: '0.04em',
        }}
      >
        Start Game
      </button>
      <p
        data-testid="start-game-subtitle"
        className="text-xs text-text-secondary"
        style={{ letterSpacing: '0.04em' }}
      >
        {subtitle}
      </p>
    </div>
  );
}
