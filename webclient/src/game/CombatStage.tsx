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
          {/* Slice 2-C — sub-step cross-fade tint. The {@code data-
              substep} attribute drives the per-sub-step background-
              color rule in CSS. */}
          <div
            data-testid="combat-stage-substep-tint"
            data-substep={currentSubStep ?? 'none'}
            aria-hidden="true"
            className="combat-stage-substep-tint pointer-events-none absolute"
          />
        </>
      )}
      {/*
       * Slice 2-X.0 F-U-B2 + F-U-N3 fix — slate-clap pulse lives
       * OUTSIDE the stageActive gate, mounted only when counter > 0:
       *
       *   1. Prevents spurious pulse on lab first-mount + every reset.
       *      The CSS keyframe runs on every mount of this element;
       *      gating on `counter > 0` means it doesn't mount until at
       *      least one COMBAT entry/exit transition has happened.
       *   2. Lets the EXIT pulse actually play. The previous gate
       *      (`stageActive && ...`) unmounted the slate-pulse the
       *      instant phase exited COMBAT — the keyframe ran for at
       *      most one frame before disappearing. Mounting outside the
       *      gate lets the keyframe play out its full 800ms regardless
       *      of whether stageActive is currently true or false. The
       *      visual "slate clap" still reads as the scene's ending
       *      beat even after the frame/vignette have unmounted.
       *
       * Keyed on slatePulseCounter so each counter increment unmounts
       * the previous element and mounts a fresh one — restart-by-
       * remount restarts the keyframe from t=0.
       */}
      {slatePulseCounter > 0 && (
        <div
          key={slatePulseCounter}
          data-testid="combat-stage-slate-pulse"
          data-pulse-counter={slatePulseCounter}
          aria-hidden="true"
          className="combat-stage-slate-pulse pointer-events-none absolute"
        />
      )}
    </>
  );
}
