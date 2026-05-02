/**
 * Slice L1 — bottom-center-right large commander art preview.
 * Lore paragraph from the mockup is intentionally omitted (locked
 * decision #13 — xmage card DB has no commander lore).
 */
import type { LobbyDeck } from './fixtures';

interface Props {
  deck: LobbyDeck | null;
}

export function CommanderPreviewPanel({ deck }: Props) {
  return (
    <section
      data-testid="commander-preview-panel"
      className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-card-frame-default/60 p-3"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <header>
        <h2
          className="text-xs font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.14em' }}
        >
          Commander Preview
        </h2>
      </header>

      {deck && deck.commanderArtUrl ? (
        <div
          className="relative min-h-0 flex-1 overflow-hidden rounded-lg"
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-card-frame-default)',
            boxShadow: 'var(--shadow-medium)',
          }}
        >
          <img
            src={deck.commanderArtUrl}
            alt={deck.commanderName}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          {/* Soft bottom-fade for the name plate. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{
              height: '40%',
              background:
                'linear-gradient(to top, rgba(14, 26, 32, 0.9) 0%, rgba(14, 26, 32, 0) 100%)',
            }}
          />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
            <p className="text-base font-semibold text-text-primary">
              {deck.commanderName}
            </p>
          </div>
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 items-center justify-center rounded-lg text-sm text-text-muted"
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-card-frame-default)',
          }}
        >
          No commander selected
        </div>
      )}
    </section>
  );
}
