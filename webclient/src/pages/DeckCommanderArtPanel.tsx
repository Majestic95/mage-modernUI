/**
 * Deck-builder workbench's right-column commander art slot.
 * Deck-builder-specific (no shared rendering with the lobby's
 * CommanderPreviewPanel) per the 2026-05-12 separation directive —
 * deck builder and lobby are separate entities, even if both surface
 * the commander somewhere.
 *
 * <p>Renders just the large card image; the oracle text + name +
 * mana cost + P/T live in the workbench's bottom-row
 * {@link DeckCommanderDetailsPanel}.
 *
 * <p>Image sizing: h-full inside its flex column row, width derived
 * from aspect-ratio 5/7, capped at max-w-full so a narrow column
 * can't let height-driven width overflow horizontally (the bug that
 * showed up in the original 2-column lobby-shaped layout).
 */
import { lobbyCardImageUrl, type LobbyDeck } from '../lobby/fixtures';

interface Props {
  deck: LobbyDeck | null;
}

export function DeckCommanderArtPanel({ deck }: Props) {
  const commanderName =
    deck?.commanderName?.trim() || deck?.displayCardName?.trim() || '';
  const imageUrl =
    chosenPrintingNormalUrl(deck?.commanderArtUrl ?? null)
    ?? chosenPrintingNormalUrl(deck?.displayCardArtUrl ?? null)
    ?? (commanderName ? lobbyCardImageUrl(commanderName) : null);

  return (
    <section
      data-testid="deck-commander-art-panel"
      className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-card-frame-default/60 p-3"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <header className="flex items-baseline justify-between">
        <h2
          className="text-xs font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.14em' }}
        >
          {deck?.commanderName ? 'Commander' : 'Display Card'}
        </h2>
      </header>

      {!deck || !commanderName || !imageUrl ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center rounded-lg text-sm text-text-muted"
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-card-frame-default)',
          }}
        >
          {deck ? 'No card selected' : 'Pick a deck'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start justify-center">
          <div
            className="relative h-full max-w-full overflow-hidden rounded-lg"
            style={{
              aspectRatio: '5 / 7',
              background: 'var(--color-surface-card)',
              boxShadow: 'var(--shadow-medium)',
              border: '1px solid var(--color-card-frame-default)',
            }}
          >
            <img
              src={imageUrl}
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
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Promote the deck's stored art_crop URL to a normal-version URL.
 * Returns null when the input isn't a Scryfall printing URL we can
 * upgrade (caller falls back to by-name lookup).
 */
function chosenPrintingNormalUrl(artCropUrl: string | null): string | null {
  if (!artCropUrl) return null;
  if (!artCropUrl.includes('/cards/') || artCropUrl.includes('/cards/named'))
    return null;
  if (!artCropUrl.includes('version=art_crop')) return null;
  return artCropUrl.replace('version=art_crop', 'version=normal');
}
