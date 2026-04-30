/**
 * Slice 70-J — shared halo-background helper, extracted from
 * {@link PlayerFrame}'s rectangular HaloRing for reuse by
 * {@link PlayerPortrait}'s circular halo.
 *
 * <p><b>Why extract?</b> Slice 70-K (PlayerFrame redesign) replaces
 * the rectangular halo with a circular one anchored to the
 * commander portrait. The mask-composite mechanism is geometry-
 * agnostic — only the wrapper's {@code border-radius} differs
 * (rectangle uses {@code --radius-md}, circle uses
 * {@code --radius-circle}). The {@code computeHaloBackground} +
 * {@code manaTokenForCode} helpers don't depend on shape at all,
 * so they live here as the canonical source.
 *
 * <p>Slice 70-J extracts the helpers verbatim; PlayerFrame imports
 * them in this slice (no behavior change). PlayerPortrait
 * (introduced this slice) consumes them too. Slice 70-K will
 * delete PlayerFrame's rectangular HaloRing entirely once
 * PlayerPortrait owns the halo at the portrait level.
 */

/**
 * Slice 70-D — colorIdentity + state → CSS background value for a
 * halo ring (rectangle or circle, indistinguishable to this
 * function).
 *
 * <p>Single color → solid fill in that mana color's token. Multi-
 * color → conic-gradient with alternating bands. Eliminated or
 * empty colorIdentity → neutral team-ring (NOT grey, per ADR 0011
 * D5 — grey collides with the disconnected/eliminated treatment).
 *
 * <p>The conic gradient uses {@code from var(--halo-angle, 0deg)}
 * so the @keyframes halo-rotate animates the gradient ORIGIN
 * rather than the element's transform — slice 70-G critic Graph-C1
 * fix that prevents the rectangle's rotated bbox from poking
 * through neighboring pod chrome. Circular halos in PlayerPortrait
 * don't have this problem (rotating a circle leaves the bbox
 * unchanged) but the same rotation mechanism applies for
 * consistency.
 */
export function computeHaloBackground(
  colorIdentity: readonly string[],
  eliminated: boolean,
): string {
  if (eliminated || colorIdentity.length === 0) {
    return 'var(--color-team-neutral)';
  }
  if (colorIdentity.length === 1) {
    return manaTokenForCode(colorIdentity[0]!);
  }
  const stops = colorIdentity
    .map((code, i) => {
      const start = (i * 360) / colorIdentity.length;
      const end = ((i + 1) * 360) / colorIdentity.length;
      return `${manaTokenForCode(code)} ${start}deg ${end}deg`;
    })
    .join(', ');
  return `conic-gradient(from var(--halo-angle, 0deg), ${stops})`;
}

/**
 * Slice 70-D — single-character mana code (W/U/B/R/G) → CSS
 * variable reference. Unknown codes default to the neutral team
 * ring; defends against a future engine upgrade with a sixth color.
 */
export function manaTokenForCode(code: string): string {
  switch (code) {
    case 'W':
      return 'var(--color-mana-white)';
    case 'U':
      return 'var(--color-mana-blue)';
    case 'B':
      return 'var(--color-mana-black)';
    case 'R':
      return 'var(--color-mana-red)';
    case 'G':
      return 'var(--color-mana-green)';
    default:
      // Unknown color code — server should never emit this, but
      // default to neutral so a future engine upgrade with a 6th
      // color doesn't render as transparent.
      return 'var(--color-team-neutral)';
  }
}

/**
 * Slice 70-N.1 — single-character mana code → low-alpha glow token
 * suitable for {@code box-shadow}. The {@code -glow} tokens are
 * defined in tokens.css as the rgba feathered-edge variants of the
 * {@link manaTokenForCode} solid tokens. Unknown codes default to
 * the colorless glow so a future engine 6th-color doesn't render as
 * a transparent halo.
 */
export function manaGlowTokenForCode(code: string): string {
  switch (code) {
    case 'W':
      return 'var(--color-mana-white-glow)';
    case 'U':
      return 'var(--color-mana-blue-glow)';
    case 'B':
      return 'var(--color-mana-black-glow)';
    case 'R':
      return 'var(--color-mana-red-glow)';
    case 'G':
      return 'var(--color-mana-green-glow)';
    default:
      return 'var(--color-mana-colorless-glow)';
  }
}

/**
 * Slice 70-N.1 (user directive 2026-04-30) — universal halo-glow
 * helper. Every halo surface (PlayerPortrait, FocalCard, any future
 * halo consumer) MUST radiate a soft outer glow in the same color(s)
 * as its inner ring/bands. The colored ring alone is not enough —
 * the user feedback was explicit that the color must "have a glow
 * effect that radiates from the color."
 *
 * <p>Returns a CSS {@code box-shadow} value composing one feathered
 * shadow per color in the identity, all centered on the element with
 * 0 spread (per picture-catalog "Color & motion impressions" anchor:
 * "Box-shadows with feathered edges (large blur radius, low alpha)
 * — not crisp 1px borders"):
 * <ul>
 *   <li>Single color → one shadow in that color's {@code -glow} token.</li>
 *   <li>Multicolor → one shadow per color, all at the same blur
 *       radius. They composite additively at the inner edge (where
 *       all colors overlap) and tint outward (where each color's
 *       intensity falls off). Visually reads as a multicolor glow
 *       cloud, not flat gold.</li>
 *   <li>Empty / eliminated → colorless glow (silver) so the radiate
 *       behavior is preserved at low intensity for the neutral case.</li>
 * </ul>
 *
 * <p>The {@code radiusPx} parameter lets each consumer pick a glow
 * extent appropriate to its element size — small portraits (32-96px)
 * use ~12-16px; the focal card (170×238) uses ~28-36px.
 */
export function computeHaloGlow(
  colorIdentity: readonly string[],
  eliminated: boolean,
  radiusPx: number,
): string {
  if (eliminated || colorIdentity.length === 0) {
    return `0 0 ${radiusPx}px 0 var(--color-mana-colorless-glow)`;
  }
  if (colorIdentity.length === 1) {
    return `0 0 ${radiusPx}px 0 ${manaGlowTokenForCode(colorIdentity[0]!)}`;
  }
  // Multicolor — one shadow per color, all centered with 0 spread.
  // Browsers composite stacked box-shadows additively, so the result
  // at the inner edge is roughly the sum of each color (tending
  // toward white-gold at high color count, which matches MTG's
  // multicolor visual language) while individual colors remain
  // visible toward the outer edge of each shadow.
  return colorIdentity
    .map((code) => `0 0 ${radiusPx}px 0 ${manaGlowTokenForCode(code)}`)
    .join(', ');
}
