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
  /** Submitting state — disables the button while the start request is in flight. */
  submitting?: boolean;
  onStart?: () => void;
}

export function StartGameButton({
  enabled,
  isHost,
  allReady,
  submitting = false,
  onStart,
}: Props) {
  const interactive = enabled && !submitting;
  const subtitle = submitting
    ? 'Starting…'
    : !isHost
      ? 'Only the host can start'
      : !allReady
        ? 'All players must be ready'
        : 'Ready to play';
  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        data-testid="start-game-button"
        data-enabled={interactive || undefined}
        disabled={!interactive}
        onClick={() => {
          if (interactive && onStart) onStart();
        }}
        className="relative rounded-xl px-10 py-3 text-xl font-semibold uppercase tracking-wide transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        style={{
          background: interactive
            ? 'linear-gradient(180deg, #FF8C42 0%, #E5602A 100%)'
            : 'var(--color-bg-elevated)',
          color: interactive ? '#1A0F05' : 'var(--color-text-secondary)',
          boxShadow: interactive
            ? '0 6px 20px rgba(229, 96, 42, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25)'
            : 'var(--shadow-low)',
          border: interactive
            ? '1px solid rgba(255, 140, 66, 0.6)'
            : '1px solid var(--color-card-frame-default)',
          cursor: interactive ? 'pointer' : 'not-allowed',
          letterSpacing: '0.04em',
          opacity: interactive ? 1 : 0.85,
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
