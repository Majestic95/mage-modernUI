import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuthStore } from '../auth/store';
import { GameStream } from '../game/stream';
import { useGameStore } from '../game/store';
import {
  deriveInteractionMode,
  type InteractionMode,
} from '../game/interactionMode';
import { isBoardClickable, routeObjectClick } from '../game/clickRouter';
import type {
  WebCardView,
  WebCommandObjectView,
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';
import { ActionPanel } from './ActionPanel';
import { GameDialog } from './GameDialog';

interface Props {
  gameId: string;
  onLeave: () => void;
}

/**
 * Slice A static game window — read-only render of the latest
 * {@link WebGameView} (per ADR 0005 §5.1).
 *
 * <p>Layout: opponent at top, controlling player at bottom. Each side
 * shows life total, hand count (or hand cards for self), zone counts,
 * mana pool, and battlefield as named cards with tapped/sick markers.
 * Stack, combat groups, graveyard / exile / sideboard panels and chat
 * land in slice B; player input lands in slice C (ADR §5.2).
 *
 * <p>The component owns one {@link GameStream} for its lifetime — open
 * on mount, close on unmount or {@code onLeave}. Frame dispatch goes
 * to {@link useGameStore}; this component just reads.
 */
export function Game({ gameId, onLeave }: Props) {
  const session = useAuthStore((s) => s.session);
  const connection = useGameStore((s) => s.connection);
  const closeReason = useGameStore((s) => s.closeReason);
  const protocolError = useGameStore((s) => s.protocolError);
  const gameView = useGameStore((s) => s.gameView);
  const reset = useGameStore((s) => s.reset);

  // Memoized so children that need to send (ActionPanel, GameDialog)
  // get a stable reference. useMemo computes pre-render so the
  // lifecycle effect doesn't have to setState.
  const stream = useMemo(
    () => (session ? new GameStream({ gameId, token: session.token }) : null),
    [gameId, session],
  );

  useEffect(() => {
    if (!stream) return;
    // React 19 StrictMode dev runs effects setup → cleanup → setup
    // in quick succession. A naive synchronous open() fires a real
    // WebSocket connect on the first mount. The connect triggers
    // upstream's joinGame on the server, the cleanup immediately
    // closes the socket (EofException + 1006), and upstream is left
    // in a half-joined state until its 10-second recovery timer
    // fires "Forced join" — by which time the AI has played its
    // turn assuming the user is unresponsive, leaving the user
    // staring at someone else's Turn 1.
    //
    // Defer open() with setTimeout(0) so the StrictMode cleanup
    // cancels the timer before the network call ever happens. Only
    // the second mount actually opens the socket, and the server
    // sees exactly one joinGame.
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      stream.open();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stream.close();
      reset();
    };
  }, [stream, reset]);

  if (!session) {
    return (
      <div className="p-6 text-zinc-300">
        Not signed in.{' '}
        <button
          type="button"
          className="text-fuchsia-400 hover:text-fuchsia-300"
          onClick={onLeave}
        >
          Back to lobby
        </button>
      </div>
    );
  }

  return (
    // Slice 23 layout fix: pin the root to exactly viewport height
    // (h-screen + overflow-hidden) so internal panes (Battlefield
    // zones, GameLog entries) scroll independently rather than the
    // whole page growing as the game log accumulates entries. With
    // min-h-screen, the page grew past viewport once the log
    // exceeded the screen and the user had to scroll the entire
    // window to read the log / reach the action panel.
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      <Header
        gameId={gameId}
        connection={connection}
        closeReason={closeReason}
        gameView={gameView}
        onLeave={onLeave}
      />
      {protocolError && (
        <div role="alert" className="bg-red-900/40 border-b border-red-800 px-6 py-2 text-sm text-red-200">
          {protocolError}
        </div>
      )}
      {gameView && <PhaseTimeline gameView={gameView} />}
      <main className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {gameView ? (
            <Battlefield gv={gameView} stream={stream} />
          ) : (
            <Waiting connection={connection} />
          )}
        </div>
        {gameView && <GameLog />}
      </main>
      {gameView && <ActionPanel stream={stream} />}
      <GameDialog stream={stream} />
      <GameEndOverlay onLeave={onLeave} />
    </div>
  );
}

