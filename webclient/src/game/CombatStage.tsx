/**
 * Bundle 2 — combat-stage overlay component.
 *
 * <p>Mounts inside {@link ./Battlefield} as a sibling of the pod grid
 * (positioned absolute over the battlefield content). Reads from
 * {@link ./combatStageStore} — no props, no game-view threading.
 *
 * <p><b>Layers (rendered as siblings inside this component):</b>
 * <ul>
 *   <li>Slice 2-A — outer vignette dim (z-3). Always mounted; ramps
 *       opacity 0 ↔ 0.35 based on stageActive.</li>
 *   <li>Slice 2-B — central-area frame (z-5). Mounts only when
 *       stageActive=true. Thin gold inset edge + deeper inset shadow
 *       on the central focal rectangle.</li>
 *   <li>Slice 2-B — slate-clap pulse element (z-5, overlays the
 *       frame). Mounts only when stageActive=true, keyed on
 *       {@code slatePulseCounter} so each increment remounts the
 *       element + restarts the one-shot keyframe (0.6 → 1.0 → 0.6
 *       opacity over 800ms).</li>
 *   <li>Slice 2-C (queued) — sub-step cross-fade tint.</li>
 * </ul>
 *
 * <p><b>z-index ladder (locked in the bundle brief):</b>
 * vignette z-3, frame + pulse z-5. Both below Bundle 5 parcels
 * (z=25) and Bundle 6 arrows (z=40) — Bundle 2 is the atmospheric
 * backdrop, not the cinematic layer.
 *
 * <p><b>Reduced motion:</b> the opacity transitions + slate-clap
 * keyframe are silenced by scoped overrides inside the global
 * {@code @media (prefers-reduced-motion: reduce)} block in
 * index.css. The vignette still appears (state signal), the frame's
 * gold edge persists static; the slate-clap is the only motion that
 * fully disappears under reduced-motion.
 */
import { useCombatStageStore } from './combatStageStore';

export function CombatStage() {
  const stageActive = useCombatStageStore((s) => s.stageActive);
  const slatePulseCounter = useCombatStageStore((s) => s.slatePulseCounter);
  const currentSubStep = useCombatStageStore((s) => s.currentSubStep);

  return (
    <>
      <div
        data-testid="combat-stage-vignette"
        data-stage-active={stageActive}
        aria-hidden="true"
        className={`combat-stage-vignette pointer-events-none absolute inset-0 ${
          stageActive ? 'is-active' : ''
        }`}
      />
      {stageActive && (
        <>
          {/* Slice 2-B — central-area frame. */}
          <div
            data-testid="combat-stage-frame"
            aria-hidden="true"
            className="combat-stage-frame pointer-events-none absolute"
          />
          {/* Slice 2-B — slate-clap pulse, keyed on counter for
              keyframe restart-by-remount. */}
          <div
            key={slatePulseCounter}
            data-testid="combat-stage-slate-pulse"
            data-pulse-counter={slatePulseCounter}
            aria-hidden="true"
            className="combat-stage-slate-pulse pointer-events-none absolute"
          />
          {/* Slice 2-C — sub-step cross-fade tint. The {@code data-
              substep} attribute drives the per-sub-step background-
              color rule in CSS; the {@code transition: background-
              color 250ms ease-out} on .combat-stage-substep-tint
              interpolates smoothly between the warm declare-* /
              cool damage-* / neutral begin-end palettes. The store's
              150ms perceived-gap mechanism (slice 2-C) means
              currentSubStep flips through null between two non-null
              sub-steps, so the tint cross-fades to neutral mid-gap
              before re-saturating into the new sub-step's palette. */}
          <div
            data-testid="combat-stage-substep-tint"
            data-substep={currentSubStep ?? 'none'}
            aria-hidden="true"
            className="combat-stage-substep-tint pointer-events-none absolute"
          />
        </>
      )}
    </>
  );
}
