/**
 * Slice 70-A (ADR 0011 D1) — placeholder route for `/spectate/:gameId`.
 *
 * The server-side spectator route shipped in slice 71
 * (`/api/games/{gameId}/spectate` WebSocket endpoint, with same-gameId
 * XOR + read-only inbound + per-route broadcast filter). Client-side
 * spectator UI is deferred to a future v2.x slice — see
 * `docs/decisions/0011-design-system-adoption.md` D1 for the full
 * deferral rationale.
 *
 * <p>Without this placeholder, a user pasting a spectate URL hits a
 * white screen / SPA route miss / generic 404 — indistinguishable
 * from a bug. The placeholder renders an explicit "shipping in v2.x"
 * message with the gameId echoed back, so the user knows they hit
 * the right endpoint and the feature is genuinely deferred, not
 * broken.
 *
 * <p>Lifted layout from `Login.tsx` for consistency with the auth gate
 * empty state. Once Phase 7 light theme lands, the same token surface
 * here will theme alongside the rest of the app.
 */
export function SpectatorPlaceholder({ gameId }: { gameId: string }) {
  // Slice 70-A (ADR 0011 D4) — net-new component using design-system
  // tokens from the start. The "Return to lobby" CTA uses
  // bg-accent-primary (Tailwind violet-500) — distinct from
  // --color-team-active-glow (fuchsia-500). Mixing them would defeat
  // the ADR's accent-vs-active separation that the End Step button
  // exists to establish. Game-ID echo card uses bg-bg-elevated +
  // border-card-frame-default for the same reason.
  return (
    <main className="min-h-screen bg-bg-base text-text-primary flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Spectator mode
        </h1>
        <p className="text-text-secondary leading-relaxed">
          The spectator UI is shipping in v2.x. The server-side route is
          live; the client-side viewer experience is part of a future
          slice tracked in{' '}
          <code
            className="bg-bg-elevated px-1.5 py-0.5 rounded text-sm"
            style={{ color: 'var(--color-accent-primary-hover)' }}
          >
            docs/decisions/0011-design-system-adoption.md
          </code>{' '}
          D1.
        </p>
        <div className="bg-bg-elevated rounded-lg p-4 text-left"
             style={{ border: '1px solid var(--color-card-frame-default)' }}>
          <div className="text-xs text-text-muted mb-1">Game ID</div>
          <code
            className="font-mono text-sm text-text-primary break-all"
            data-testid="spectator-placeholder-game-id"
          >
            {gameId}
          </code>
        </div>
        <a
          href="/"
          className="inline-block px-5 py-2 rounded-md bg-accent-primary hover:bg-accent-primary-hover text-text-on-accent font-medium transition-colors"
        >
          Return to lobby
        </a>
      </div>
    </main>
  );
}

