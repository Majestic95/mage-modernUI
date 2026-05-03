/**
 * Commander preview — full card image on the left, Oracle text on
 * the right. Pulls card details from Scryfall via {@link useScryfallCard}
 * (cached per name). Falls back to the deck's local commanderArtUrl
 * crop if Scryfall is unreachable so the panel never goes blank.
 */
import { ManaCost, ManaText } from '../game/ManaCost';
import type { LobbyDeck } from './fixtures';
import { lobbyCardImageUrl } from './fixtures';
import { useScryfallCard } from './useScryfallCard';

interface Props {
  deck: LobbyDeck | null;
}

export function CommanderPreviewPanel({ deck }: Props) {
  const commanderName = deck?.commanderName?.trim() ?? '';
  const { card, loading, error } = useScryfallCard(
    commanderName.length > 0 ? commanderName : null,
  );

  return (
    <section
      data-testid="commander-preview-panel"
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
          Commander Preview
        </h2>
        {loading && (
          <span
            data-testid="commander-preview-loading"
            className="text-[10px] uppercase text-text-secondary"
            style={{ letterSpacing: '0.1em' }}
          >
            Loading…
          </span>
        )}
      </header>

      {!deck || !commanderName ? (
        <EmptyState />
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-3"
          style={{ gridTemplateColumns: 'auto 1fr' }}
        >
          <CardImage
            // Audit fix — honor the user's chosen commander printing.
            // deck.commanderArtUrl is the printing-aware art_crop URL
            // built in useLiveDecks.savedToLobbyDeck; derive the
            // normal-version URL by swapping the version param so the
            // big card image matches the seat preview + in-game art.
            // Falls back to Scryfall's by-name lookup (default
            // printing) only if the chosen-printing URL is missing
            // (older deck without setCode/cardNumber, etc.).
            imageUrl={
              chosenPrintingNormalUrl(deck.commanderArtUrl)
              ?? card?.imageUrl
              ?? lobbyCardImageUrl(commanderName)
            }
            commanderName={commanderName}
          />
          <CardDetails
            commanderName={commanderName}
            card={card}
            error={error}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Promote the LobbyDeck.commanderArtUrl (art_crop) to a normal-version
 * URL for the big card image. Returns null when the input doesn't look
 * like a Scryfall printing URL (e.g., the by-name fallback path).
 */
function chosenPrintingNormalUrl(artCropUrl: string | null): string | null {
  if (!artCropUrl) return null;
  // Only swap when the URL is the per-printing /cards/{set}/{num}
  // shape (built by scryfallByPrinting) — the by-name /cards/named
  // shape would still reference the wrong printing even after swap.
  if (!artCropUrl.includes('/cards/') || artCropUrl.includes('/cards/named'))
    return null;
  if (!artCropUrl.includes('version=art_crop')) return null;
  return artCropUrl.replace('version=art_crop', 'version=normal');
}

function CardImage({
  imageUrl,
  commanderName,
}: {
  imageUrl: string;
  commanderName: string;
}) {
  // Height-driven sizing — the card fills the panel's row height,
  // width derived from the 5/7 aspect ratio so the proportions match
  // a real Magic card. The width is naturally capped by the panel
  // column width upstream (the container is `auto` in the grid above).
  return (
    <div className="flex h-full min-h-0 items-start">
      <div
        className="relative h-full overflow-hidden rounded-lg"
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
  );
}

function CardDetails({
  commanderName,
  card,
  error,
}: {
  commanderName: string;
  card: ReturnType<typeof useScryfallCard>['card'];
  error: string | null;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          className="truncate text-base font-semibold text-text-primary"
          title={card?.name ?? commanderName}
        >
          {card?.name ?? commanderName}
        </h3>
        {card?.manaCost && (
          <ManaCost cost={card.manaCost} size="sm" />
        )}
      </div>

      {card?.typeLine && (
        <p className="text-xs uppercase text-text-secondary"
           style={{ letterSpacing: '0.06em' }}>
          {card.typeLine}
        </p>
      )}

      {/* Oracle text — Scryfall returns one paragraph per line break.
          Render each as its own <p> so abilities visually separate.
          ManaText handles inline {W}/{2}/etc symbols. */}
      {card?.oracleText && (
        <div className="flex flex-col gap-1.5 text-sm leading-snug text-text-primary">
          {card.oracleText.split('\n').map((para, i) => (
            <p key={i}>
              <ManaText text={para} />
            </p>
          ))}
        </div>
      )}

      {card?.backFace && (
        <BackFaceBlock face={card.backFace} />
      )}

      {(card?.power || card?.toughness || card?.loyalty) && (
        <div
          className="mt-auto flex items-center justify-end gap-3 border-t pt-2 text-sm font-semibold text-text-primary"
          style={{ borderColor: 'var(--color-card-frame-default)' }}
        >
          {card?.loyalty && (
            <span
              data-testid="commander-loyalty"
              className="rounded-md px-2 py-0.5 text-xs"
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-card-frame-default)',
              }}
            >
              Loyalty {card.loyalty}
            </span>
          )}
          {card?.power != null && card?.toughness != null && (
            <span
              data-testid="commander-pt"
              className="rounded-md px-2 py-0.5 text-xs"
              style={{
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-card-frame-default)',
              }}
            >
              {card.power} / {card.toughness}
            </span>
          )}
        </div>
      )}

      {error && !card && (
        <p
          data-testid="commander-preview-error"
          role="alert"
          className="text-xs text-status-warning"
        >
          Couldn't load card details ({error}).
        </p>
      )}
    </div>
  );
}

function BackFaceBlock({
  face,
}: {
  face: NonNullable<ReturnType<typeof useScryfallCard>['card']>['backFace'];
}) {
  if (!face) return null;
  return (
    <div
      data-testid="commander-back-face"
      className="mt-1 rounded-md border p-2"
      style={{
        borderColor: 'var(--color-card-frame-default)',
        background: 'rgba(14, 26, 32, 0.45)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="truncate text-sm font-semibold text-text-primary">
          {face.name}
        </h4>
        {face.manaCost && <ManaCost cost={face.manaCost} size="sm" />}
      </div>
      {face.typeLine && (
        <p
          className="mt-0.5 text-[11px] uppercase text-text-secondary"
          style={{ letterSpacing: '0.06em' }}
        >
          {face.typeLine}
        </p>
      )}
      {face.oracleText && (
        <div className="mt-1 flex flex-col gap-1 text-xs leading-snug text-text-primary">
          {face.oracleText.split('\n').map((para, i) => (
            <p key={i}>
              <ManaText text={para} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center rounded-lg text-sm text-text-muted"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-card-frame-default)',
      }}
    >
      No commander selected
    </div>
  );
}
