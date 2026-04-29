import type { WebGameView } from '../api/schemas';

/* ---------- phase timeline (slice 28) ---------- */

/**
 * Each phase is a colored segment on the timeline. {@code steps} are
 * the upstream {@code PhaseStep} enum names that fall within the
 * phase, in turn order. {@code accent} is the Tailwind color stem
 * used for the segment fill, label, and active-step glow. {@code label}
 * is the human-readable phase name shown above the segment.
 *
 * <p>Segment widths are weighted by step count (3 + 1 + 6 + 1 + 2 =
 * 13 ticks total) so the visual density matches the time density of
 * the actual turn — combat dominates because it has the most
 * sub-steps.
 */
type PhaseConfig = {
  label: string;
  /** Tailwind text color for the phase label (active state). */
  fgClass: string;
  /** Tailwind background-color class for ticks + active orb. */
  bgClass: string;
  /** Tailwind background-color class for the saturated track bar. */
  trackClass: string;
  /** RGB string used by the bloom inline-style box-shadow. */
  glowRgb: string;
  /**
   * Render per-step labels beneath each tick. Only true for Combat —
   * matches the reference mock where the multi-step combat phase
   * gets sub-labels but Main / Beginning / End stay clean.
   */
  showStepLabels?: boolean;
  steps: { name: string; short: string }[];
};

const TIMELINE_PHASES: PhaseConfig[] = [
  {
    label: 'Beginning',
    fgClass: 'text-cyan-300',
    bgClass: 'bg-cyan-400',
    trackClass: 'bg-cyan-500/70',
    glowRgb: '34, 211, 238',
    steps: [
      { name: 'UNTAP', short: 'Untap' },
      { name: 'UPKEEP', short: 'Upkeep' },
      { name: 'DRAW', short: 'Draw' },
    ],
  },
  {
    label: 'Main Phase 1',
    fgClass: 'text-sky-300',
    bgClass: 'bg-sky-400',
    trackClass: 'bg-sky-500/70',
    glowRgb: '56, 189, 248',
    steps: [{ name: 'PRECOMBAT_MAIN', short: 'Main 1' }],
  },
  {
    label: 'Combat',
    fgClass: 'text-red-300',
    bgClass: 'bg-red-400',
    trackClass: 'bg-red-500/70',
    glowRgb: '248, 113, 113',
    showStepLabels: true,
    steps: [
      { name: 'BEGIN_COMBAT', short: 'Begin' },
      { name: 'DECLARE_ATTACKERS', short: 'Attackers' },
      { name: 'DECLARE_BLOCKERS', short: 'Blockers' },
      { name: 'FIRST_COMBAT_DAMAGE', short: '1st Strike' },
      { name: 'COMBAT_DAMAGE', short: 'Damage' },
      { name: 'END_COMBAT', short: 'End' },
    ],
  },
  {
    label: 'Main Phase 2',
    fgClass: 'text-emerald-300',
    bgClass: 'bg-emerald-400',
    trackClass: 'bg-emerald-500/70',
    glowRgb: '74, 222, 128',
    steps: [{ name: 'POSTCOMBAT_MAIN', short: 'Main 2' }],
  },
  {
    label: 'End',
    fgClass: 'text-purple-300',
    bgClass: 'bg-purple-400',
    trackClass: 'bg-purple-500/70',
    glowRgb: '192, 132, 252',
    steps: [
      { name: 'END_TURN', short: 'End Turn' },
      { name: 'CLEANUP', short: 'Cleanup' },
    ],
  },
];

/**
 * Horizontal turn-progress timeline. Highlights the current step
 * with a pulsing bloom orb in the phase's accent color; all other
 * ticks dim out. Mirrors the visual idiom from the user's reference
 * mock — colored segments, ticks at each sub-step, glowing
 * "current position" orb.
 *
 * <p>The wire serializes upstream's {@code PhaseStep} enum via
 * {@code .name()} (see GameViewMapper), so we match {@code step}
 * directly against the enum names in {@link TIMELINE_PHASES}.
 * {@code FIRST_COMBAT_DAMAGE} only fires when first strike or double
 * strike is in play; the tick is always rendered (so the phase
 * geometry is consistent across turns) but only lights up when the
 * engine actually visits that step.
 */
