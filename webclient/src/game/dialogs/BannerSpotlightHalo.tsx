/**
 * Golden-white rotating spotlight ring used by DialogBanner /
 * ManaPayBanner / CombatBanner. Mirrors the top-of-stack focal-card
 * spotlight (StackZone.tsx) so banners draw the same caliber of
 * "look at me" attention as the active stack object.
 *
 * <p>Implementation: a conic-gradient with a bright sweep on a
 * transparent base, masked into a perimeter ring via the standard
 * mask-composite trick (outer mask = full layer, inner mask =
 * content-box layer; XOR/exclude leaves only the padding ring).
 * Rotates by interpolating the registered `--halo-angle` `@property`
 * 0 → 360deg via the shared `halo-rotate` keyframe.
 *
 * <p>Sits as an absolute child inside its parent (which must be
 * `position: relative`) extending 3px beyond the parent's edge so
 * the ring frames the banner without overlapping the content. Aria-
 * hidden — purely decorative; the banner's role / aria-live still
 * announce to screen readers.
 *
 * <p>Pointer-events: none. Drag handlers / button clicks pass
 * through unaffected.
 */
export function BannerSpotlightHalo({
  testId,
}: {
  /** Optional data-testid for unit tests asserting the spotlight is mounted. */
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      aria-hidden="true"
      className="animate-banner-halo-rotate absolute -inset-[3px] rounded-xl pointer-events-none"
      style={{
        background:
          'conic-gradient(from var(--halo-angle, 0deg), ' +
          'transparent 0deg, ' +
          'rgba(255, 240, 180, 0.95) 35deg, ' +
          'rgba(255, 215, 100, 1.0) 70deg, ' +
          'rgba(255, 240, 180, 0.95) 105deg, ' +
          'transparent 140deg, ' +
          'transparent 360deg)',
        WebkitMask:
          'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        maskComposite: 'exclude',
        padding: '3px',
      }}
    />
  );
}
