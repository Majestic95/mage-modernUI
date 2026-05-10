import { useMemo } from 'react';
import { manaTokenForCode } from './halo';

/**
 * Bundle 1 / Slice 1-X.2 — extracted verbatim from
 * {@link ./PlayerPortrait} so PlayerPortrait drops back under the
 * 500 LOC hard cap (was 510 post slice 1-B). Pairs with the slice's
 * ARIA restructure that moves {@code role="img"} off the outer
 * portrait wrapper onto the actual image surface (this fallback,
 * or the inner {@code <img>} when commander art is available).
 *
 * <p>This module owns:
 *
 * <ul>
 *   <li>{@link stateFilter} — shared eliminated/disconnected
 *       desaturation filter string. Used by both the real-art path
 *       in PlayerPortrait and the fallback below; centralizing the
 *       values means picture-catalog §2.4 retunes happen in one
 *       place (slice 70-Z polish, code critic Dup2).</li>
 *   <li>{@link FallbackInitial} — stylized initial-letter circle
 *       used when no commander art is available (non-Commander
 *       format, partner pairing without art, Scryfall URL
 *       unresolvable). Now carries its own {@code role="img"} +
 *       {@code aria-label} since the parent wrapper no longer
 *       does (slice 1-X.2 ARIA restructure to clear the
 *       leaf-role nesting flagged by the 1-B UX critic).</li>
 * </ul>
 */

/**
 * Slice 70-Z polish (code critic Dup2) — shared helper for the
 * eliminated/disconnected portrait filter string. Both the real-art
 * path and the fallback-initial path apply the SAME desaturation
 * treatment per picture-catalog §2.4; centralizing the values here
 * means the catalog can be retuned with a single edit instead of
 * two parallel literals.
 */
export function stateFilter(
  eliminated: boolean,
  disconnected: boolean,
): string | undefined {
  if (eliminated) return 'grayscale(1) opacity(0.5)';
  if (disconnected) return 'grayscale(0.6) opacity(0.7)';
  return undefined;
}

/**
 * Slice 70-J — fallback portrait when no commander art is available
 * (non-Commander format, partner pairing without art, or Scryfall
 * URL unresolvable). Renders the player's initial letter on a flat
 * color background derived from their first color identity (or a
 * neutral surface color for empty colorIdentity).
 *
 * <p>This is intentionally simple — the picture target is commander
 * portraits, and any frame without one is a degraded-experience
 * case. A stylized initial circle is "polished placeholder" rather
 * than "carefully designed avatar." Slice 70-Z polish may revisit
 * if the fallback paints awkwardly next to art-crop portraits in
 * mixed-format games.
 *
 * <p>Slice 1-X.2 — carries its own {@code role="img"} +
 * {@code aria-label} now that the outer PlayerPortrait wrapper
 * dropped both. Image semantics live on the actual visual surface
 * so the IncomingTag button (mounted as a sibling under the
 * wrapper) is no longer trapped inside an ARIA leaf role.
 */
export function FallbackInitial({
  name,
  colorIdentity,
  sizePx,
  eliminated,
  disconnected,
  ariaLabel,
}: {
  name: string;
  colorIdentity: readonly string[];
  sizePx: number;
  eliminated: boolean;
  disconnected: boolean;
  /**
   * Slice 1-X.2 — accessible name for the portrait. Composed in
   * PlayerPortrait from player + commander-name. When undefined,
   * the fallback is treated as decorative.
   */
  ariaLabel?: string;
}) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  const bgColor = useMemo(() => {
    if (eliminated || colorIdentity.length === 0) {
      return 'var(--color-surface-card)';
    }
    // Single first color of identity. Multicolor commanders are
    // expected to have art so this fallback is rare for them; if
    // we land here for a multicolor case, just use the first.
    return manaTokenForCode(colorIdentity[0]!);
  }, [colorIdentity, eliminated]);

  // Same desaturation / opacity treatment as the real portrait
  // for state variants — keeps the visual contract consistent
  // whether art loads or not. Shared helper so the two paths
  // (img + fallback) can't drift if the catalog values change
  // (code critic Dup2).
  const filterValue = stateFilter(eliminated, disconnected);

  // Font size scales with the portrait — large portraits get
  // proportionally larger initials. Roughly half the portrait
  // dimension for a balanced look.
  const fontSize = Math.max(12, Math.round(sizePx * 0.5));

  return (
    <div
      data-testid="player-portrait-fallback"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        backgroundColor: bgColor,
        color: 'var(--color-text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
        userSelect: 'none',
        filter: filterValue,
        transition: 'filter 700ms ease-in-out',
      }}
    >
      {initial}
    </div>
  );
}
