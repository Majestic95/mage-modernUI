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
 * 2026-05-09 — soft-blended variant of {@link computeHaloBackground}
 * for surfaces that want smooth color crossfading instead of hard
 * arc bands. Used by {@link TurnEdgeGlow} where the viewport ring
 * reads better as a smooth gradient than as discrete bands.
 *
 * <p>Single color → solid fill. Multi-color → conic-gradient with
 * one stop per color at evenly-spaced angles, plus a wrap-stop
 * repeating the first color at 360deg so the gradient seams back to
 * itself smoothly. {@code from var(--halo-angle, 0deg)} reads the
 * same animated property as {@link computeHaloBackground} so the
 * same {@code halo-rotate} keyframe rotates the gradient origin.
 */
export function computeBlendedHaloBackground(
  colorIdentity: readonly string[],
  eliminated: boolean,
): string {
  if (eliminated || colorIdentity.length === 0) {
    return 'var(--color-team-neutral)';
  }
  if (colorIdentity.length === 1) {
    return manaTokenForCode(colorIdentity[0]!);
  }
  const n = colorIdentity.length;
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i * 360) / n;
    stops.push(`${manaTokenForCode(colorIdentity[i]!)} ${angle}deg`);
  }
  // Wrap: re-emit the first color at 360deg so the seam is smooth
  // rather than snapping from the last color back to the first.
  stops.push(`${manaTokenForCode(colorIdentity[0]!)} 360deg`);
  return `conic-gradient(from var(--halo-angle, 0deg), ${stops.join(', ')})`;
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

/* ===================================================================
 * Bundle 1 / Slice 1-A — combat-arrow defender color + dash pattern
 * helpers. Routes a combat arrow's stroke through the defending
 * player's commander color identity, paired with a deterministic
 * per-defender dash pattern so color-blind users get a redundant
 * signal (WCAG 2.1 SC 1.4.1).
 *
 * Lives alongside the halo helpers because both consume the same
 * `colorIdentity` shape and the same `manaTokenForCode` map. The
 * banded-not-blended choice mirrors {@link computeHaloBackground}'s
 * conic-gradient mechanism — multicolor identity reads as N hard
 * bands along the arrow path, not a smudged mid-color.
 * =================================================================*/

/**
 * Per-arrow stroke specification. Discriminated union so the
 * renderer can branch cleanly: a `solid` stroke maps to a single
 * CSS color reference; a `gradient` stroke maps to an SVG
 * `<linearGradient>` definition with explicit stop offsets.
 *
 * <p>Multicolor gradients use duplicate-offset stops to produce
 * hard color bands ({@code [{0, c1}, {0.5, c1}, {0.5, c2}, {1, c2}]})
 * rather than smooth blends. Smooth blends on a 3px stroke turn into
 * muddy mid-tones; bands stay readable as "blue → green" along the
 * arrow.
 */
export type StrokeSpec =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; stops: readonly { offset: number; color: string }[] };

/**
 * Looks up a defender's commander color identity by player id. Used
 * by combat-arrow rendering to color the arrow targeting that
 * defender's lane. Returns `[]` for unknown ids (defender removed
 * mid-game, fixture drift) so the caller can fall back to a neutral
 * stroke without crashing.
 *
 * <p>Structural type on `players` so test fixtures can pass minimal
 * objects without constructing full {@code WebPlayerView} shapes.
 */
export function defenderColorIdentity(
  defenderId: string,
  players: readonly { playerId: string; colorIdentity: readonly string[] }[],
): readonly string[] {
  if (!defenderId) return [];
  const player = players.find((p) => p.playerId === defenderId);
  return player ? player.colorIdentity : [];
}

/**
 * Maps a commander color identity to the {@link StrokeSpec} the
 * combat-arrow renderer consumes.
 *
 * <ul>
 *   <li>Empty / unknown identity → solid neutral stroke
 *       ({@code --color-targeting-arrow}, the legacy arrow color).
 *   <li>Single color → solid mana-token stroke.
 *   <li>Multi-color → gradient with hard-edged bands (duplicate-offset
 *       stops). Two colors = 4 stops, three colors = 6 stops, etc.
 * </ul>
 *
 * <p>The renderer is responsible for orienting the gradient along
 * the arrow path's chord (source → target) and for resolving the
 * arrowhead marker fill to the gradient's last stop color so the
 * head matches the defender-side band visually.
 */
export function arrowStrokeForColorIdentity(
  colorIdentity: readonly string[],
): StrokeSpec {
  if (colorIdentity.length === 0) {
    return { kind: 'solid', color: 'var(--color-targeting-arrow)' };
  }
  if (colorIdentity.length === 1) {
    return { kind: 'solid', color: manaTokenForCode(colorIdentity[0]!) };
  }
  const n = colorIdentity.length;
  const stops: { offset: number; color: string }[] = [];
  for (let i = 0; i < n; i++) {
    const start = i / n;
    const end = (i + 1) / n;
    const color = manaTokenForCode(colorIdentity[i]!);
    // Duplicate-offset pattern: each color gets two stops at its
    // band's start and end offsets, producing a hard transition at
    // the boundary rather than a blend across the next color.
    stops.push({ offset: start, color });
    stops.push({ offset: end, color });
  }
  return { kind: 'gradient', stops };
}

/**
 * Per-defender dash patterns used to pair color with a non-color
 * signal (WCAG 2.1 SC 1.4.1). Indexed by the defender's position in
 * the {@code players} array; defenders past the array length wrap
 * via modulo (4p Commander never wraps; documented degradation for
 * exotic 5+ player formats).
 *
 * <ul>
 *   <li>0 → solid (empty string = SVG default = no dash)
 *   <li>1 → dashed ({@code 8 6})
 *   <li>2 → dotted ({@code 2 5})
 *   <li>3 → ticked ({@code 1 6}) — single-pixel ticks with breathing
 *       gaps, visually distinct from both dashed and dotted at 3px
 *       stroke + butt linecap. (Earlier {@code 4 3 4 9} double-stroke
 *       attempt collapsed visually with {@code 8 6} after linecap
 *       normalization — UI critic, slice 1-A.)
 * </ul>
 *
 * <p>Patterns tuned for the project's 3px stroke width with
 * {@code stroke-linecap="butt"} (the linecap is enforced in
 * {@link TargetingArrow}; see slice 1-A comment there for why round
 * caps collapse dash distinctness). Sub-1440p viewports may show
 * patterns that read as solid; degradation acceptable per the
 * variant's load-bearing rules (T4).
 */
export const DEFENDER_DASH_PATTERNS = ['', '8 6', '2 5', '1 6'] as const;

export function defenderDashPattern(defenderIndex: number): string {
  if (defenderIndex < 0) return '';
  return DEFENDER_DASH_PATTERNS[defenderIndex % DEFENDER_DASH_PATTERNS.length]!;
}
