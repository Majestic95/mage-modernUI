/**
 * Slice 6-Y.2 — extracted from {@link TargetingArrow} (was 467 LOC,
 * past the 400 soft cap). Owns the third sibling
 * {@code <path data-arrow-layer="shimmer">} element that breathes a
 * step-keyed color overlay during the FIRST_COMBAT_DAMAGE /
 * COMBAT_DAMAGE steps. No marker — the shimmer doesn't carry an
 * arrowhead.
 *
 * <p>Cross-dissolve between palettes happens via React's natural
 * class swap when {@code damageStep} changes (e.g. engine
 * transitions FIRST_COMBAT_DAMAGE → COMBAT_DAMAGE on a creature with
 * first strike that survived to deal regular damage). The
 * {@code transition: stroke 300ms ease-in-out} rule in
 * {@code index.css:arrow-shimmer-*} interpolates the stroke color
 * smoothly across the swap (slice 6-X.0 F-M-N2 fix).
 *
 * <p>Reduced-motion: the explicit
 * {@code @media (prefers-reduced-motion: reduce)} block in
 * {@code index.css} (slice 6-X.0 F-T-B1 / F-G-B1 / F-M-N3 fix)
 * silences the keyframe animation. The static stroke color persists
 * with class-base {@code opacity: 0.4} (a faint tint) so cool-vs-
 * warm differentiation is preserved as a static signal (WCAG 1.4.1
 * redundant-signal claim).
 */
interface Props {
  /** Path d-attribute (shared with base + ink paths). */
  d: string;
  /** Step palette discriminator. Class-keyed; CSS owns the colors. */
  damageStep: 'first-strike' | 'regular';
}

export function ArrowShimmerLayer({ d, damageStep }: Props) {
  return (
    <path
      data-arrow-layer="shimmer"
      data-damage-step={damageStep}
      d={d}
      strokeWidth="5"
      strokeLinecap="butt"
      className={
        damageStep === 'first-strike'
          ? 'arrow-shimmer-first-strike'
          : 'arrow-shimmer-regular'
      }
    />
  );
}
