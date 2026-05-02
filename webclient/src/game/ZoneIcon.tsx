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
  zone: 'graveyard' | 'exile' | 'library' | 'hand';
  /**
   * Count for library + hand; ignored when {@code cards} is
   * provided (graveyard / exile derive count from the cards map).
   */
  count?: number;
  /** Card map for graveyard / exile. Required for those zones. */
  cards?: Record<string, WebCardView>;
  /** Owning player name; renders in the modal title + label. */
  playerName: string;
  /** Optional short label override; default is "Grave" / "Exile" / "Lib" / "Hand". */
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
  // Slice 70-P.1 (user directive 2026-04-30) — hand size is
  // strategic info ("does the opponent have a Counterspell?")
  // surfaced as a display-only chip in the same cluster as the
  // graveyard/exile/library chips. Catalog §2.5 listed handCount
  // as removed from the legacy strip but didn't relocate it; the
  // cluster is the natural home.
  hand: 'Hand',
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
  if (zone === 'library' || zone === 'hand') {
    // Library + hand are display-only counts. Library is face-down
    // (engine §7.9). Hand is private to the holder for opponents
    // (we only have the count, not the actual cards) and is
    // rendered visually for the local player as the hand fan, so
    // the chip is just a strategic-info readout. Same chip shape;
    // the tests data-testid encodes which zone it represents.
    return (
      <span className="inline-block">
        <span className="text-text-secondary">{displayLabel}</span>{' '}
        <span data-testid={`zone-count-${zone}`} className="font-mono">
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
 * Graveyard + exile path. Bug fix (2026-05-02) — both variants are
 * now clickable buttons that open the {@link ZoneBrowser} modal.
 *
 * <p>Why the change: the slice-70-P "opponent gets a hover tooltip
 * instead of click" pattern proved un-discoverable in playtest. The
 * tooltip required precise hover, capped at 10 entries, and
 * silently failed on touch input. Per MTG rules graveyard and exile
 * are public information — every player can ask to look at any
 * graveyard / exile zone at any time. Click → modal mirrors the
 * paper-game right ("hand me your graveyard for a sec"), works on
 * touch, and removes the 10-card cap.
 *
 * <p>Empty zones still render as plain text (nothing to view; a
 * disabled button would just add visual noise).
 *
 * <p>Both variants own the hidden-layoutId sink so cross-zone
 * resolve animations can land here regardless of perspective.
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
  return (
    <span className="relative inline-block">
      <span className="text-text-secondary">{label}</span>{' '}
      {empty ? (
        // Empty: plain text. No button — there's nothing to view, and
        // a disabled-looking button would clutter the cluster for
        // every player who hasn't lost / exiled anything yet.
        <span
          data-testid={`zone-count-${zone}`}
          data-variant={variant}
          className="font-mono"
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
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded ' +
            'bg-zinc-800/70 hover:bg-zinc-700 border border-zinc-700 ' +
            'text-text-primary font-mono cursor-pointer transition-colors'
          }
          title={`Browse ${playerName}'s ${zone} (${count} card${count === 1 ? '' : 's'})`}
          aria-label={`Browse ${playerName}'s ${zone} — ${count} card${count === 1 ? '' : 's'}`}
        >
          <ZoneGlyph zone={zone} />
          <span>{count}</span>
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
 * Bug fix (2026-05-02) — small inline glyph for graveyard / exile
 * chips so the count button reads as an open-zone affordance, not
 * just a number. Using inline SVG (not unicode emoji) for cross-
 * platform render consistency — emoji rendering varies wildly on
 * Windows vs macOS vs Linux Chrome.
 */
function ZoneGlyph({ zone }: { zone: 'graveyard' | 'exile' }) {
  if (zone === 'graveyard') {
    // Tombstone silhouette with a small cross.
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M2 4.5 a3.5 3.5 0 0 1 7 0 V10 H2 Z"
          fill="currentColor"
        />
        <rect x="5.1" y="5" width="0.8" height="3" fill="rgb(24 24 27)" />
        <rect x="4.1" y="6" width="2.8" height="0.8" fill="rgb(24 24 27)" />
      </svg>
    );
  }
  // Exile: outward / "leaving the game" arrow inside a square hint.
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 5.5 V9 H6" />
      <path d="M5.5 2 H9 V5.5" />
      <path d="M9 2 L4.5 6.5" />
    </svg>
  );
}
