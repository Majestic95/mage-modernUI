import { useEffect } from 'react';
import { BOARD_WIPE_PULSE_MS } from './transitions';

/**
 * Slice 70-Z.4 — board-wipe radial ripple. When the snapshot diff
 * emits a {@code board_wipe} event (>=2 permanents destroyed in
 * one snapshot), a single fixed-position div mounts at the
 * epicenter pod's center, runs the {@code board-wipe-ripple}
 * keyframe (700ms, scale 0->1.1, opacity 0.55->0), then unmounts.
 *
 * <p>The per-permanent dust/dissolve particles fire in lockstep
 * with the ripple via {@code BOARD_WIPE_STAGGER_MS} animation-delay
 * staggers, so the wave reads as an outward shockwave with
 * disintegrating tiles riding it.
 *
 * <p><b>Epicenter:</b> resolved from the {@code epicenterSeat} on
 * the {@code board_wipe} event — the seat with the most
 * destructions. CardAnimationLayer translates seat -> playerId ->
 * pod bbox via {@link resolveCastSourceCenter}'s playerId-based
 * variant (or a similar helper) before passing {@code center} as
 * a prop here.
 *
 * <p><b>Reduced motion:</b> the parent CardAnimationLayer skips
 * mounting this component entirely under
 * {@code prefers-reduced-motion}; the global media query in
 * index.css is belt-and-suspenders.
 */
export function BoardWipeRipple({
  center,
  onComplete,
}: {
  center: { x: number; y: number };
  onComplete: () => void;
}): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(onComplete, BOARD_WIPE_PULSE_MS);
    return () => clearTimeout(t);
  }, [onComplete]);

  // Slice 70-Z.4 critic UI/UX-CRIT-1 fix: ripple needs to actually
  // read as a screen-wide pulse, not a 220px localized bloom. Base
  // size 200px scaled 1.1× was ~220px at peak — invisible on a
  // 1920×1080 viewport. Bumped base to 2000px (covers any practical
  // viewport at scale 1) so the keyframe's scale 0→1.1 produces a
  // visible 0→2200px wave that washes over the table from the
  // epicenter pod. Opacity 0.55→0 keeps the gradient soft so the
  // pulse reads as "shockwave" rather than "screen tint."
  const SIZE = 2000;
  return (
    <div
      data-testid="board-wipe-ripple"
      aria-hidden="true"
      className="pointer-events-none fixed rounded-full"
      style={{
        left: center.x,
        top: center.y,
        width: SIZE,
        height: SIZE,
        marginLeft: -SIZE / 2,
        marginTop: -SIZE / 2,
        background:
          'radial-gradient(circle, rgba(220, 180, 110, 0.55) 0%, rgba(220, 180, 110, 0.18) 50%, transparent 80%)',
        animation: `board-wipe-ripple ${BOARD_WIPE_PULSE_MS}ms ease-out forwards`,
        transformOrigin: 'center',
      }}
    />
  );
}
