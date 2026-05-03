/**
 * Layout containment Tier 2 (2026-05-02) — uniform card-shrink for an
 * opponent pod whose battlefield has too many permanents to fit at the
 * default size. Returns the CSS variable overrides the pod wrapper
 * should apply.
 *
 * <p>Token defaults (from {@code styles/tokens.css}):
 * <ul>
 *   <li>{@code --card-size-medium}: 80px (local battlefield permanent)</li>
 *   <li>{@code --card-size-small}: 72px (opponent battlefield permanent)</li>
 * </ul>
 *
 * <p>Shrink curve:
 * <ul>
 *   <li>≤ {@link #FULL_THRESHOLD} permanents → full size (scale=1).</li>
 *   <li>{@link #FULL_THRESHOLD} &lt; n &lt; {@link #FLOOR_AT} → linear
 *     interpolate between scale 1 and {@link #FLOOR_SCALE}.</li>
 *   <li>≥ {@link #FLOOR_AT} → floor at {@link #FLOOR_SCALE}.</li>
 * </ul>
 *
 * <p>The floor (60% of default) keeps card art recognizable and lets
 * the existing {@code HoverCardDetail} portal supply full-detail
 * reading on hover. Below 60% scale the type line + mana cost
 * become unreadable even with squinting, which the floor avoids.
 *
 * <p>Returns {@code null} when no shrink is needed so the wrapper
 * can skip applying inline style entirely (small but real perf win
 * — every gameUpdate re-renders Battlefield).
 */
const FULL_THRESHOLD = 12;
const FLOOR_AT = 30;
const FLOOR_SCALE = 0.6;
const DEFAULT_MEDIUM_PX = 80;
const DEFAULT_SMALL_PX = 72;

export function computeShrinkScale(permanentCount: number): number {
  if (permanentCount <= FULL_THRESHOLD) return 1;
  if (permanentCount >= FLOOR_AT) return FLOOR_SCALE;
  const t = (permanentCount - FULL_THRESHOLD) / (FLOOR_AT - FULL_THRESHOLD);
  return 1 - t * (1 - FLOOR_SCALE);
}

/**
 * Produce the CSS-variable inline-style object to apply to a pod
 * wrapper for the given permanent count. Returns {@code null} when
 * the pod is at full size (no override needed) so the wrapper can
 * pass {@code undefined} for {@code style.--card-size-*} and the
 * cascade stays at the {@code styles/tokens.css} defaults.
 */
export function computePodCardSizeVars(
  permanentCount: number,
): CSSProperties | null {
  const scale = computeShrinkScale(permanentCount);
  if (scale === 1) return null;
  const medium = Math.round(DEFAULT_MEDIUM_PX * scale);
  const small = Math.round(DEFAULT_SMALL_PX * scale);
  return {
    ['--card-size-medium' as keyof CSSProperties]: `${medium}px`,
    ['--card-size-small' as keyof CSSProperties]: `${small}px`,
  } as CSSProperties;
}
