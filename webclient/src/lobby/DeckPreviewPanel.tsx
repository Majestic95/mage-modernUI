/**
 * Slice L1 — bottom-center deck preview. Commander card + count +
 * mana curve + type counts + per-color pip counts.
 */
import { ColorPipRow } from './ColorPipRow';
import type { LobbyColor, LobbyDeck } from './fixtures';
import { lobbyCardImageUrl } from './fixtures';
import { ManaCurveHistogram } from './ManaCurveHistogram';

interface Props {
  deck: LobbyDeck | null;
  /**
   * Slice L7 polish — true while card metadata for the selected deck
   * is being fetched. Renders a "Calculating stats…" pill so zeros
   * don't read as broken stats.
   */
  statsLoading?: boolean;
}

const PIP_ORDER: LobbyColor[] = ['W', 'U', 'B', 'R', 'G'];

export function DeckPreviewPanel({ deck, statsLoading = false }: Props) {
  if (!deck) {
    return (
      <section
        data-testid="deck-preview-panel"
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-card-frame-default/60 p-5 text-text-secondary"
        style={{ background: 'rgba(21, 34, 41, 0.85)' }}
      >
        <p className="text-sm">No deck selected</p>
      </section>
    );
  }

  const valid = deck.mainboardSize === deck.requiredSize;

  return (
    <section
      data-testid="deck-preview-panel"
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl border border-card-frame-default/60 p-3"
      style={{
        background: 'rgba(21, 34, 41, 0.85)',
        boxShadow: 'var(--shadow-low)',
      }}
    >
      <header className="flex items-center justify-between gap-2">
        <h2
          className="min-w-0 flex-1 truncate text-xs font-semibold uppercase text-text-primary"
          style={{ letterSpacing: '0.14em' }}
          title={deck.name}
        >
          {deck.name}
        </h2>
        {statsLoading && (
          <span
            data-testid="deck-stats-loading"
            className="rounded-full px-2 py-0.5 text-[10px] uppercase text-text-secondary"
            style={{
              letterSpacing: '0.1em',
              border: '1px solid var(--color-card-frame-default)',
              background: 'var(--color-bg-elevated)',
            }}
          >
            Calculating…
          </span>
        )}
        <button
          type="button"
          aria-label="Edit deck name"
          data-testid="deck-preview-edit-button"
          className="flex-shrink-0 text-text-secondary transition-colors hover:text-text-primary"
        >
          <PencilIcon />
        </button>
      </header>

      <div
        className="grid min-h-0 flex-1 items-start gap-3"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <CommanderCardArt
          name={deck.commanderName}
          // Audit fix — honor the user's chosen commander printing.
          // deck.commanderArtUrl is the printing-aware art_crop URL;
          // promote it to the normal-version URL for the card image.
          // Falls back to by-name lookup only when the chosen-printing
          // URL isn't available (older deck without setCode/cardNumber).
          imageUrl={
            chosenPrintingNormalUrl(deck.commanderArtUrl)
            ?? lobbyCardImageUrl(deck.commanderName)
          }
        />

        <div className="flex min-h-0 flex-col gap-2">
          <CardCountBlock
            count={deck.mainboardSize}
            required={deck.requiredSize}
            valid={valid}
          />
          <ManaCurveHistogram curve={deck.manaCurve} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        <TypeStat
          label="Creatures"
          count={deck.typeCounts.creatures}
          icon={<CreatureIcon />}
        />
        <TypeStat
          label="Artifacts"
          count={deck.typeCounts.artifacts}
          icon={<ArtifactIcon />}
        />
        <TypeStat
          label="Enchantments"
          count={deck.typeCounts.enchantments}
          icon={<EnchantmentIcon />}
        />
        <TypeStat
          label="Instants & Sorceries"
          count={deck.typeCounts.instantsAndSorceries}
          icon={<InstantIcon />}
        />
      </div>

      <div
        className="flex items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: 'var(--color-card-frame-default)' }}
      >
        <ColorPipRow colors={deck.colorIdentity} size="md" />
        <PerColorCounts pips={deck.colorPipCounts} />
      </div>
    </section>
  );
}

