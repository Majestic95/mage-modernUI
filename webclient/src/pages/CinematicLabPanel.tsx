/**
 * Cinematic-lab control panel — extracted from {@link ./CinematicLab}
 * in slice 6-A.2 (mechanical, 2026-05-10) so the lab page lands back
 * under the 400 LOC soft cap before Bundle 6's incoming "Declare
 * blockers" (6-B) and step-transition (6-C) buttons add ~80 more LOC.
 *
 * <p>This file owns:
 * <ul>
 *   <li>{@link ControlPanel} — the floating top-right panel
 *       containing the trigger buttons + status text.</li>
 *   <li>{@link LabButton} — one styled trigger row.</li>
 * </ul>
 *
 * <p>The trigger callbacks themselves stay in CinematicLab.tsx — they
 * own the store mutations + `epochRef` + `flushSync` race discipline
 * that's specific to the lab's two-step transition mechanics.
 */

interface ControlPanelProps {
  lastAction: string;
  onCombatDamage: () => void;
  onCreatureDies: () => void;
  onLethal: () => void;
  onDeclareAttackers: () => void;
  onReset: () => void;
}

export function ControlPanel({
  lastAction,
  onCombatDamage,
  onCreatureDies,
  onLethal,
  onDeclareAttackers,
  onReset,
}: ControlPanelProps) {
  // Position top-right so it doesn't overlap the action panel
  // (bottom-right per tabletop T2). z-50 sits above all other game
  // chrome including the action panel and dialog overlays.
  return (
    <div
      className="fixed top-20 right-4 w-80 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-xl p-4 z-50 text-sm"
      data-testid="cinematic-lab-panel"
    >
      <h2 className="text-base font-bold text-zinc-100 mb-2">
        Cinematic lab
      </h2>
      <p className="text-xs text-zinc-400 mb-3">
        Click a button to trigger a Bundle 5 / Bundle 6 effect.
        Reset between runs to re-fire.
      </p>
      <div className="flex flex-col gap-2">
        <LabButton
          testid="trigger-combat-damage"
          slices="5-A · 5-B · 5-C"
          label="Combat damage hit"
          description="Parcels traverse arrow + portrait bloom + viewport freeze-frame."
          onClick={onCombatDamage}
        />
        <LabButton
          testid="trigger-creature-dies"
          slices="5-D"
          label="Creature dies"
          description="Card desaturates 150ms during fly-to-graveyard glide."
          onClick={onCreatureDies}
        />
        <LabButton
          testid="trigger-lethal-commander"
          slices="5-E"
          label="Lethal commander damage (21)"
          description="Centered banner + viewport pulse on threshold cross."
          onClick={onLethal}
        />
        <LabButton
          testid="trigger-declare-attackers"
          slices="6-A v2"
          label="Declare attackers"
          description="Attack arrows ink-overlay pen-stroke draw-in (400ms / arrow)."
          onClick={onDeclareAttackers}
        />
        <LabButton
          testid="trigger-reset"
          slices="reset"
          label="Reset fixture"
          description="Restore life=40, undo deaths and lethal."
          onClick={onReset}
        />
      </div>
      <p
        className="text-xs text-zinc-300 mt-3 border-t border-zinc-800 pt-2 break-words"
        data-testid="cinematic-lab-status"
      >
        {lastAction}
      </p>
    </div>
  );
}

interface LabButtonProps {
  testid: string;
  slices: string;
  label: string;
  description: string;
  onClick: () => void;
}

function LabButton({
  testid,
  slices,
  label,
  description,
  onClick,
}: LabButtonProps) {
  return (
    <button
      type="button"
      data-testid={testid}
      data-cinematic-trigger={slices}
      onClick={onClick}
      className="text-left px-3 py-2 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-600 rounded text-zinc-100 transition-colors"
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="font-semibold">{label}</span>
        <span className="text-[10px] text-zinc-400 font-mono">{slices}</span>
      </div>
      <span className="text-xs text-zinc-400 block leading-snug">
        {description}
      </span>
    </button>
  );
}
