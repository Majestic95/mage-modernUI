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
