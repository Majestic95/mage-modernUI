import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slow } from '../animation/debug';
import type { WebCardView } from '../api/schemas';
import { ZoneBrowser } from './ZoneBrowser';

/**
 * Slice 70-C (ADR 0011 D4) — atom for a player's zone-count chip.
 *
 * Renamed + reshaped from {@code ZoneCounter} (slice 55) to align
 * with design-system §7.9 vocabulary, and extended to cover the
 * library zone (display-only, no browse modal — libraries are
 * face-down per §7.9).
 *
 * <p>Behavior by zone:
 * <ul>
 *   <li>{@code graveyard} / {@code exile} — clickable when non-empty,
 *       opens a {@link ZoneBrowser} modal listing every card. Public
 *       information; the spec calls for hover-tooltips on opponent
 *       icons (deferred — current implementation requires the click
 *       to inspect, which is sufficient for slice 70-C).</li>
 *   <li>{@code library} — display-only count; libraries are
 *       face-down (top-card-revealed flows are handled separately
 *       via {@code gameTarget} on revealed cards).</li>
 * </ul>
 *
 * <p>The graveyard / exile chips also host a hidden cross-zone
 * {@code layoutId} sink so a resolving instant or sorcery (slice 55
 * cross-zone glide) has a destination to animate INTO. Without this,
 * a Lightning Bolt resolving from the stack would fade out into
 * nowhere — the chip count would just bump silently. The hidden
 * sink is per-card (not per-zone) so any card moving in triggers a
 * glide regardless of order.
 */
interface Props {
  zone: 'graveyard' | 'exile' | 'library';
  /** Count for library; ignored when {@code cards} is provided. */
  count?: number;
  /** Card map for graveyard / exile. Required for those zones. */
  cards?: Record<string, WebCardView>;
  /** Owning player name; renders in the modal title + label. */
  playerName: string;
  /** Optional short label override; default is "Grave" / "Exile" / "Lib". */
  label?: string;
  /**
   * Slice 70-C critic UX-I1 — accepts the local-vs-opponent
   * discriminator. Slice 70-P (picture-catalog §2.2) — opponent
   * variant now branches: smaller chip styling and the
   * graveyard/exile chip becomes a hover tooltip listing the cards
   * (public information per MTG rules) rather than a clickable
   * modal. Local-player chips keep the click-to-modal behavior.
   */
  variant?: 'self' | 'opponent';
}

const DEFAULT_LABELS: Record<Props['zone'], string> = {
  graveyard: 'Grave',
  exile: 'Exile',
  library: 'Lib',
};

export function ZoneIcon({
  zone,
  count,
  cards,
  playerName,
  label,
  variant = 'self',
}: Props) {
  const displayLabel = label ?? DEFAULT_LABELS[zone];
  if (zone === 'library') {
    // Library is face-down — no modal, no clickability, just a
    // count. The chip shape mirrors the prior PlayerArea inline
    // "Lib N" rendering; renaming into ZoneIcon centralizes the
    // styling so a future spec change applies once.
    return (
      <span className="inline-block">
        <span className="text-text-secondary">{displayLabel}</span>{' '}
        <span data-testid="zone-count-library" className="font-mono">
          {count ?? 0}
        </span>
      </span>
    );
  }

  return (
    <PublicZoneIcon
      zone={zone}
      cards={cards ?? {}}
      playerName={playerName}
      label={displayLabel}
      variant={variant}
    />
  );
}

/**
 * Graveyard + exile path. Behavior per picture-catalog §2.2:
 * <ul>
 *   <li><b>Self variant</b> — clickable when non-empty; opens the
 *       shared {@link ZoneBrowser} modal listing every card.</li>
 *   <li><b>Opponent variant</b> — hover tooltip listing the card
 *       names (public information per MTG rules: "Opponent
 *       graveyard/exile show on hover (tooltip — public
 *       information per MTG rules)"). No modal click — the
 *       tooltip suffices for at-a-glance reads. Avoids the
 *       overdesign the catalog warns against ("Don't overdesign
 *       these").</li>
 * </ul>
 *
 * <p>Both variants own the hidden-layoutId sink so cross-zone
 * resolve animations can land here.
 */
