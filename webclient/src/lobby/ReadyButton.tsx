/**
 * Slice L5 — guest-only Ready Up / Cancel Ready CTA.
 *
 * <p>Lives in the same bottom-right slot the host's
 * {@link StartGameButton} occupies; {@link NewLobbyScreen} renders
 * one or the other based on whether the local user is the host.
 * Visual treatment mirrors {@link StartGameButton}'s orange-when-
 * actionable, dim-when-not pattern so the two CTAs read as the same
 * affordance class.
 */
interface Props {
  ready: boolean;
  /** Disabled while the toggle request is in flight or session missing. */
  disabled?: boolean;
  onToggle: () => void;
}

export function ReadyButton({ ready, disabled = false, onToggle }: Props) {
  // When user is NOT ready, the button is the actionable green
  // "Ready Up" affordance. Once ready, it becomes a quieter
  // "Cancel Ready" button so they can unready themselves if needed.
  const enabled = !disabled;
  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        data-testid="ready-button"
        data-ready={ready || undefined}
        disabled={!enabled}
        onClick={onToggle}
        className="relative rounded-xl px-10 py-3 text-xl font-semibold uppercase tracking-wide transition-all"
        style={{
          background: ready
            ? 'var(--color-surface-card)'
            : enabled
              ? 'linear-gradient(180deg, #5BB872 0%, #3F9159 100%)'
              : 'var(--color-surface-card)',
          color: ready
            ? 'var(--color-text-secondary)'
            : enabled
              ? '#0A2412'
              : 'var(--color-text-muted)',
          boxShadow: ready
            ? 'var(--shadow-low)'
            : enabled
              ? '0 6px 20px rgba(91, 184, 114, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
              : 'var(--shadow-low)',
          border: ready
            ? '1px solid var(--color-status-success)'
            : enabled
              ? '1px solid rgba(91, 184, 114, 0.6)'
              : '1px solid var(--color-card-frame-default)',
          cursor: enabled ? 'pointer' : 'not-allowed',
          letterSpacing: '0.04em',
        }}
      >
        {ready ? 'Cancel Ready' : 'Ready Up'}
      </button>
      <p
        data-testid="ready-button-subtitle"
        className="text-xs text-text-secondary"
        style={{ letterSpacing: '0.04em' }}
      >
        {ready
          ? "You're ready — waiting on others"
          : 'Click when your deck is set'}
      </p>
    </div>
  );
}
