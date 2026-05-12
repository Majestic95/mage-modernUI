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
 *
 * <p>Drag (2026-05-12): pointer events on the header wrap let the user
 * relocate the panel out of the way of any specific pod / chrome
 * being verified. Initial position is the Tailwind default (top-20
 * right-4); after first drag the panel switches to inline left/top
 * coordinates clamped so the header stays in-viewport.
 */
import { useRef, useState } from 'react';

interface DragPos {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

interface ControlPanelProps {
  lastAction: string;
  onCombatDamage: () => void;
  onHeavyCombatDamage: () => void;
  onCreatureDies: () => void;
  onLethal: () => void;
  onDeclareAttackers: () => void;
  onDeclareBlockers: () => void;
  onDamageStep: () => void;
  onEnterCombat: () => void;
  onExitCombat: () => void;
  onCycleSubSteps: () => void;
  onReset: () => void;
}

export function ControlPanel({
  lastAction,
  onCombatDamage,
  onHeavyCombatDamage,
  onCreatureDies,
  onLethal,
  onDeclareAttackers,
  onDeclareBlockers,
  onDamageStep,
  onEnterCombat,
  onExitCombat,
  onCycleSubSteps,
  onReset,
}: ControlPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [pos, setPos] = useState<DragPos | null>(null);

  function onHeaderPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const panel = panelRef.current;
    if (!panel) return;
    // Ignore non-primary buttons (right-click / middle-click).
    if (e.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    // Seed pos with current rect so the next pointermove computes
    // deltas against a known origin. First seed also flips the panel
    // from Tailwind top-20 right-4 to inline left/top with no visual
    // jump.
    setPos({ x: rect.left, y: rect.top });
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHeaderPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const panel = panelRef.current;
    const w = panel?.offsetWidth ?? 320;
    // Clamp so at least 80px of the header stays in viewport each
    // axis (otherwise users could drag the panel off-screen with no
    // way to recover except a page reload).
    const minX = -w + 80;
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 40;
    const x = Math.max(minX, Math.min(e.clientX - drag.offsetX, maxX));
    const y = Math.max(0, Math.min(e.clientY - drag.offsetY, maxY));
    setPos({ x, y });
  }

  function onHeaderPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointerCancel arrives without an active capture sometimes
      // (browser quirk); ignore.
    }
  }

  // Position top-right by default so the panel doesn't overlap the
  // action panel (bottom-right per tabletop T2). z-50 sits above all
  // other game chrome. After drag, switch to inline coords.
  const baseClasses =
    'w-80 max-h-[calc(100vh-6rem)] flex flex-col bg-zinc-900/95 ' +
    'border border-zinc-700 rounded-lg shadow-xl p-4 z-50 text-sm';
  const positionClasses = pos == null ? 'fixed top-20 right-4' : 'fixed';
  const positionStyle =
    pos != null ? { left: `${pos.x}px`, top: `${pos.y}px` } : undefined;

  return (
    <div
      ref={panelRef}
      // Bundle 5 polish (2026-05-12) — panel can grow past viewport
      // height once 10+ trigger buttons exist. max-h + flex-col cap
      // the panel; the inner button list scrolls (overflow-y-auto).
      // Header + intro stay pinned at top, status footer at bottom.
      className={`${positionClasses} ${baseClasses}`}
      style={positionStyle}
      data-testid="cinematic-lab-panel"
    >
      {/* Drag handle. Wraps the heading + intro copy; buttons below
          are NOT in the drag region so pointer-down on a button goes
          straight to onClick. cursor-move + a subtle bottom border
          signals draggability. */}
      <div
        data-testid="cinematic-lab-drag-handle"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        className="cursor-move select-none -mx-4 -mt-4 px-4 pt-3 pb-2 mb-3 border-b border-zinc-700/40"
      >
        <h2 className="text-base font-bold text-zinc-100 mb-1">
          Cinematic lab
          <span className="ml-2 text-[10px] font-normal text-zinc-500 align-middle">
            (drag to move)
          </span>
        </h2>
        <p className="text-xs text-zinc-400">
          Click a button to trigger a Bundle 5 / Bundle 6 effect.
          Reset between runs to re-fire.
        </p>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1 pr-1">
        <LabButton
          testid="trigger-combat-damage"
          slices="5-A · 5-B · 5-C"
          label="Combat damage hit"
          description="Parcels traverse arrow + portrait bloom + viewport freeze-frame."
          onClick={onCombatDamage}
        />
        <LabButton
          testid="trigger-heavy-combat-damage"
          slices="5-A heavy"
          label="Combat damage (20)"
          description="20-parcel HEAVY stream — life ticks 40 → 20 with the per-tick scale-pop + sustained red on the LifeBadge."
          onClick={onHeavyCombatDamage}
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
          description="Attack arrows ink-overlay pen-stroke draw-in (400ms / arrow). No blockers in this state."
          onClick={onDeclareAttackers}
        />
        <LabButton
          testid="trigger-declare-blockers"
          slices="6-B"
          label="Declare blockers"
          description="Block arrow snap-in (200ms cubic-bezier overshoot). Click AFTER declare-attackers to see the timing contrast."
          onClick={onDeclareBlockers}
        />
        <LabButton
          testid="trigger-damage-step"
          slices="6-C"
          label="Damage step (cross-dissolve)"
          description="Shimmer cool (first-strike) → 1500ms hold → warm (regular) via 300ms stroke transition."
          onClick={onDamageStep}
        />
        <LabButton
          testid="trigger-enter-combat"
          slices="2-A"
          label="Enter combat"
          description="Phase transitions PRECOMBAT_MAIN → COMBAT. Slate-pulse counter increments + vignette ramps in over 350ms."
          onClick={onEnterCombat}
        />
        <LabButton
          testid="trigger-exit-combat"
          slices="2-A"
          label="Exit combat"
          description="Phase transitions COMBAT → POSTCOMBAT_MAIN. Slate-pulse counter increments + vignette ramps out over 250ms."
          onClick={onExitCombat}
        />
        <LabButton
          testid="trigger-cycle-substeps"
          slices="2-A · 2-C preview"
          label="Cycle combat sub-steps"
          description="Walks through BEGIN_COMBAT → DECLARE_ATTACKERS → … → END_COMBAT with 1500ms hold each (verification surface for 2-C)."
          onClick={onCycleSubSteps}
        />
        <LabButton
          testid="trigger-reset"
          slices="reset"
          label="Reset fixture"
          description="Restore life=40, undo deaths/lethal, strip blockers, clear damage step."
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