function PublicZoneIcon({
  zone,
  cards,
  playerName,
  label,
  variant,
}: {
  zone: 'graveyard' | 'exile';
  cards: Record<string, WebCardView>;
  playerName: string;
  label: string;
  variant: 'self' | 'opponent';
}) {
  const [open, setOpen] = useState(false);
  const cardList = Object.values(cards);
  const count = cardList.length;
  const empty = count === 0;
  // Slice 70-P — opponent tooltip text. Picture-catalog §2.2 says
  // "show on hover" — we synthesize a newline-separated list of
  // card names so a native title= tooltip surfaces it. For empty
  // zones the title is omitted (no tooltip on a "0" chip).
  //
  // Slice 70-P critic UI/UX-I4 fix — cap the list at 10 entries
  // so a long graveyard (mid-game mill / discard floods past 30+
  // cards) doesn't produce a giant unstyled tooltip column that
  // scrolls off-screen on most browsers. Surplus collapses to
  // "... and N more"; the player can still open the modal
  // experience via the public game log if they need full detail.
  const TOOLTIP_CAP = 10;
  const opponentTooltip =
    variant === 'opponent' && !empty
      ? buildOpponentTooltip(playerName, zone, cardList, TOOLTIP_CAP)
      : `Browse ${playerName}'s ${zone}`;
  return (
    <span className="relative inline-block">
      <span className="text-text-secondary">{label}</span>{' '}
      {empty || variant === 'opponent' ? (
        // Opponent path renders a non-clickable count chip with a
        // hover tooltip; same shape as the empty case so the
        // user-visible difference is "tooltip vs nothing on hover."
        <span
          data-testid={`zone-count-${zone}`}
          data-variant={variant}
          className="font-mono"
          title={opponentTooltip}
        >
          {count}
        </span>
      ) : (
        <button
          type="button"
          data-testid={`zone-count-${zone}`}
          data-variant={variant}
          onClick={() => setOpen(true)}
          className={
            'font-mono cursor-pointer text-text-primary ' +
            'hover:text-accent-primary underline underline-offset-2'
          }
          title={`Browse ${playerName}'s ${zone}`}
        >
          {count}
        </button>
      )}
      {/*
        Slice 55 → 70-C — cross-zone resolve sink. Hidden zero-size
        motion.span per card so the LayoutGroup at the Game root has
        a destination to glide a resolving spell INTO. Each spell's
        cardId matches its underlying-Card UUID (slice 52a), so when
        a Lightning Bolt resolves from the stack into the graveyard,
        Framer matches the exiting stack tile against the cardId-
        paired sink at the chip's position and glides between them.

        Per-card (not per-zone) so order doesn't matter. Zero-size +
        opacity-0 + pointer-events-none means they cost ~nothing in
        layout/paint. Performance budget on the LayoutGroup is ≤50
        elements (Game.tsx); a long game's combined graveyards rarely
        exceed 30 cards.
      */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <AnimatePresence initial={false}>
          {cardList.map((card) =>
            card.cardId ? (
              <motion.span
                key={card.id}
                layoutId={card.cardId}
                data-layout-id={card.cardId}
                data-testid={`zone-target-${zone}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={slow({ duration: 0.2 })}
                className="absolute inset-0 block"
                style={{ width: 0, height: 0 }}
              />
            ) : null,
          )}
        </AnimatePresence>
      </span>
      {open && (
        <ZoneBrowser
          title={`${playerName}'s ${zone}`}
          cards={cards}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/**
 * Slice 70-P (UI/UX critic I4) — bounded tooltip body for opponent
 * zone chips. Caps the visible card list at {@code cap} entries so
 * a giant graveyard doesn't overflow the native browser tooltip's
 * render space. Surplus collapses to "... and N more".
 *
 * <p>Returns a string suitable for the {@code title=} attribute.
 * Newline separators render as line breaks in Chrome / Firefox /
 * Safari native tooltips.
 */
function buildOpponentTooltip(
  playerName: string,
  zone: 'graveyard' | 'exile',
  cardList: readonly { name: string }[],
  cap: number,
): string {
  const visible = cardList.slice(0, cap);
  const overflow = Math.max(0, cardList.length - cap);
  const names = visible.map((c) => c.name).join('\n');
  const suffix = overflow > 0 ? `\n... and ${overflow} more` : '';
  return `${playerName}'s ${zone}:\n${names}${suffix}`;
}