/* ---------- game-end overlay (slice 19 / B5) ---------- */

/**
 * Game / match end overlay. Two states:
 *
 * <ul>
 *   <li>{@code gameEnd} set (match over) → modal summary with the
 *       upstream {@code matchInfo}, win/wins-needed score, and a
 *       Leave button.</li>
 *   <li>{@code gameOverPending} set but no {@code gameEnd} yet
 *       (best-of-N: game ended, match continues) → centered
 *       banner with the {@code lastWrapped.message} and "waiting
 *       for next game" hint. Cleared by the next {@code gameInit}.</li>
 * </ul>
 *
 * <p>The board stays visible behind the banner / modal so the
 * user can see the final state. The match-end modal is
 * blocking — the only path forward is Leave (no rematch flow yet).
 */
function GameEndOverlay({ onLeave }: { onLeave: () => void }) {
  const gameEnd = useGameStore((s) => s.gameEnd);
  const gameOverPending = useGameStore((s) => s.gameOverPending);
  const lastWrapped = useGameStore((s) => s.lastWrapped);

  if (gameEnd) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        data-testid="game-end-modal"
        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
      >
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-8 max-w-md w-full space-y-4 shadow-2xl text-center">
          <h2
            className={
              'text-2xl font-semibold ' +
              (gameEnd.won ? 'text-emerald-300' : 'text-red-300')
            }
          >
            {gameEnd.won ? 'Match won' : 'Match lost'}
          </h2>
          {gameEnd.matchInfo && (
            <p className="text-sm text-zinc-300">{gameEnd.matchInfo}</p>
          )}
          {gameEnd.gameInfo && (
            <p className="text-sm text-zinc-400">{gameEnd.gameInfo}</p>
          )}
          <p className="text-zinc-200">
            <span className="text-zinc-500 mr-2">Score:</span>
            <span className="font-mono">
              {gameEnd.wins}/{gameEnd.winsNeeded}
            </span>
          </p>
          {gameEnd.additionalInfo && (
            <p className="text-xs text-zinc-500">{gameEnd.additionalInfo}</p>
          )}
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={onLeave}
              className="px-5 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium"
            >
              Back to lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameOverPending) {
    return (
      <div
        data-testid="game-over-banner"
        className="fixed inset-x-0 top-16 z-40 flex justify-center pointer-events-none"
      >
        <div className="bg-zinc-900/95 border border-amber-700/60 rounded-lg px-6 py-3 shadow-xl text-center">
          <p className="text-amber-300 font-semibold">Game over</p>
          {lastWrapped?.message && (
            <p className="text-sm text-zinc-300 mt-1">
              {lastWrapped.message.replace(/<[^>]+>/g, '')}
            </p>
          )}
          <p className="text-xs text-zinc-500 mt-1">
            Waiting for the next game…
          </p>
        </div>
      </div>
    );
  }

  return null;
}

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
function PhaseTimeline({ gameView }: { gameView: WebGameView }) {
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

/* ---------- game log (slice 18) ---------- */

/**
 * Right-side strip showing the engine's running commentary —
 * "alice plays Forest", "Bolt deals 3 to bob", "alice's turn", etc.
 * Each entry is a {@code gameInform} message accumulated by the
 * store (see {@link useGameStore.gameLog}). Auto-scrolls to bottom
 * on new entries.
 *
 * <p>Slice 18 / ADR 0008 B3. Closes the largest debugging gap in
 * 1v1 play: previously the user had no record of what just
 * happened beyond the live board state.
 */
function GameLog() {
  const entries = useGameStore((s) => s.gameLog);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <aside
      data-testid="game-log"
      className="w-72 border-l border-zinc-800 bg-zinc-900/40 flex flex-col"
    >
      <header className="text-xs text-zinc-500 uppercase tracking-wide px-3 py-2 border-b border-zinc-800">
        Game log ({entries.length})
      </header>
      <div
        ref={scrollRef}
        data-testid="game-log-entries"
        className="flex-1 overflow-y-auto p-2 space-y-1 text-xs"
      >
        {entries.length === 0 ? (
          <p className="text-zinc-600 italic">No events yet.</p>
        ) : (
          entries.map((e) => (
            <div
              key={`${e.id}-${e.turn}`}
              data-testid="game-log-entry"
              className="text-zinc-300 leading-snug"
            >
              {(e.turn > 0 || e.phase) && (
                <span className="text-zinc-600 mr-1.5 font-mono">
                  T{e.turn}
                  {e.phase && `·${e.phase.slice(0, 4)}`}
                </span>
              )}
              <LogMessage text={e.message} />
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

/**
 * Strip upstream's HTML-flavored markup safely (same approach as
 * GameDialog's renderer; see GameDialog.tsx renderUpstreamMarkup).
 * Inline here to avoid coupling — log entries are plain prose with
 * occasional &lt;font color&gt; highlights; we just render text and
 * drop any tags upstream emitted.
 */
function LogMessage({ text }: { text: string }) {
  const stripped = text.replace(/<[^>]+>/g, '');
  return <span>{stripped}</span>;
}

/* ---------- header ---------- */

function Header({
  gameId,
  connection,
  closeReason,
  gameView,
  onLeave,
}: {
  gameId: string;
  connection: string;
  closeReason: string;
  gameView: WebGameView | null;
  onLeave: () => void;
}) {
  // Slice 23: prominent "Your turn / Opponent's turn" indicator.
  // Compare by playerId (not name) — slice-16 U5 fix; controller-
  // hint suffixes can decorate priorityPlayerName in some flows.
  const me =
    gameView?.players.find((p) => p.playerId === gameView.myPlayerId) ?? null;
  const isMyTurn = !!me?.isActive;
  const hasMyPriority = !!me?.hasPriority;
  return (
    <header className="border-b border-zinc-800 px-6 py-2 flex items-center justify-between">
      <div className="flex items-baseline gap-4 text-sm">
        <span className="text-zinc-500">Game</span>
        <span className="font-mono text-xs text-zinc-400">{gameId}</span>
      </div>
      {gameView && (
        <div className="text-sm text-zinc-300 flex items-baseline gap-3">
          <span data-testid="turn-indicator"
                className={
                  'px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide '
                  + (isMyTurn
                    ? 'bg-emerald-600/30 text-emerald-200'
                    : 'bg-zinc-700/50 text-zinc-400')
                }>
            {isMyTurn ? 'Your turn' : "Opponent's turn"}
          </span>
          <span
            data-testid="priority-indicator"
            className={
              'text-xs '
              + (hasMyPriority ? 'text-amber-300' : 'text-zinc-500')
            }
          >
            {hasMyPriority ? 'Your priority' : 'Waiting for opponent'}
          </span>
        </div>
      )}
      <div className="flex items-center gap-3 text-xs">
        <ConnectionDot state={connection} reason={closeReason} />
        <button
          type="button"
          onClick={onLeave}
          className="text-zinc-400 hover:text-zinc-100"
        >
          Leave
        </button>
      </div>
    </header>
  );
}

function ConnectionDot({ state, reason }: { state: string; reason: string }) {
  const color =
    state === 'open'
      ? 'bg-emerald-400'
      : state === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : state === 'error'
          ? 'bg-red-500'
          : 'bg-zinc-600';
  const label = state === 'closed' && reason ? `closed: ${reason}` : state;
  return (
    <span className="flex items-center gap-1.5 text-zinc-500" title={label}>
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

/* ---------- waiting ---------- */

function Waiting({ connection }: { connection: string }) {
  if (connection === 'connecting') {
    return <Centered>Connecting…</Centered>;
  }
  if (connection === 'error' || connection === 'closed') {
    return <Centered>Connection {connection}.</Centered>;
  }
  return <Centered>Waiting for game state…</Centered>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-zinc-500">
      {children}
    </div>
  );
}

/* ---------- battlefield ---------- */

function Battlefield({
  gv,
  stream,
}: {
  gv: WebGameView;
  stream: GameStream | null;
}) {
  const pendingDialog = useGameStore((s) => s.pendingDialog);
  const clearDialog = useGameStore((s) => s.clearDialog);
  const me = useMemo(
    () => gv.players.find((p) => p.playerId === gv.myPlayerId) ?? null,
    [gv.players, gv.myPlayerId],
  );
  const opponents = useMemo(
    () => gv.players.filter((p) => p.playerId !== gv.myPlayerId),
    [gv.players, gv.myPlayerId],
  );

  // Slice 16: derive the interaction mode and route board clicks
  // through the shared clickRouter. The mode is a function of the
  // pending dialog + game view — pure derivation, no stored state.
  // Each mode (free, target, manaPay, declareAttackers,
  // declareBlockers, modal) has explicit dispatch in clickRouter,
  // replacing the slice-15 "if (targeting) ..." pattern.
  const mode: InteractionMode = useMemo(
    () => deriveInteractionMode(pendingDialog),
    [pendingDialog],
  );

  // Slice 16 / U5 fix: compare priority by playerId, not by
  // username. Upstream's getControllingPlayerHint can decorate
  // priorityPlayerName with " (as <name>)" suffixes (mind control,
  // control magic) which broke the prior name-based check even in
  // 1v1.
  const myPriority = !!me?.hasPriority;
  const canAct = isBoardClickable(mode, myPriority) && stream != null;

  const out = useMemo(
    () =>
      stream
        ? {
            sendObjectClick: (id: string) => stream.sendObjectClick(id),
            sendPlayerResponse: (
              mid: number,
              kind: 'uuid' | 'string' | 'boolean' | 'integer' | 'manaType',
              v: unknown,
            ) => stream.sendPlayerResponse(mid, kind, v),
            clearDialog,
          }
        : null,
    [stream, clearDialog],
  );

  const onObjectClick = (id: string) => {
    if (!out) return;
    routeObjectClick(mode, id, myPriority, out);
  };

  // Targetable players: derived from the mode (only target mode
  // exposes player UUIDs as legal clicks).
  const eligibleTargetIds =
    mode.kind === 'target' ? mode.eligibleIds : new Set<string>();

  // Slice 26 — combat highlighting:
  // - eligibleCombatIds: legal-attacker / legal-blocker set during the
  //   matching combat step. Empty in any other mode.
  // - combatRoles: which permanents are *currently* attacking or
  //   blocking, per gv.combat[]. Independent of mode — drives the
  //   ATK / BLK badges so the player can see what they've already
  //   committed to.
  const eligibleCombatIds: Set<string> =
    mode.kind === 'declareAttackers' || mode.kind === 'declareBlockers'
      ? mode.possibleIds
      : new Set<string>();
  const combatRoles = useMemo<Map<string, 'attacker' | 'blocker'>>(() => {
    const roles = new Map<string, 'attacker' | 'blocker'>();
    for (const grp of gv.combat ?? []) {
      for (const id of Object.keys(grp.attackers ?? {})) {
        roles.set(id, 'attacker');
      }
      for (const id of Object.keys(grp.blockers ?? {})) {
        roles.set(id, 'blocker');
      }
    }
    return roles;
  }, [gv.combat]);

  return (
    <div className="flex-1 flex flex-col">
      {/* Opponents row(s) — top */}
      <section className="flex-1 border-b border-zinc-800 p-4 space-y-4 overflow-auto">
        {opponents.map((p) => (
          <PlayerArea
            key={p.playerId}
            player={p}
            perspective="opponent"
            canAct={canAct}
            onObjectClick={onObjectClick}
            targetable={eligibleTargetIds.has(p.playerId)}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
        ))}
        {opponents.length === 0 && (
          <p className="text-zinc-500 italic">No opponents in this view.</p>
        )}
      </section>

      {/* Stack — between players (slice 27). Collapses to nothing
          when empty so the 50/50 opponents/self vertical split is
          undisturbed. */}
      <StackZone stack={gv.stack} />

      {/* Self — bottom */}
      <section className="flex-1 p-4 space-y-4 overflow-auto">
        {me ? (
          <>
            <PlayerArea
              player={me}
              perspective="self"
              canAct={canAct}
              onObjectClick={onObjectClick}
              targetable={eligibleTargetIds.has(me.playerId)}
              eligibleCombatIds={eligibleCombatIds}
              combatRoles={combatRoles}
            />
            <MyHand
              hand={gv.myHand}
              canAct={canAct}
              onObjectClick={onObjectClick}
              isMyTurn={!!me.isActive}
              hasPriority={!!me.hasPriority}
            />
          </>
        ) : (
          <p className="text-zinc-500 italic">
            Spectator view — no controlling player.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Stack zone — slice 27. Renders the spells / abilities currently on
 * the stack between the opponents row and the self row. Collapses to
 * {@code null} when empty so the surrounding layout doesn't shift.
 *
 * <p>Order: newest-first ({@code Object.values(...).reverse()}). The
 * upstream wire preserves insertion order via {@code LinkedHashMap}
 * (oldest first); reversing matches the MTGO/MTGA convention of
 * showing the top-of-stack at the top of the UI.
 *
 * <p>No click handlers in this slice — interacting with stack
 * objects is rare in 1v1 and would conflict with the free-priority
 * click router. The tooltip surfaces the rules text so the player
 * can see what's about to resolve.
 */
function StackZone({ stack }: { stack: Record<string, WebCardView> }) {
  const entries = Object.values(stack).reverse();
  if (entries.length === 0) {
    return null;
  }
  return (
    <section
      data-testid="stack-zone"
      className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2"
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
        Stack ({entries.length}) — top resolves first
      </div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((card, idx) => {
          const tooltip = [card.typeLine, ...(card.rules ?? [])]
            .filter(Boolean)
            .join('\n');
          return (
            <HoverCardDetail key={card.id} card={card}>
              <div
                data-testid="stack-entry"
                className={
                  'inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs ' +
                  'border border-zinc-700 bg-zinc-900'
                }
                title={tooltip || card.name}
              >
                <span className="font-medium text-zinc-100">{card.name}</span>
                {card.manaCost && (
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {card.manaCost}
                  </span>
                )}
                {idx === 0 && (
                  <span
                    data-testid="stack-top-marker"
                    className="text-[10px] font-semibold bg-fuchsia-500/30 text-fuchsia-200 px-1 rounded"
                  >
                    TOP
                  </span>
                )}
              </div>
            </HoverCardDetail>
          );
        })}
      </div>
    </section>
  );
}

function PlayerArea({
  player,
  perspective,
  canAct,
  onObjectClick,
  targetable,
  eligibleCombatIds,
  combatRoles,
}: {
  player: WebPlayerView;
  perspective: 'self' | 'opponent';
  canAct: boolean;
  onObjectClick: (id: string) => void;
  /**
   * True when a target dialog is pending and the player is a legal
   * target. Click-on-name then dispatches the player's UUID as the
   * target response. Slice 15.
   */
  targetable: boolean;
  /**
   * Slice 26 — IDs the engine considers legal attackers (during
   * declareAttackers) or legal blockers (during declareBlockers).
   * Empty set in any other mode.
   */
  eligibleCombatIds: Set<string>;
  /**
   * Slice 26 — permanents already in a combat group, mapped to
   * their role. Drives the ATK / BLK badge on each chip.
   */
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  const battlefield = Object.values(player.battlefield);
  return (
    <div
      data-testid={`player-area-${perspective}`}
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
    >
      <header className="flex items-baseline justify-between mb-2">
        <div className="flex items-baseline gap-3">
          {targetable ? (
            <button
              type="button"
              data-testid={`target-player-${perspective}`}
              onClick={() => onObjectClick(player.playerId)}
              className="font-medium text-fuchsia-300 hover:text-fuchsia-200 underline underline-offset-2"
              title="Click to target this player"
            >
              {player.name || '<unknown>'}
            </button>
          ) : (
            <span className="font-medium">{player.name || '<unknown>'}</span>
          )}
          {player.isActive && (
            <span className="text-xs bg-fuchsia-500/20 text-fuchsia-300 px-1.5 py-0.5 rounded">
              ACTIVE
            </span>
          )}
          {player.hasPriority && (
            <span className="text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
              PRIORITY
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-4 text-sm text-zinc-400">
          <span>
            <span className="text-zinc-500">Life</span>{' '}
            <span className="text-zinc-100 font-mono">{player.life}</span>
          </span>
          <span>
            <span className="text-zinc-500">Lib</span>{' '}
            <span className="font-mono">{player.libraryCount}</span>
          </span>
          <span>
            <span className="text-zinc-500">Hand</span>{' '}
            <span className="font-mono">{player.handCount}</span>
          </span>
          <span>
            <span className="text-zinc-500">Grave</span>{' '}
            <span className="font-mono">
              {Object.keys(player.graveyard).length}
            </span>
          </span>
          <ManaPool player={player} />
        </div>
      </header>
      <div className="flex flex-wrap gap-1.5">
        {battlefield.length === 0 ? (
          <span className="text-xs text-zinc-600 italic">
            No permanents yet.
          </span>
        ) : (
          battlefield.map((perm) => (
            <PermanentChip
              key={perm.card.id}
              perm={perm}
              canAct={canAct}
              onClick={onObjectClick}
              isEligibleCombat={eligibleCombatIds.has(perm.card.id)}
              combatRole={combatRoles.get(perm.card.id) ?? null}
            />
          ))
        )}
      </div>
      <CommandZone entries={player.commandList} />
    </div>
  );
}

/**
 * Command-zone strip — renders any commanders / emblems / dungeons /
 * planes the player has, keyed by upstream UUID. Slice 11 ships the
 * placeholder shape (chip with kind tag + name + tooltip on rules);
 * full card art lookup for the {@code commander} kind lands later
 * alongside the broader card-art initiative.
 */
function CommandZone({ entries }: { entries: WebCommandObjectView[] }) {
  if (!entries || entries.length === 0) {
    return null;
  }
  return (
    <div
      data-testid="command-zone"
      className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-2"
    >
      <span className="text-xs uppercase tracking-wide text-zinc-500 mr-1">
        Command
      </span>
      {entries.map((entry) => (
        <CommandChip key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function CommandChip({ entry }: { entry: WebCommandObjectView }) {
  const kindStyle =
    entry.kind === 'commander'
      ? 'border-amber-700/60 text-amber-200'
      : entry.kind === 'emblem'
        ? 'border-fuchsia-700/60 text-fuchsia-200'
        : entry.kind === 'dungeon'
          ? 'border-emerald-700/60 text-emerald-200'
          : entry.kind === 'plane'
            ? 'border-sky-700/60 text-sky-200'
            : 'border-zinc-700 text-zinc-200';
  return (
    <span
      data-testid="command-chip"
      data-kind={entry.kind}
      className={`inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs border bg-zinc-900 ${kindStyle}`}
      title={entry.rules.join('\n') || entry.kind}
    >
      <span className="uppercase text-[10px] tracking-wide opacity-70">
        {entry.kind}
      </span>
      <span className="font-medium">{entry.name || '<unknown>'}</span>
    </span>
  );
}

function ManaPool({ player }: { player: WebPlayerView }) {
  const pool = player.manaPool;
  const total =
    pool.red + pool.green + pool.blue + pool.white + pool.black + pool.colorless;
  if (total === 0) return null;
  const cells: Array<[string, number, string]> = [
    ['W', pool.white, 'text-amber-100'],
    ['U', pool.blue, 'text-sky-300'],
    ['B', pool.black, 'text-zinc-300'],
    ['R', pool.red, 'text-red-400'],
    ['G', pool.green, 'text-emerald-400'],
    ['C', pool.colorless, 'text-zinc-400'],
  ];
  return (
    <span className="flex gap-1 font-mono text-xs">
      {cells
        .filter(([, n]) => n > 0)
        .map(([sym, n, cls]) => (
          <span key={sym} className={cls}>
            {n}
            {sym}
          </span>
        ))}
    </span>
  );
}

function PermanentChip({
  perm,
  canAct,
  onClick,
  isEligibleCombat,
  combatRole,
}: {
  perm: WebPermanentView;
  canAct: boolean;
  onClick: (id: string) => void;
  /**
   * Slice 26 — the engine has marked this permanent as a legal
   * attacker (declareAttackers) or legal blocker (declareBlockers).
   * Renders an amber highlight ring so the player can see at a
   * glance which creatures the click-to-toggle gesture applies to.
   */
  isEligibleCombat: boolean;
  /**
   * Slice 26 — non-null when this permanent is currently in a
   * combat group ({@code gv.combat[]}). Drives the ATK / BLK badge.
   */
  combatRole: 'attacker' | 'blocker' | null;
}) {
  const tapped = perm.tapped;
  const sick = perm.summoningSickness;
  const baseClasses =
    'inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs ' +
    'border border-zinc-700 bg-zinc-900 ' +
    (tapped ? 'opacity-60 rotate-3' : '') +
    (sick ? ' italic' : '');
  const clickableClasses =
    canAct
      ? ' cursor-pointer hover:border-fuchsia-500 hover:bg-zinc-800'
      : ' cursor-default opacity-90';
  // Amber ring on legal-combat permanents during declare-attackers /
  // declare-blockers. Picked over fuchsia (target highlight) and
  // emerald (success states) so the three "click-me-now" cues are
  // visually distinct.
  const combatRing = isEligibleCombat
    ? ' ring-2 ring-amber-400/60'
    : '';
  return (
    <HoverCardDetail card={perm.card}>
    <button
      type="button"
      data-testid="permanent"
      data-tapped={tapped}
      data-combat-eligible={isEligibleCombat || undefined}
      data-combat-role={combatRole ?? undefined}
      disabled={!canAct}
      onClick={() => onClick(perm.card.id)}
      className={baseClasses + clickableClasses + combatRing}
      title={
        canAct
          ? `${perm.card.name} — click to tap/activate`
          : perm.card.typeLine
      }
    >
      <span className="font-medium text-zinc-100">{perm.card.name}</span>
      {tapped && <span className="text-zinc-500">(T)</span>}
      {perm.damage > 0 && (
        <span className="text-red-300">−{perm.damage}</span>
      )}
      {combatRole === 'attacker' && (
        <span
          data-testid="combat-badge-attacker"
          className="text-[10px] font-semibold bg-red-500/30 text-red-200 px-1 rounded"
          title="Attacking"
        >
          ATK
        </span>
      )}
      {combatRole === 'blocker' && (
        <span
          data-testid="combat-badge-blocker"
          className="text-[10px] font-semibold bg-sky-500/30 text-sky-200 px-1 rounded"
          title="Blocking"
        >
          BLK
        </span>
      )}
    </button>
    </HoverCardDetail>
  );
}

function MyHand({
  hand,
  canAct,
  onObjectClick,
  isMyTurn,
  hasPriority,
}: {
  hand: Record<string, WebCardView>;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  isMyTurn: boolean;
  hasPriority: boolean;
}) {
  const cards = Object.values(hand);
  // Slice 23: clearer reason when hand is disabled.
  // - !hasPriority → engine isn't waiting on you
  // - hasPriority && !isMyTurn → you can react with instants but
  //   not play lands / sorceries; the user-typical click on a
  //   Forest is silently rejected by upstream because it's not
  //   their main phase.
  // The hint text spells out the rule so the user doesn't have to
  // internalize Magic's priority/timing system to understand why.
  const disabledHint = !hasPriority
    ? 'Waiting for opponent'
    : !isMyTurn
      ? 'Wait for your turn — most cards are sorcery-speed'
      : '';

  const cardTooltip = (card: WebCardView) => {
    if (canAct && isMyTurn) return `${card.name} — click to play/cast`;
    if (canAct && !isMyTurn) {
      // Instant-speed only on opponent's turn. Today we don't
      // distinguish instants in the UI; the engine will gameError
      // on illegal sorcery-speed clicks. Hint accordingly.
      return `${card.name} — only instants are playable on opponent's turn`;
    }
    return card.typeLine;
  };

  return (
    <div
      data-testid="my-hand"
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
    >
      <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wide flex items-baseline justify-between">
        <span>Your hand ({cards.length})</span>
        {disabledHint && (
          <span
            data-testid="hand-disabled-hint"
            className="text-[10px] normal-case tracking-normal text-zinc-500 italic"
          >
            {disabledHint}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {cards.length === 0 ? (
          <span className="text-xs text-zinc-600 italic">Empty hand.</span>
        ) : (
          cards.map((card) => (
            <HoverCardDetail key={card.id} card={card}>
              <button
                type="button"
                data-testid="hand-card"
                disabled={!canAct}
                onClick={() => onObjectClick(card.id)}
                className={
                  'inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs ' +
                  'border border-zinc-700 bg-zinc-900 ' +
                  (canAct
                    ? 'cursor-pointer hover:border-fuchsia-500 hover:bg-zinc-800'
                    : 'cursor-default opacity-70')
                }
                title={cardTooltip(card)}
              >
                <span className="font-medium">{card.name}</span>
                {card.manaCost && (
                  <span className="text-zinc-500 font-mono">{card.manaCost}</span>
                )}
              </button>
            </HoverCardDetail>
          ))
        )}
      </div>
    </div>
  );
}

/* ---------- card detail overlay (slice 30) ---------- */

/**
 * Floating card-detail panel — shown on hover. Phase 5 deliverable
 * (PATH_C_PLAN.md "Card-detail overlay (zoom + full text)") that
 * gives the player a one-glance read of "what does this card do?"
 * without having to wait for a tooltip or click through. The same
 * scaffolding will host the Scryfall card art when image-fetching
 * lands later.
 *
 * <p>Renders the card name, mana cost, type line, P/T (if a
 * creature) or starting loyalty (if a planeswalker), full rules
 * text (each line a separate paragraph), and a subdued footer with
 * set code + rarity.
 */
function CardDetail({ card }: { card: WebCardView }) {
  const isCreature = card.power || card.toughness;
  const isPlaneswalker = !!card.startingLoyalty;
  return (
    <div
      data-testid="card-detail"
      className="bg-zinc-900 border border-zinc-700 rounded shadow-xl p-3 w-64 text-xs space-y-2"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-sm text-zinc-100 truncate">
          {card.name}
        </span>
        {card.manaCost && (
          <span className="text-zinc-400 font-mono shrink-0">
            {card.manaCost}
          </span>
        )}
      </div>
      {card.typeLine && (
        <div className="text-zinc-400 italic">{card.typeLine}</div>
      )}
      {(isCreature || isPlaneswalker) && (
        <div className="text-zinc-300 font-mono">
          {isPlaneswalker
            ? `Loyalty: ${card.startingLoyalty}`
            : `${card.power} / ${card.toughness}`}
        </div>
      )}
      {card.rules && card.rules.length > 0 && (
        <div className="space-y-1 text-zinc-300 leading-snug">
          {card.rules.map((line, i) => (
            <p key={i}>{line.replace(/<[^>]+>/g, '')}</p>
          ))}
        </div>
      )}
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide flex items-baseline gap-2 pt-1 border-t border-zinc-800">
        {card.expansionSetCode && <span>{card.expansionSetCode}</span>}
        {card.rarity && <span>· {card.rarity}</span>}
      </div>
    </div>
  );
}

/**
 * Hover wrapper. Wraps any card-bearing element and shows
 * {@link CardDetail} above it on mouseEnter. Positioned absolutely
 * with high z-index so the overlay floats over surrounding chips
 * even when the parent has overflow.
 *
 * <p>Visibility is also bound to keyboard focus (focus / blur) so
 * tab-navigating the hand surfaces the same detail — accessibility
 * scaffolding for the Phase 6 a11y pass.
 */
function HoverCardDetail({
  card,
  children,
}: {
  card: WebCardView;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span
          data-testid="card-detail-overlay"
          className="absolute bottom-full left-0 mb-2 z-50 pointer-events-none"
        >
          <CardDetail card={card} />
        </span>
      )}
    </span>
  );
}