export function PhaseTimeline({ gameView }: { gameView: WebGameView }) {
  const totalSteps = TIMELINE_PHASES.reduce(
    (n, p) => n + p.steps.length,
    0,
  );
  return (
    <div
      data-testid="phase-timeline"
      className="flex items-stretch gap-2 px-4 py-2 bg-zinc-950 border-b border-zinc-800 select-none"
    >
      <div className="flex flex-col justify-center pr-3 border-r border-zinc-800 min-w-[5.5rem]">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">
          Turn {gameView.turn}
        </div>
        <div
          data-testid="active-player-name"
          className="text-sm font-medium text-zinc-200 truncate"
          title={gameView.activePlayerName}
        >
          {gameView.activePlayerName || '—'}
        </div>
      </div>
      <div className="flex-1 flex items-start gap-1.5">
        {TIMELINE_PHASES.map((phase) => (
          <PhaseSegment
            key={phase.label}
            phase={phase}
            activeStep={gameView.step}
            totalSteps={totalSteps}
          />
        ))}
      </div>
    </div>
  );
}

function PhaseSegment({
  phase,
  activeStep,
  totalSteps,
}: {
  phase: PhaseConfig;
  activeStep: string;
  totalSteps: number;
}) {
  const isActivePhase = phase.steps.some((s) => s.name === activeStep);
  return (
    <div
      data-testid="phase-segment"
      data-phase={phase.label}
      data-active-phase={isActivePhase || undefined}
      className="flex flex-col"
      style={{ flex: phase.steps.length / totalSteps }}
    >
      <div
        className={
          'text-[10px] uppercase tracking-wider mb-1 ' +
          (isActivePhase ? phase.fgClass + ' font-semibold' : 'text-zinc-600')
        }
      >
        {phase.label}
      </div>
      <div className="relative flex items-center h-5">
        {/* Track bar — saturated phase color, slightly thicker than v1 */}
        <div
          className={
            'absolute inset-x-0 h-1.5 rounded-full ' + phase.trackClass
          }
        />
        {/* Step ticks */}
        {phase.steps.map((step, idx) => {
          const isActiveStep = step.name === activeStep;
          const left = `${((idx + 0.5) / phase.steps.length) * 100}%`;
          return (
            <div
              key={step.name}
              data-testid="phase-tick"
              data-step={step.name}
              data-active-step={isActiveStep || undefined}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left, top: '50%' }}
              title={step.short}
            >
              {isActiveStep ? (
                <div
                  data-testid="active-step-orb"
                  className={
                    'w-3.5 h-3.5 rounded-full animate-pulse ' + phase.bgClass
                  }
                  style={{
                    boxShadow:
                      `0 0 22px 6px rgba(${phase.glowRgb}, 0.55), ` +
                      `0 0 8px 2px rgba(${phase.glowRgb}, 0.95)`,
                  }}
                />
              ) : (
                <div
                  className={
                    'w-2 h-2 rounded-full ' +
                    (isActivePhase
                      ? phase.bgClass + ' opacity-80'
                      : 'bg-zinc-500')
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Per-step labels row — only rendered for phases with showStepLabels
          (currently Combat) so single-step phases don't get a redundant
          duplicate of their phase header. */}
      {phase.showStepLabels && (
        <div
          data-testid="phase-step-labels"
          className="relative h-3 mt-0.5"
        >
          {phase.steps.map((step, idx) => {
            const isActiveStep = step.name === activeStep;
            const left = `${((idx + 0.5) / phase.steps.length) * 100}%`;
            return (
              <span
                key={step.name}
                data-testid="phase-step-label"
                data-step={step.name}
                className={
                  'absolute -translate-x-1/2 text-[9px] uppercase tracking-wide whitespace-nowrap ' +
                  (isActiveStep
                    ? phase.fgClass + ' font-semibold'
                    : 'text-zinc-500')
                }
                style={{ left, top: 0 }}
              >
                {step.short}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
