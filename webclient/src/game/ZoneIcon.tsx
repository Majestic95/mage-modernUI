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
   * discriminator now so slice 70-D's PlayerFrame can pass it without
   * a re-wiring. Default {@code "self"} preserves the existing
   * full-size + clickable-modal behavior; {@code "opponent"} is a
   * stub today (renders identically) and slice 70-D will branch
   * here to render the smaller G/E icon variant per spec §7.9.
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  variant: _variant = 'self',
}: Props) {
  // _variant accepted now for forward-compat with 70-D PlayerFrame
  // (UX-I1). Today both branches render identically; 70-D will
  // branch to a compact G/E icon for opponent.
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
    />
  );
}

/**
 * Graveyard + exile path — clickable when non-empty, opens the
 * shared {@link ZoneBrowser} modal. Owns the hidden-layoutId
 * sink so cross-zone resolve animations can land here.
 */
function PublicZoneIcon({
  zone,
  cards,
  playerName,
  label,
}: {
  zone: 'graveyard' | 'exile';
  cards: Record<string, WebCardView>;
  playerName: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const cardList = Object.values(cards);
  const count = cardList.length;
  const empty = count === 0;
  return (
    <span className="relative inline-block">
      <span className="text-text-secondary">{label}</span>{' '}
      {empty ? (
        <span data-testid={`zone-count-${zone}`} className="font-mono">
          {count}
        </span>
      ) : (
        <button
          type="button"
          data-testid={`zone-count-${zone}`}
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
