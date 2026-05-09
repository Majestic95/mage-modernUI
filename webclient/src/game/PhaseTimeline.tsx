import type { WebGameView } from '../api/schemas';
import { useLayoutVariant } from '../layoutVariants';

/* ---------- phase timeline (slice 28; bundle 3-A 2026-05-09) ---------- */

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
    showStepLabels: true,
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
    showStepLabels: true,
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
    showStepLabels: true,
    steps: [{ name: 'POSTCOMBAT_MAIN', short: 'Main 2' }],
  },
  {
    label: 'End',
    fgClass: 'text-purple-300',
    bgClass: 'bg-purple-400',
    trackClass: 'bg-purple-500/70',
    glowRgb: '192, 132, 252',
    showStepLabels: true,
    steps: [
      { name: 'END_TURN', short: 'End Turn' },
      { name: 'CLEANUP', short: 'Cleanup' },
    ],
  },
];

/**
 * Derived priority state for the active sub-step ribbon — bundle 3-A
 * (2026-05-09). Surfaces "is this priority moment mine, am I auto-passing
 * through it, or am I waiting on someone else." Computed once at the
 * top of {@link PhaseTimeline} from {@code gameView} and threaded
 * down to {@link PhaseSegment}; the segment renders the suffix only
 * when its phase is the active combat phase in compact (tabletop)
 * mode, so non-combat phases ignore the prop entirely.
 *
 * <p>The waiting-on copy intentionally surfaces the priority-holder's
 * name from {@code gameView.priorityPlayerName} (a top-level field,
 * not a per-player crawl), so the source of truth survives if the
 * matched-player crawl can't find {@code me} (defensive fallback for
 * spectator-style flows where {@code myPlayerId} doesn't resolve).
 */
type PriorityStatus =
  | { kind: 'priority'; waitingOn: '' }
  | { kind: 'passing'; waitingOn: '' }
  | { kind: 'waiting'; waitingOn: string };

function deriveCombatPriorityStatus(gameView: WebGameView): PriorityStatus {
  const me = gameView.players.find((p) => p.playerId === gameView.myPlayerId);
  if (!me) return { kind: 'waiting', waitingOn: gameView.priorityPlayerName };
  if (me.hasPriority) return { kind: 'priority', waitingOn: '' };
  if (me.skipState) return { kind: 'passing', waitingOn: '' };
  return { kind: 'waiting', waitingOn: gameView.priorityPlayerName };
}

const PRIORITY_STATUS_LABEL: Record<PriorityStatus['kind'], string> = {
  priority: 'PRIORITY',
  passing: 'PASSING',
  waiting: 'WAITING',
};

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
 *
 * <p><b>Bundle 3-A (2026-05-09)</b> — when the active phase is
 * {@code Combat} in tabletop's compact mode, the combat segment
 * expands to show its sub-step labels (other phases stay
 * label-suppressed per the P3 header-budget invariant), past combat
 * sub-steps get a check-mark prefix and muted color, and the phase
 * label gains a {@code · PRIORITY / · PASSING / · WAITING (name)}
 * ribbon derived from {@link deriveCombatPriorityStatus}. Outside
 * combat the header collapses back to ~24px exactly as before.
 */
export function PhaseTimeline({ gameView }: { gameView: WebGameView }) {
  const variant = useLayoutVariant();
  const compact = variant === 'tabletop';
  const totalSteps = TIMELINE_PHASES.reduce(
    (n, p) => n + p.steps.length,
    0,
  );
  const priorityStatus = deriveCombatPriorityStatus(gameView);
  // Polish-pass P3 (audit must-close #4) — for variant=tabletop the
  // top header is slimmed: drop the redundant "Turn N / activePlayer"
  // left block (already in the central focal P2), drop sub-step labels
  // for non-combat phases (combat phase reintroduces them in 3-A only
  // when it's the active phase), and shrink py-2 → py-1. Net ~52px →
  // ~24px header outside combat, ~38px during combat. variant=current
  // keeps the original full timeline.
  return (
    <div
      data-testid="phase-timeline"
      data-compact={compact || undefined}
      className={
        'flex items-stretch gap-2 px-4 bg-zinc-950 border-b border-zinc-800 select-none ' +
        (compact ? 'py-1' : 'py-2')
      }
    >
      {!compact && (
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
      )}
      <div className="flex-1 flex items-start gap-1.5">
        {TIMELINE_PHASES.map((phase) => (
          <PhaseSegment
            key={phase.label}
            phase={phase}
            activeStep={gameView.step}
            activePhase={gameView.phase}
            totalSteps={totalSteps}
            compact={compact}
            priorityStatus={priorityStatus}
          />
        ))}
      </div>
    </div>
  );
}