/**
 * Promote the LobbyDeck.commanderArtUrl (art_crop) to a normal-version
 * URL for the commander card image. Returns null when the input
 * doesn't look like a Scryfall printing URL — caller falls back to
 * by-name lookup.
 */
function chosenPrintingNormalUrl(artCropUrl: string | null): string | null {
  if (!artCropUrl) return null;
  if (!artCropUrl.includes('/cards/') || artCropUrl.includes('/cards/named'))
    return null;
  if (!artCropUrl.includes('version=art_crop')) return null;
  return artCropUrl.replace('version=art_crop', 'version=normal');
}

function CommanderCardArt({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string;
}) {
  // Height-driven sizing — fills the parent's row height, derives
  // width from aspect-ratio. Cap raised to 240 (was 130) so the
  // commander card renders at near-full proportional size in the
  // widened DeckPreview column. NewLobbyScreen sets the column to
  // minmax(440, 520), comfortably accommodating a 240×336 card plus
  // the stats column.
  return (
    <div className="flex h-full min-h-0 items-start">
      <div
        className="relative h-full overflow-hidden rounded-lg"
        style={{
          aspectRatio: '5 / 7',
          maxWidth: 240,
          background: 'var(--color-surface-card)',
          boxShadow: 'var(--shadow-medium)',
          border: '1px solid var(--color-card-frame-default)',
        }}
      >
        <img
          src={imageUrl}
          alt={name}
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

function CardCountBlock({
  count,
  required,
  valid,
}: {
  count: number;
  required: number;
  valid: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-card-frame-default)',
        }}
      >
        <CardsIcon />
      </div>
      <div className="flex flex-col leading-tight">
        <span
          className={
            'text-xl font-semibold ' +
            (valid ? 'text-text-primary' : 'text-status-warning')
          }
        >
          {count}/{required}
        </span>
        <span
          className="text-[10px] uppercase text-text-secondary"
          style={{ letterSpacing: '0.12em' }}
        >
          Cards
        </span>
      </div>
    </div>
  );
}

function TypeStat({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center text-text-secondary">
        {icon}
      </span>
      <span className="font-semibold text-text-primary">{count}</span>
      <span
        className="text-[10px] uppercase text-text-muted"
        style={{ letterSpacing: '0.08em' }}
      >
        {label}
      </span>
    </div>
  );
}

function PerColorCounts({
  pips,
}: {
  pips: Record<LobbyColor, number>;
}) {
  const colorTokens: Record<LobbyColor, string> = {
    W: 'var(--color-mana-white)',
    U: 'var(--color-mana-blue)',
    B: 'var(--color-mana-black)',
    R: 'var(--color-mana-red)',
    G: 'var(--color-mana-green)',
  };
  return (
    <div className="flex items-center gap-2">
      {PIP_ORDER.map((c) => (
        <div key={c} className="flex items-center gap-1">
          <div
            className="h-3 w-3 rounded-full"
            style={{ background: colorTokens[c] }}
          />
          <span className="text-xs font-medium text-text-secondary">
            {pips[c]}
          </span>
        </div>
      ))}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function CardsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: 'var(--color-text-secondary)' }}
    >
      <rect x="3" y="5" width="14" height="16" rx="2" />
      <path d="M7 3h12a2 2 0 0 1 2 2v14" />
    </svg>
  );
}

function CreatureIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1 4 5h2v3l-3 2v3l5-2 5 2v-3l-3-2V5h2z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArtifactIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  );
}

function EnchantmentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2 9.5 6 14 7 10.5 10 11.5 14 8 12 4.5 14 5.5 10 2 7 6.5 6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InstantIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m9 1-6 9h4l-1 5 6-9H8z"
        fill="currentColor"
      />
    </svg>
  );
}
