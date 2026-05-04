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
 * Slice B-1 (variant=tabletop) — per-pod zone background helper.
 *
 * <p>Same shape as {@link computeHaloBackground} but maps to the
 * alpha-reduced `*-glow` mana tokens (composited on the dark zinc
 * battlefield bg, they produce the "lower-saturation than full
 * intensity" tone the user asked for in element #1 walkthrough).
 * Multicolor commanders get N distinct conic-gradient bands rotating
 * via {@code --halo-angle} — same mechanism as the portrait halo,
 * banded not blended (3-color = 3 visible arcs).
 *
 * <p>Empty {@code colorIdentity} (colorless commanders like Karn,
 * Kozilek) returns the new {@code --tabletop-zone-colorless} token
 * (warm ivory + gold per user direction) — diverges from
 * {@link computeHaloBackground}'s silver-grey {@code --color-team-neutral}
 * fallback because tabletop wants colorless to read as "ivory + gold,"
 * not "neutral."
 *
 * <p>Eliminated players keep {@code --color-team-neutral}. Future
 * enhancement: greyscale-of-original treatment so eliminated retains
 * the original color identity but desaturated.
 *
 * <p>Lives alongside {@link computeHaloBackground} (not replacing it)
 * because portrait halos in {@code current} use the full-saturation
 * tokens; tabletop's zone-scale background wants the alpha-reduced
 * variants. Two helpers, two token maps, one mechanism shared.
 */
export function computeTabletopZoneBackground(
  colorIdentity: readonly string[],
  eliminated: boolean,
): string {
  if (eliminated) {
    return 'var(--color-team-neutral)';
  }
  if (colorIdentity.length === 0) {
    return 'var(--tabletop-zone-colorless)';
  }
  if (colorIdentity.length === 1) {
    return manaGlowTokenForCode(colorIdentity[0]!);
  }
  const stops = colorIdentity
    .map((code, i) => {
      const start = (i * 360) / colorIdentity.length;
      const end = ((i + 1) * 360) / colorIdentity.length;
      return `${manaGlowTokenForCode(code)} ${start}deg ${end}deg`;
    })
    .join(', ');
  return `conic-gradient(from var(--halo-angle, 0deg), ${stops})`;
}

/**
 * Single-character mana code (W/U/B/R/G) → CSS variable reference for
 * the alpha-reduced `*-glow` variant. Parallel to
 * {@link manaTokenForCode} but for the lower-saturation tokens used
 * by tabletop zone backgrounds. Unknown codes default to neutral so
 * a future engine upgrade with a sixth color doesn't render as
 * transparent.
 */
function manaGlowTokenForCode(code: string): string {
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
      return 'var(--color-team-neutral)';
  }
}

// Slice 70-Z polish (user directive 2026-04-30) — `computeHaloGlow`
// + `manaGlowTokenForCode` removed. Both halo surfaces (PlayerPortrait
// CircularHalo + StackZone FocalCard) now use the SAME blurred-
// gradient sibling-div bloom approach (see PlayerPortrait.tsx +
// StackZone.tsx FocalCard). The box-shadow-based glow couldn't
// rotate with the conic-gradient ring, so for multicolor identities
// the bloom was a static color sum while the ring rotated through
// bands — a visual mismatch the unified approach resolves.
