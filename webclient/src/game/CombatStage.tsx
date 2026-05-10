/**
 * Bundle 2 / Slice 2-A — combat-stage overlay component.
 *
 * <p>Currently renders only the outer vignette dim (slice 2-A scope).
 * Slice 2-B will add the central-area frame + slate-clap pulse; slice
 * 2-C will add the sub-step cross-fade tint. All three layers
 * coexist as siblings of the vignette inside this component.
 *
 * <p>Reads from {@link ./combatStageStore} — no props, no game-view
 * threading. Mounts in {@link ./Battlefield} as a sibling of the pod
 * grid (positioned absolute over the battlefield content) so the
 * vignette covers the full battlefield viewport.
 *
 * <p><b>z-index ladder (locked in the bundle brief):</b>
 * vignette at z-3 (above battlefield artwork at z=0, below the pod
 * grid + cards at higher z), slated to coexist with frame/step-tint
 * at z-5 from slice 2-B. Bundle 5 parcels (z=25) and Bundle 6 arrows
 * (z=40) paint on top — Bundle 2 is the atmospheric backdrop.
 *
 * <p><b>Reduced motion:</b> the opacity transition is silenced by the
 * scoped {@code .combat-stage-vignette} rule inside the global
 * {@code @media (prefers-reduced-motion: reduce)} block in index.css.
 * The vignette still appears (it's a state signal, not motion) — the
 * opacity just snaps instead of ramping.
 */
import { useCombatStageStore } from './combatStageStore';

export function CombatStage() {
  const stageActive = useCombatStageStore((s) => s.stageActive);

  return (
    <div
      data-testid="combat-stage-vignette"
      data-stage-active={stageActive}
      aria-hidden="true"
      className={`combat-stage-vignette pointer-events-none absolute inset-0 ${
        stageActive ? 'is-active' : ''
      }`}
    />
  );
}
