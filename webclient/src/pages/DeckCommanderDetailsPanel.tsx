/**
 * Deck-builder workbench's full-width bottom-row commander details
 * panel. Deck-builder-specific (no shared rendering with lobby's
 * CommanderPreviewPanel) per the 2026-05-12 separation directive.
 *
 * <p>Renders the card name + mana cost + type line + oracle text +
 * back face + P/T / loyalty. Lives below the 3-column grid so it
 * gets the full editor-area width — long oracle text wraps comfortably
 * instead of being squeezed in a sidebar.
 *
 * <p>Uses {@code useScryfallCard} (a lobby-namespaced hook; treated
 * as a shared utility, not a UI component — hooks don't violate the
 * window-separation rule).
 */
import { ManaCost, ManaText } from '../game/ManaCost';
import type { LobbyDeck } from '../lobby/fixtures';
import { useScryfallCard } from '../lobby/useScryfallCard';

interface Props {
  deck: LobbyDeck | null;
}

export function DeckCommanderDetailsPanel({ deck }: Props) {
  const commanderName =
    deck?.commanderName?.trim() || deck?.displayCardName?.trim() || '';
  const { card, loading, error } = useScryfallCard(
    commanderName.length > 0 ? commanderName : null,
  );

  return (
    <section
      data-testid="deck-commander-details-panel"
      // fix-9 — h-full so the panel fills its right-column flex slot.
      // Body has its own overflow-y-auto so long oracle text scrolls
      // inside the panel rather than pushing the panel taller.
      className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-card-frame-default/60 p-4"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2
          className="text-xs font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.14em' }}
        >
          {deck?.commanderName ? 'Commander details' : 'Display card details'}
        </h2>
        {loading && (
          <span
            data-testid="deck-commander-details-loading"
            className="text-[10px] uppercase text-text-muted"
            style={{ letterSpacing: '0.1em' }}
          >
            Loading…
          </span>
        )}
      </header>

      {!deck || !commanderName ? (
        <EmptyState />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <div className="flex items-baseline justify-between gap-2">
            <h3
              className="truncate text-base font-semibold text-text-primary"
              title={card?.name ?? commanderName}
            >
              {card?.name ?? commanderName}
            </h3>
            {card?.manaCost && <ManaCost cost={card.manaCost} size="sm" />}
          </div>

          {card?.typeLine && (
            <p
              className="text-xs uppercase text-text-secondary"
              style={{ letterSpacing: '0.06em' }}
            >
              {card.typeLine}
            </p>
          )}

          {card?.oracleText && (
            <div className="flex flex-col gap-1.5 text-sm leading-snug text-text-primary">
              {card.oracleText.split('\n').map((para, i) => (
                <p key={i}>
                  <ManaText text={para} />
                </p>
              ))}
            </div>
          )}

          {card?.backFace && <BackFaceBlock face={card.backFace} />}

          {(card?.power || card?.toughness || card?.loyalty) && (
            <div
              className="mt-auto flex items-center justify-end gap-3 border-t pt-2 text-sm font-semibold text-text-primary"
              style={{ borderColor: 'var(--color-card-frame-default)' }}
            >
              {card?.loyalty && (
                <span
                  data-testid="deck-commander-loyalty"
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
                  data-testid="deck-commander-pt"
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
              data-testid="deck-commander-details-error"
              role="alert"
              className="text-xs text-status-warning"
            >
              Couldn't load card details ({error}).
            </p>
          )}
        </div>
      )}
    </section>
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
      data-testid="deck-commander-back-face"
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
      className="flex min-h-[80px] flex-1 items-center justify-center rounded-lg text-sm text-text-muted"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-card-frame-default)',
      }}
    >
      Pick a deck to read its commander's rules text here.
    </div>
  );
}