function PhaseSegment({
  phase,
  activeStep,
  activePhase,
  totalSteps,
  compact = false,
  priorityStatus,
}: {
  phase: PhaseConfig;
  activeStep: string;
  activePhase: string;
  totalSteps: number;
  compact?: boolean;
  priorityStatus: PriorityStatus;
}) {
  const isActivePhaseByStep = phase.steps.some((s) => s.name === activeStep);
  const activeStepIdx = phase.steps.findIndex((s) => s.name === activeStep);
  // Bundle 3-A — only the combat phase reintroduces sub-step labels
  // in compact mode, and only when it's currently active. This is the
  // surgical exemption to the P3 header-budget invariant.
  //
  // 3-X.2 (B.4) — also treat the segment as active when gameView.phase
  // says we're in COMBAT but gameView.step is an unknown enum value
  // (defensive against upstream adding a new combat sub-step we
  // haven't enumerated). The runway still expands with all six known
  // ticks in their default state — better than a silent collapse to
  // compact-no-runway, which would mislead the user about whether
  // they're in combat at all.
  const isActivePhaseByPhase =
    phase.label === 'Combat' && activePhase === 'COMBAT';
  const isActivePhase = isActivePhaseByStep || isActivePhaseByPhase;
  const isCombatActive = compact && phase.label === 'Combat' && isActivePhase;
  const showSubStepLabels =
    (phase.showStepLabels && !compact) || isCombatActive;

  return (
    <div
      data-testid="phase-segment"
      data-phase={phase.label}
      data-active-phase={isActivePhase || undefined}
      data-combat-active={isCombatActive || undefined}
      className="flex flex-col"
      style={{ flex: phase.steps.length / totalSteps }}
    >
      <div
        className={
          'text-[10px] uppercase tracking-wider mb-1 whitespace-nowrap overflow-hidden text-ellipsis ' +
          (isActivePhase ? phase.fgClass + ' font-semibold' : 'text-zinc-600')
        }
      >
        {phase.label}
        {isCombatActive && <PriorityStatusSuffix status={priorityStatus} />}
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
      {/* Per-step labels row — shown for all phases in non-compact
          variant; ALSO shown for the combat phase in compact mode
          when it's the active phase (bundle 3-A). Past combat
          sub-steps in compact+combat mode get a ✓ prefix + muted
          color so the runway "shape" of the combat round is legible
          at a glance. */}
      {showSubStepLabels && (
        <div
          data-testid="phase-step-labels"
          data-combat-runway={isCombatActive || undefined}
          className="relative h-3 mt-0.5"
        >
          {phase.steps.map((step, idx) => {
            const isActiveStep = step.name === activeStep;
            const isPastStep =
              isCombatActive && activeStepIdx >= 0 && idx < activeStepIdx;
            const left = `${((idx + 0.5) / phase.steps.length) * 100}%`;
            const position = isActiveStep
              ? 'active'
              : isPastStep
                ? 'past'
                : 'future';
            return (
              <span
                key={step.name}
                data-testid="phase-step-label"
                data-step={step.name}
                data-step-position={position}
                className={
                  'absolute -translate-x-1/2 text-[9px] uppercase tracking-wide whitespace-nowrap ' +
                  (isActiveStep
                    ? phase.fgClass + ' font-semibold'
                    : isPastStep
                      ? 'text-zinc-600'
                      : 'text-zinc-500')
                }
                style={{ left, top: 0 }}
              >
                {isPastStep && (
                  <span data-testid="phase-step-past-mark" className="mr-0.5">
                    ✓
                  </span>
                )}
                {step.short}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Priority-status suffix attached to the Combat phase label when the
 * combat phase is active in compact (tabletop) mode. Renders inline
 * inside the phase-label `<div>`, which already has
 * {@code whitespace-nowrap overflow-hidden text-ellipsis}, so a long
 * waiting-on player name truncates at the segment boundary instead
 * of pushing into neighbor segments.
 *
 * <p><b>A11y (3-X.1 A.4):</b> the visible decoration (bullets +
 * uppercase status word + name) is purely typographic, so the
 * composite span carries an {@code aria-label} that reads naturally
 * to assistive tech ("Priority status: you have priority" /
 * "Priority status: waiting on lyrra"). The inner spans keep their
 * visible text for sighted users; aria-label on the parent overrides
 * the read-out of the children.
 */
function PriorityStatusSuffix({ status }: { status: PriorityStatus }) {
  const label = PRIORITY_STATUS_LABEL[status.kind];
  const colorClass =
    status.kind === 'priority'
      ? 'text-amber-300 font-semibold'
      : 'text-zinc-400';
  const ariaLabel =
    status.kind === 'priority'
      ? 'Priority status: you have priority'
      : status.kind === 'passing'
        ? 'Priority status: auto-passing'
        : status.waitingOn
          ? `Priority status: waiting on ${status.waitingOn}`
          : 'Priority status: waiting';
  return (
    <span
      data-testid="phase-priority-suffix"
      data-priority-kind={status.kind}
      aria-label={ariaLabel}
      className="ml-1"
    >
      <span className="opacity-50 mr-1">·</span>
      <span className={colorClass}>{label}</span>
      {status.kind === 'waiting' && (
        <>
          <span className="opacity-50 mx-1">·</span>
          <span
            data-testid="phase-priority-waiting-on"
            data-waiting-unknown={!status.waitingOn || undefined}
            className="text-zinc-400"
            title={status.waitingOn || 'Unknown opponent'}
          >
            {status.waitingOn || '—'}
          </span>
        </>
      )}
    </span>
  );
}
