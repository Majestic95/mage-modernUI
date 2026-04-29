import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'framer-motion';
import { useAuthStore } from '../auth/store';
import { GameStream } from '../game/stream';
import { useGameStore } from '../game/store';
import {
  deriveInteractionMode,
  type InteractionMode,
} from '../game/interactionMode';
import { isBoardClickable, routeObjectClick } from '../game/clickRouter';
import {
  bucketBattlefield,
  rowOrder,
  type BattlefieldRow,
} from '../game/battlefieldRows';
import type {
  WebCardView,
  WebCommandObjectView,
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';
import { ActionPanel } from './ActionPanel';
import { CardFace } from '../game/CardFace';
import { GameDialog } from './GameDialog';
import { isSlowmoActive, slow, SLOWMO } from '../animation/debug';
import {
  BATTLEFIELD_ENTER_EXIT,
  DELTA_FLOAT_UP,
  HAND_HOVER_LIFT_MS,
  LAYOUT_GLIDE,
  LIFE_FLASH_POP,
  LIFE_TOTAL_COLOR_MS,
  STACK_ENTER_EXIT,
  STACK_ZONE_COLLAPSE_MS,
} from '../animation/transitions';

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
    //
    // Slice 52c — MotionConfig + LayoutGroup wrap the whole game
    // window so the three card-face components (StackTileFace,
    // BattlefieldTile, HandCardSlot) participate in one shared
    // Framer-Motion layoutId graph. Without LayoutGroup, layoutId
    // matching only happens within a single AnimatePresence; our
    // zones live in separate AnimatePresences (stack vs.
    // battlefield), so cross-zone glides need the LayoutGroup to
    // bridge them. MotionConfig.reducedMotion="user" honors the
    // OS-level prefers-reduced-motion setting — users with it on
    // see instant transitions instead of glides.
    //
    // Sideboard/draft zones don't yet exist as separate components
    // in this fork; if they're ever added in their own panel and
    // don't need cross-zone glides into the in-game stack, scope
    // their LayoutGroup separately to avoid the 60+-card hand-fan
    // performance hit.
    //
    // SCOPE CONTRACT (read before adding new animated UI):
    //   • Anything that should glide via layoutId must render as a
    //     descendant of THIS LayoutGroup. The hand fan, stack zone,
    //     and battlefield are all reached via Battlefield → so they
    //     qualify.
    //   • Anything modal/overlay that should NOT participate in
    //     layoutId matching (sideboard panels, deck builder, future
    //     spell-history panel, etc.) must render outside this tree
    //     — preferably via a portal at App.tsx level. SideboardModal
    //     already lives in App.tsx for that reason. HoverCardDetail
    //     uses createPortal to escape this scope; that's intentional.
    //   • Performance budget: keep tracked motion elements inside the
    //     LayoutGroup ≤ ~50 during a turn. A typical game is ≤7 hand
    //     + ≤20 battlefield + ≤3 stack ≈ 30 elements, well within
    //     budget. If a future feature would exceed that (e.g. a
    //     graveyard popover that shows 60 cards with layoutId), put
    //     it in its own LayoutGroup or no LayoutGroup at all.
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
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
          <GameEndOverlay gameId={gameId} onLeave={onLeave} />
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}

/* ---------- game-log download (slice 19 / Phase 5) ---------- */

/**
 * Wire-format major+minor used in saved game-log JSON exports. Kept
 * in lock-step with WebApi's {@code SchemaVersion.CURRENT}; bump
 * here whenever the server schema bumps so a future loader can
 * route by version. Pure metadata — the export is purely
 * client-side, no server round-trip.
 */
const GAME_LOG_EXPORT_SCHEMA_VERSION = '1.19';

/**
 * Trigger a browser download of {@code payload} serialized to JSON.
 * Builds an in-memory {@code Blob}, points an offscreen anchor at
 * a {@code blob:} URL, clicks it, then revokes the URL so the
 * blob can be GC'd.
 *
 * <p>Extracted as a module-scope helper so the GameEndOverlay
 * stays declarative and the download path is unit-testable in
 * isolation (mock {@code URL.createObjectURL} + intercept the
 * anchor's {@code click()}).
 */
function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  // Append → click → remove. Some browsers require the anchor to be
  // in the document for the synthetic click to fire.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Build a "xmage-game-<gameId8>-<YYYYMMDD-HHmm>.json" filename for a
 * saved game-log export. {@code gameIdSlice} is the first 8 chars of
 * the game UUID (enough for a human to disambiguate exports without
 * cluttering the filename with a full UUID).
 */
function buildGameLogFilename(gameId: string, now: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const slice = gameId.slice(0, 8);
  return `xmage-game-${slice}-${stamp}.json`;
}

/* ---------- game-end overlay (slice 19 / B5) ---------- */

/**
 * Game / match end overlay. Two states:
 *
 * <ul>
 *   <li>{@code gameEnd} set (match over) → modal summary with the
 *       upstream {@code matchInfo}, win/wins-needed score, a
 *       "Save game log" download button, and a Back-to-lobby
 *       button.</li>
 *   <li>{@code gameOverPending} set but no {@code gameEnd} yet
 *       (best-of-N: game ended, match continues) → centered
 *       banner with the {@code lastWrapped.message} and "waiting
 *       for next game" hint. Cleared by the next {@code gameInit}.</li>
 * </ul>
 *
 * <p>The board stays visible behind the banner / modal so the
 * user can see the final state. The match-end modal is
 * blocking — the only path forward is Leave (no rematch flow yet).
 *
 * <p>Phase 5 deliverable "Game-over screen with game-log download":
 * the Save-game-log button serializes the in-memory
 * {@code gameLog} slice (slice 18 — running transcript of upstream
 * {@code gameInform} messages) plus the match-end summary into a
 * single JSON file. Pure client-side; no server route, no
 * dependency on upstream's bit-rotted {@code .game} replay
 * format. See {@code docs/decisions/replay-flow-recon.md} for
 * the rationale.
 */
function GameEndOverlay({
  gameId,
  onLeave,
}: {
  gameId: string;
  onLeave: () => void;
}) {
  const gameEnd = useGameStore((s) => s.gameEnd);
  const gameOverPending = useGameStore((s) => s.gameOverPending);
  const lastWrapped = useGameStore((s) => s.lastWrapped);
  // Subscribe to the count rather than the array itself: the
  // download click reads the array fresh from getState() at
  // emit time, and we only need re-renders to flip the disabled
  // state when entries appear / disappear.
  const gameLogCount = useGameStore((s) => s.gameLog.length);

  if (gameEnd) {
    const noLog = gameLogCount === 0;
    const handleSaveGameLog = () => {
      // Snapshot at click-time so a late inform doesn't slip in
      // partway through serialization.
      const state = useGameStore.getState();
      const log = state.gameLog;
      if (log.length === 0) {
        return;
      }
      const exportedAt = new Date();
      const payload = {
        schemaVersion: GAME_LOG_EXPORT_SCHEMA_VERSION,
        exportedAt: exportedAt.toISOString(),
        gameId,
        match: {
          won: gameEnd.won,
          wins: gameEnd.wins,
          winsNeeded: gameEnd.winsNeeded,
          matchInfo: gameEnd.matchInfo,
          gameInfo: gameEnd.gameInfo,
          additionalInfo: gameEnd.additionalInfo,
        },
        entries: log,
      };
      downloadJson(buildGameLogFilename(gameId, exportedAt), payload);
    };
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
          <div className="flex justify-center gap-3 pt-2">
            <button
              type="button"
              data-testid="save-game-log"
              onClick={handleSaveGameLog}
              disabled={noLog}
              title={
                noLog
                  ? 'No game-log entries to export'
                  : 'Download a JSON transcript of this match'
              }
              className={
                'px-5 py-2 rounded font-medium ' +
                (noLog
                  ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-100')
              }
            >
              Save game log
            </button>
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
        {isSlowmoActive && (
          <span
            data-testid="slowmo-badge"
            title={`Animation slow-motion debug. Remove ?slowmo=${SLOWMO} from the URL to disable.`}
            className="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 font-mono uppercase tracking-wide"
          >
            slowmo {SLOWMO}×
          </span>
        )}
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

  // Slice 36 — drag-to-play from hand. Pointer-events DnD per ADR
  // 0005 §6 (no third-party library). Anchor the press in a ref so
  // a quick click (no movement) stays a click; cross a 5px
  // threshold to enter drag mode and surface a floating preview
  // following the cursor. PlayerArea elements are the drop zones;
  // they fire onPointerUp which (when drag is active) routes the
  // hand-card UUID through the same clickRouter the click path
  // uses — same engine behavior, just a more natural mouse-first
  // gesture.
  const [drag, setDrag] = useState<
    { cardId: string; x: number; y: number } | null
  >(null);
  const dragStartRef = useRef<
    | { cardId: string; x: number; y: number; pointerId: number }
    | null
  >(null);

  const beginHandPress = (cardId: string, ev: React.PointerEvent) => {
    if (ev.button !== 0) return; // primary button only
    dragStartRef.current = {
      cardId,
      x: ev.clientX,
      y: ev.clientY,
      pointerId: ev.pointerId,
    };
  };

  // Mount-only listeners. The press anchor is a ref (no re-render
  // on pointerdown), so binding/unbinding on every drag-state change
  // would never see the updated ref. Instead, attach once and read
  // the ref each event.
  useEffect(() => {
    const DRAG_THRESHOLD_SQ = 5 * 5;
    const onMove = (ev: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start || ev.pointerId !== start.pointerId) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (dx * dx + dy * dy <= DRAG_THRESHOLD_SQ) return;
      setDrag((curr) =>
        curr && curr.cardId === start.cardId
          ? { ...curr, x: ev.clientX, y: ev.clientY }
          : { cardId: start.cardId, x: ev.clientX, y: ev.clientY },
      );
    };
    const onUp = () => {
      dragStartRef.current = null;
      setDrag(null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // Fired by either PlayerArea on pointerup. If a drag was in
  // progress, that's a "drop on the board" — route the hand-card
  // UUID through the same path a click would. The document-level
  // pointerup listener clears state immediately after.
  const onBoardDrop = () => {
    if (drag) {
      onObjectClick(drag.cardId);
    }
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

  // Slice 36 — surface the dragged card as a floating preview that
  // tracks the cursor. We resolve the card object from the hand
  // (the only place drag origins are bound today).
  const draggedCard = useMemo<WebCardView | null>(() => {
    if (!drag) return null;
    return gv.myHand[drag.cardId] ?? null;
  }, [drag, gv.myHand]);

  return (
    <div className="flex-1 flex flex-col relative">
      {drag && draggedCard && (
        <div
          data-testid="drag-preview"
          className="fixed pointer-events-none z-50"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          <div className="inline-flex items-baseline gap-1 px-2 py-1 rounded text-xs border border-fuchsia-500 bg-zinc-900 shadow-lg">
            <span className="font-medium text-zinc-100">
              {draggedCard.name}
            </span>
            {draggedCard.manaCost && (
              <ManaCost cost={draggedCard.manaCost} size="sm" />
            )}
          </div>
        </div>
      )}
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
            isDropTarget={drag != null}
            onBoardDrop={onBoardDrop}
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
              isDropTarget={drag != null}
              onBoardDrop={onBoardDrop}
            />
            <MyHand
              hand={gv.myHand}
              canAct={canAct}
              onObjectClick={onObjectClick}
              isMyTurn={!!me.isActive}
              hasPriority={!!me.hasPriority}
              onPointerDown={beginHandPress}
              draggedCardId={drag?.cardId ?? null}
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
  // Slice 50 — keep the section mounted while AnimatePresence flushes
  // the last exit animation, otherwise the stack tile pops out
  // immediately when the spell resolves and the section unmounts.
  const isEmpty = entries.length === 0;
  return (
    <section
      data-testid="stack-zone"
      className={`flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 transition-opacity ${
        isEmpty ? 'opacity-0 pointer-events-none h-0 overflow-hidden py-0 border-b-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${STACK_ZONE_COLLAPSE_MS * SLOWMO}ms` }}
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
        Stack ({entries.length}) — top resolves first
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {entries.map((card, idx) => {
            const tooltip = [card.typeLine, ...(card.rules ?? [])]
              .filter(Boolean)
              .join('\n');
            // Slice 52c — layoutId={card.cardId} ties this stack tile
            // to the resolved permanent's battlefield tile (same
            // cardId after the spell resolves, since cardId is the
            // underlying-Card UUID — Spell.id ≠ Permanent.id but
            // Spell.getCard().getId() === Permanent.id). LayoutGroup
            // at the Game-page root crosses the AnimatePresence
            // boundary so Framer matches the two siblings.
            //
            // Empty-string cardId is a defensive default for older
            // fixtures (slice 52b) — passing '' as layoutId would
            // collide every "missing" card into one shared id.
            // {@code undefined} disables layout-id matching for
            // that tile.
            const layoutId = card.cardId ? card.cardId : undefined;
            return (
              <motion.div
                key={card.id}
                layout
                layoutId={layoutId}
                data-layout-id={layoutId}
                initial={{ opacity: 0, y: -16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.85 }}
                transition={slow(STACK_ENTER_EXIT)}
              >
                <HoverCardDetail card={card}>
                  <div
                    data-testid="stack-entry"
                    className="relative"
                    title={tooltip || card.name}
                  >
                    <StackTileFace card={card} />
                    {idx === 0 && (
                      <span
                        data-testid="stack-top-marker"
                        className="absolute -top-1.5 -right-1.5 text-[9px] font-semibold bg-fuchsia-500 text-zinc-100 px-1 rounded shadow"
                      >
                        TOP
                      </span>
                    )}
                  </div>
                </HoverCardDetail>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

/**
 * Small card-shaped tile for stack entries (slice 48). Same 5:7
 * shape as HandCardFace / BattlefieldTileFace, scaled down to
 * 60×84 — the stack rarely holds more than 1-3 entries in 1v1, but
 * the tile needs to stay narrow so the stack-zone header doesn't
 * eat too much battlefield real estate.
 *
 * <p>Defensive image-fail fallback identical to HandCardFace —
 * a name-only gradient silhouette so a missing print doesn't
 * leave a broken-image icon on the stack.
 */
function StackTileFace({ card }: { card: WebCardView }) {
  return <CardFace card={card} size="stack" />;
}

function PlayerArea({
  player,
  perspective,
  canAct,
  onObjectClick,
  targetable,
  eligibleCombatIds,
  combatRoles,
  isDropTarget,
  onBoardDrop,
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
  /**
   * Slice 36 — true while a hand-card drag is in progress. Adds a
   * dashed ring around the area so the user can see where releasing
   * will play the card.
   */
  isDropTarget: boolean;
  /**
   * Slice 36 — fired on pointerup over the area. The Battlefield
   * checks its own drag state and dispatches the play action when
   * appropriate; if no drag was active this is a no-op.
   */
  onBoardDrop: () => void;
}) {
  const battlefield = Object.values(player.battlefield);
  // Slice 53 — group permanents into MTGA-style rows (creatures /
  // other / lands), mirrored for the opponent so lands sit closest
  // to each player's hand. Empty rows render nothing so a turn-1
  // board with one Forest shows just the lands row.
  const rows = bucketBattlefield(battlefield);
  const orderedRows = rowOrder(perspective);
  return (
    <div
      data-testid={`player-area-${perspective}`}
      data-droppable="board"
      data-drop-target={isDropTarget || undefined}
      onPointerUp={onBoardDrop}
      className={
        'rounded border bg-zinc-900/40 p-3 transition-colors ' +
        (isDropTarget
          ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/40 border-dashed'
          : 'border-zinc-800')
      }
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
          <LifeTotal value={player.life} />

          <span>
            <span className="text-zinc-500">Lib</span>{' '}
            <span className="font-mono">{player.libraryCount}</span>
          </span>
          <span>
            <span className="text-zinc-500">Hand</span>{' '}
            <span className="font-mono">{player.handCount}</span>
          </span>
          <ZoneCounter
            label="Grave"
            zone="graveyard"
            playerName={player.name}
            cards={player.graveyard}
          />
          <ZoneCounter
            label="Exile"
            zone="exile"
            playerName={player.name}
            cards={player.exile}
          />
          <ManaPool player={player} />
        </div>
      </header>
      <div className="flex flex-col gap-1.5">
        {battlefield.length === 0 ? (
          <span className="text-xs text-zinc-600 italic">
            No permanents yet.
          </span>
        ) : (
          // Slice 50 — ETB animation. Slides up from below + scales
          // so the eye reads "spell resolves into permanent" as one
          // motion.
          //
          // Slice 52c — pairs with the StackZone {@code layoutId} so
          // a resolving creature spell glides from its stack tile to
          // its battlefield tile (same {@code cardId}). LayoutGroup
          // at the Game root bridges the two AnimatePresences so
          // Framer can match the IDs across zones. The
          // {@code initial}/{@code exit} y+scale springs above keep
          // working alongside layoutId — layout-driven motion uses
          // the {@code transition.layout} spring (LAYOUT_GLIDE, baked
          // into BATTLEFIELD_ENTER_EXIT), and the regular
          // {@code initial}/{@code exit} keys use the default spring
          // on this transition.
          //
          // Slice 53 — split into three type-grouped rows. Each row
          // owns its own AnimatePresence so a permanent leaving its
          // row triggers its exit animation independently. The row
          // container itself is plain DOM (no motion wrapper), so an
          // empty row that disappears doesn't orphan any animation.
          // LayoutGroup at the Game root still bridges layoutIds
          // across rows (and zones) for cross-row glides like an
          // animated land flipping into the creatures row.
          orderedRows.map((row) => {
            const items = rows[row];
            if (items.length === 0) return null;
            return (
              <BattlefieldRowGroup
                key={row}
                row={row}
                permanents={items}
                canAct={canAct}
                onObjectClick={onObjectClick}
                eligibleCombatIds={eligibleCombatIds}
                combatRoles={combatRoles}
              />
            );
          })
        )}
      </div>
      <CommandZone entries={player.commandList} />
    </div>
  );
}

/**
 * Slice 53 — one MTGA-style row of permanents. Owns its own
 * {@link AnimatePresence} so enter / exit animations fire
 * independently per row when permanents move between rows (e.g. an
 * animated land flipping in / out of creature status) or land here
 * from another zone. The wrapper {@code <div>} is plain DOM — no
 * motion — so a row container appearing or disappearing is a
 * structural change, not an animation, and won't orphan any tile
 * springs mid-flight.
 */
function BattlefieldRowGroup({
  row,
  permanents,
  canAct,
  onObjectClick,
  eligibleCombatIds,
  combatRoles,
}: {
  row: BattlefieldRow;
  permanents: WebPermanentView[];
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  return (
    <div
      data-testid="battlefield-row"
      data-row={row}
      className="flex flex-wrap gap-2 min-h-[16px]"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {permanents.map((perm) => {
          const layoutId = perm.card.cardId ? perm.card.cardId : undefined;
          return (
            <motion.div
              key={perm.card.id}
              layout
              layoutId={layoutId}
              data-layout-id={layoutId}
              initial={{ opacity: 0, y: 24, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.85 }}
              transition={slow(BATTLEFIELD_ENTER_EXIT)}
            >
              <BattlefieldTile
                perm={perm}
                canAct={canAct}
                onClick={onObjectClick}
                isEligibleCombat={eligibleCombatIds.has(perm.card.id)}
                combatRole={combatRoles.get(perm.card.id) ?? null}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
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

/**
 * Slice 51 — animated life total. The number flashes red on damage
 * and green on gain, with a floating ±N delta that drifts up and
 * fades out. Most-watched number in any MTG game; making it visceral
 * is the highest-leverage polish per pixel.
 *
 * <p>Tracks the previous value via {@code useRef}. On change, captures
 * a {@code delta} entry with a unique sequence id and pushes it into a
 * short-lived list — {@code AnimatePresence} renders the float-up +
 * fade-out, then the entry is cleared after 900ms (slightly longer
 * than the animation so the exit completes cleanly).
 *
 * <p>Stacks deltas if multiple changes land in quick succession (e.g.
 * Lightning Bolt + Shock in the same priority pass) — each gets its
 * own +N/-N indicator drifting up alongside the prior one.
 */
function LifeTotal({ value }: { value: number }) {
  const prevRef = useRef(value);
  const seqRef = useRef(0);
  const [deltas, setDeltas] = useState<Array<{ id: number; amount: number }>>(
    [],
  );
  const [flash, setFlash] = useState<'gain' | 'loss' | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (value === prev) return;
    const amount = value - prev;
    prevRef.current = value;
    const id = ++seqRef.current;
    setDeltas((current) => [...current, { id, amount }]);
    setFlash(amount > 0 ? 'gain' : 'loss');
    const flashTimer = setTimeout(() => setFlash(null), 500);
    const dropTimer = setTimeout(() => {
      setDeltas((current) => current.filter((d) => d.id !== id));
    }, 900);
    return () => {
      clearTimeout(flashTimer);
      clearTimeout(dropTimer);
    };
  }, [value]);

  const numberClass =
    flash === 'gain'
      ? 'text-emerald-300'
      : flash === 'loss'
        ? 'text-rose-400'
        : 'text-zinc-100';

  return (
    <span className="relative inline-flex items-baseline gap-1">
      <span className="text-zinc-500">Life</span>{' '}
      <motion.span
        data-testid="life-total"
        key={flash ?? 'idle'}
        initial={{ scale: flash ? 1.25 : 1 }}
        animate={{ scale: 1 }}
        transition={slow(LIFE_FLASH_POP)}
        className={`font-mono transition-colors ${numberClass}`}
        style={{ transitionDuration: `${LIFE_TOTAL_COLOR_MS * SLOWMO}ms` }}
      >
        {value}
      </motion.span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-2 top-0 h-full w-8"
      >
        <AnimatePresence>
          {deltas.map((d) => (
            <motion.span
              key={d.id}
              initial={{ opacity: 0, y: 0, scale: 0.85 }}
              animate={{ opacity: 1, y: -18, scale: 1 }}
              exit={{ opacity: 0, y: -32 }}
              transition={slow(DELTA_FLOAT_UP)}
              className={`absolute left-0 text-xs font-bold font-mono ${
                d.amount > 0 ? 'text-emerald-300' : 'text-rose-400'
              }`}
              data-testid="life-delta"
            >
              {d.amount > 0 ? `+${d.amount}` : `${d.amount}`}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
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

/**
 * Slice 45 — replaces the slice-9-era {@code PermanentChip} text-chip
 * with a card-shaped tile (5:7 aspect, ~80×112). Mirrors
 * {@link HandCardFace} for the visual base — Scryfall art, mana cost,
 * name banner, P/T — and adds the battlefield-specific affordances:
 * tap rotation (90° clockwise), combat highlight ring, ATK/BLK
 * badges, damage chip, counter chip, summoning-sickness border.
 *
 * <p>Each tile is rendered inside a fixed 112×112 square slot so the
 * tap rotation (which swaps the tile's bounding box from 80×112
 * portrait to 112×80 landscape) stays within the slot — neighbors
 * never reflow when a card taps.
 *
 * <p>The slot wrapper sits OUTSIDE {@link HoverCardDetail} on
 * purpose: HoverCardDetail's trigger span is {@code position:
 * relative}, and the slice-44a bug demonstrated that any
 * absolutely-positioned descendant collapses to the left edge of
 * that inline-flex span. The slot itself is a flex item (no
 * absolute positioning), so the bug doesn't trigger here, but
 * keeping the layout box outside HoverCardDetail also makes the
 * trigger element's bounding box exactly the tile, which gives
 * cleaner positioning for the popover.
 */
function BattlefieldTile({
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
  return (
    // Fixed 112×112 slot — the tile (80×112 portrait) and its tapped
    // state (112×80 landscape) both fit. flex centering keeps the
    // tile aligned regardless of orientation.
    <div className="w-[112px] h-[112px] flex items-center justify-center">
      <HoverCardDetail card={perm.card}>
        <button
          type="button"
          data-testid="permanent"
          data-tapped={tapped}
          data-combat-eligible={isEligibleCombat || undefined}
          data-combat-role={combatRole ?? undefined}
          disabled={!canAct}
          onClick={() => onClick(perm.card.id)}
          title={
            canAct
              ? `${perm.card.name} — click to tap/activate`
              : perm.card.typeLine
          }
          className={
            'select-none rounded-lg ' +
            (canAct
              ? 'cursor-pointer hover:ring-1 hover:ring-fuchsia-500'
              : 'cursor-default')
          }
        >
          <BattlefieldTileFace
            perm={perm}
            isEligibleCombat={isEligibleCombat}
            combatRole={combatRole}
            tapped={tapped}
          />
        </button>
      </HoverCardDetail>
    </div>
  );
}

/**
 * Inner card layout for {@link BattlefieldTile}. Layered:
 *   - Scryfall art covering the body via {@code normal} version
 *   - Mana cost overlay top-right
 *   - Name banner across the bottom
 *   - P/T overlay bottom-right (creatures) / loyalty (planeswalkers)
 *   - Counter chip top-left (when {@code card.counters} non-empty)
 *   - Damage chip lower-left (when {@code damage > 0})
 *   - Combat ATK / BLK badge top-left (over the counter chip slot;
 *     they shouldn't both be present in practice — combat badges
 *     only appear during declare-blockers/attackers, counters can
 *     appear any time but the visual collision is mild)
 *   - Combat-eligible amber ring on the outer card box
 *   - Tap state: rotate 90° clockwise + opacity 60%
 *   - Summoning sickness: subtle dashed zinc border (replaces the
 *     legacy italic text styling — italics don't carry meaning on
 *     a card-art tile)
 *
 * <p>Falls back to a name-only silhouette when Scryfall has no art
 * (token, ad-hoc emblem, etc.) — same defensive pattern as
 * {@link HandCardFace}.
 */
function BattlefieldTileFace({
  perm,
  isEligibleCombat,
  combatRole,
  tapped,
}: {
  perm: WebPermanentView;
  isEligibleCombat: boolean;
  combatRole: 'attacker' | 'blocker' | null;
  tapped: boolean;
}) {
  return (
    <CardFace
      card={perm.card}
      size="battlefield"
      perm={perm}
      isEligibleCombat={isEligibleCombat}
      combatRole={combatRole}
      tapped={tapped}
    />
  );
}

function MyHand({
  hand,
  canAct,
  onObjectClick,
  isMyTurn,
  hasPriority,
  onPointerDown,
  draggedCardId,
}: {
  hand: Record<string, WebCardView>;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  isMyTurn: boolean;
  hasPriority: boolean;
  /**
   * Slice 36 — bound on each hand-card button to start the drag-
   * to-play gesture. The Battlefield owner decides whether the
   * press becomes a drag (5px movement threshold) or stays a
   * click; both paths route through {@code onObjectClick}.
   */
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  /**
   * Slice 36 — id of the card currently being dragged, if any.
   * The matching hand chip dims so the user can see which one is
   * "in flight". Other chips render normally.
   */
  draggedCardId: string | null;
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
      {/* Slice 44 — arc-fan hand layout per ADR 0005 §5. Cards are
          absolute-positioned along an arc with subtle per-card
          rotation, hover lifts the focused card to 0° + scale 1.15
          + raises z-index. Pointer-events DnD from slice 36 still
          works because the underlying button keeps the same
          handlers and testid. The wrapper is `h-44` so the lift
          has room without pushing layout.*/}
      <div className="relative h-44">
        {cards.length === 0 ? (
          <span className="absolute left-3 top-3 text-xs text-zinc-600 italic">
            Empty hand.
          </span>
        ) : (
          // Slice 54 — wrap in AnimatePresence so a card removed from
          // the hand (cast / discard / shuffle-into-library) gets its
          // exit phase. Without this, Framer never sees the source
          // bbox and the layoutId={card.cardId} match (slices 52a-c)
          // can't fire — the stack tile pops up from above instead of
          // gliding from the hand position.
          <AnimatePresence mode="popLayout" initial={false}>
            {cards.map((card, idx) => {
              const isDragging = draggedCardId === card.id;
              return (
                <HandCardSlot
                  key={card.id}
                  card={card}
                  index={idx}
                  total={cards.length}
                  canAct={canAct}
                  isDragging={isDragging}
                  onObjectClick={onObjectClick}
                  onPointerDown={onPointerDown}
                  tooltip={cardTooltip(card)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* ---------- hand fan layout (slice 44) ---------- */

/**
 * Compute the resting-state transform + z-index for one card in the
 * arc fan. Cards spread symmetrically around center; angle and
 * x-offset scale linearly with distance from center; y-offset is a
 * shallow downward arc so the leftmost / rightmost cards droop
 * slightly (matches the way real hands of cards sit). Hover state
 * overrides this in the slot itself.
 */
function fanGeometry(index: number, total: number): {
  x: number;
  y: number;
  rot: number;
} {
  if (total <= 1) return { x: 0, y: 0, rot: 0 };
  const fromCenter = index - (total - 1) / 2;
  // Tighter spread when the hand is large so cards stay visible.
  const spreadPx = total > 5 ? Math.max(40, 80 - (total - 5) * 6) : 80;
  const maxAngle = 12;
  const x = fromCenter * spreadPx;
  const y = Math.abs(fromCenter) * 3;
  const rot = (fromCenter / ((total - 1) / 2)) * maxAngle;
  return { x, y, rot };
}

/**
 * One card in the hand fan. Wraps the existing
 * {@link HoverCardDetail} (rich popover) and adds an inner local
 * hover state for the lift / un-rotate / scale-up animation.
 */
function HandCardSlot({
  card,
  index,
  total,
  canAct,
  isDragging,
  onObjectClick,
  onPointerDown,
  tooltip,
}: {
  card: WebCardView;
  index: number;
  total: number;
  canAct: boolean;
  isDragging: boolean;
  onObjectClick: (id: string) => void;
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  tooltip: string;
}) {
  const [lifted, setLifted] = useState(false);
  const { x, y, rot } = fanGeometry(index, total);
  // Hover lift cancels the rotation, raises the card, scales it up,
  // and bumps z so it sits above siblings. Transform applied to the
  // OUTER absolute-positioned wrapper rather than the button — the
  // button is wrapped by HoverCardDetail's `relative inline-flex`
  // span, which would otherwise become the positioned ancestor and
  // collapse every card to the left edge of its own tiny span (the
  // bug fix from slice 44 follow-up).
  const transform = lifted
    ? `translate(-50%, 0) translateX(${x}px) translateY(-56px) rotate(0deg) scale(1.15)`
    : `translate(-50%, 0) translateX(${x}px) translateY(${y}px) rotate(${rot}deg)`;
  // Slice 52c — layoutId pinned to an INNER motion.div so the
  // fan-arc CSS transform on the OUTER div doesn't conflict with
  // Framer's layout-tracking. Framer reads the motion element's
  // bounding-client-rect to compute glide trajectories — putting
  // layoutId on the outer (fan-positioned) div would make Framer
  // think every hand card is already at the rotated/translated
  // position, and the cross-zone glide would start from the wrong
  // spot. The inner motion.div sits inside the button at the
  // visible 100×140 face position, so its bbox matches what the
  // user actually sees.
  //
  // Empty cardId → omit layoutId (defensive default; see slice 52b).
  const layoutId = card.cardId ? card.cardId : undefined;
  return (
    <div
      className="absolute left-1/2 top-2 transition-transform ease-out origin-bottom"
      style={{
        transform,
        zIndex: lifted ? 100 : index,
        transitionDuration: `${HAND_HOVER_LIFT_MS * SLOWMO}ms`,
      }}
    >
      <HoverCardDetail card={card}>
        <button
          type="button"
          data-testid="hand-card"
          data-card-id={card.id}
          data-dragging={isDragging || undefined}
          data-lifted={lifted || undefined}
          disabled={!canAct}
          onClick={() => onObjectClick(card.id)}
          onPointerDown={(ev) => canAct && onPointerDown(card.id, ev)}
          onMouseEnter={() => setLifted(true)}
          onMouseLeave={() => setLifted(false)}
          onFocus={() => setLifted(true)}
          onBlur={() => setLifted(false)}
          title={tooltip}
          className={
            'select-none ' +
            (canAct
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default opacity-70') +
            (isDragging ? ' opacity-30' : '')
          }
        >
          <motion.div
            layoutId={layoutId}
            data-layout-id={layoutId}
            transition={{ layout: slow(LAYOUT_GLIDE) }}
          >
            <HandCardFace card={card} />
          </motion.div>
        </button>
      </HoverCardDetail>
    </div>
  );
}

/**
 * Card-shaped tile (5:7 aspect) for the hand fan. Layered:
 *   - Scryfall art via `normal` version covering the upper body
 *   - Mana cost overlay top-right
 *   - Name banner across the bottom (over the art's bottom edge)
 *   - P/T overlay bottom-right for creatures, loyalty for walkers
 *
 * Falls back to a name-only card silhouette when Scryfall has no
 * matching print (token, ad-hoc emblem, etc.) — same defensive
 * pattern as the slice-43 thumbnail.
 */
function HandCardFace({ card }: { card: WebCardView }) {
  return <CardFace card={card} size="hand" />;
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
  const imageUrl = scryfallImageUrl(card);
  return (
    <div
      data-testid="card-detail"
      className="bg-zinc-900 border border-zinc-700 rounded shadow-xl w-64 text-xs overflow-hidden"
    >
      {imageUrl && <CardImage url={imageUrl} alt={card.name} />}
      <div className="p-3 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-sm text-zinc-100 truncate">
            {card.name}
          </span>
          {card.manaCost && (
            <span className="text-zinc-300 shrink-0">
              <ManaCost cost={card.manaCost} />
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
    </div>
  );
}

/**
 * Build a Scryfall image URL from a card's set + collector number.
 * Returns {@code null} when either field is missing — the
 * {@link CardDetail} renders without an image in that case.
 *
 * <p>{@code ?format=image&version=normal} is the redirect-to-CDN
 * endpoint Scryfall provides; the browser follows the 302 once
 * and caches the result. Set codes are upper-cased upstream;
 * Scryfall's URL space is lowercase, so we normalize here.
 *
 * <p>Per ADR 0002 / PATH_C_PLAN.md "Image strategy": Scryfall is
 * the source of truth for card art, fetched on demand and cached
 * by the browser HTTP cache. A Service Worker overlay can come
 * later if rate limits or offline-play matter; for now the
 * native cache is sufficient.
 */
export type ScryfallVersion = 'normal' | 'small' | 'art_crop';

export function scryfallImageUrl(
  card: WebCardView,
  version: ScryfallVersion = 'normal',
): string | null {
  if (!card.expansionSetCode || !card.cardNumber) return null;
  const set = card.expansionSetCode.toLowerCase();
  const num = encodeURIComponent(card.cardNumber);
  return `https://api.scryfall.com/cards/${set}/${num}?format=image&version=${version}`;
}

/**
 * Inline mini-art thumbnail for chip-style renders (slice 43). Pulls
 * Scryfall's {@code art_crop} version (just the framed illustration,
 * no name banner / cost / type strip) and renders it as a small
 * square at the leading edge of the chip. Hides itself on error so
 * a missing print falls back to text-only chip — no broken-image
 * icon.
 *
 * <p>Service worker (slice 35) caches every Scryfall response; the
 * second time the same card renders, the image is on disk.
 *
 * <p>{@code alt=""} marks the image as decorative — every chip
 * pairs the thumbnail with the card's name in text, so a screen
 * reader gets the full information without the redundant alt text.
 */
function CardThumbnail({
  card,
  size = 28,
}: {
  card: WebCardView;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = scryfallImageUrl(card, 'art_crop');
  if (failed || !url) return null;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid="card-thumbnail"
      className="rounded-sm object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Lazy-loaded Scryfall image with graceful failure. Hides itself
 * on load error so a missing print (Scryfall has no record of
 * this set / number, network blocked, etc.) just falls back to
 * the text-only card detail. {@code loading="lazy"} is a hint
 * for browsers that mount the element off-screen — most of our
 * use cases hover the element on, so it loads immediately, but
 * the hint is harmless and helps when an overlay first mounts
 * outside the viewport.
 */
function CardImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      data-testid="card-image"
      className="w-full block"
    />
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
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Slice 38: viewport-clamped position. Initial render places the
  // popover off-screen (so its layout settles invisibly) and the
  // useLayoutEffect below measures both the trigger and the popover,
  // then snaps the popover to a position that:
  //   1. flips above ↔ below depending on which side has more room
  //   2. clamps horizontally so the right / left edges never spill
  //      past the viewport
  // We use position: fixed (not absolute) and a portal so the
  // popover escapes any overflow:hidden ancestor (the battlefield
  // sections are scrollable).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    if (!triggerRef.current || !popoverRef.current) return;
    const tr = triggerRef.current.getBoundingClientRect();
    const pr = popoverRef.current.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Vertical: prefer above the trigger, flip below if more room
    // there, else clamp into the viewport.
    let top: number;
    const roomAbove = tr.top - margin;
    const roomBelow = vh - tr.bottom - margin;
    if (roomAbove >= pr.height) {
      top = tr.top - pr.height - margin;
    } else if (roomBelow >= pr.height) {
      top = tr.bottom + margin;
    } else {
      // Neither side fits — clamp so at minimum the top of the
      // popover stays in view.
      top = Math.max(margin, vh - pr.height - margin);
    }

    // Horizontal: align to trigger's left edge, clamp to viewport.
    let left = tr.left;
    if (left + pr.width > vw - margin) {
      left = vw - pr.width - margin;
    }
    if (left < margin) left = margin;

    setPos({ left, top });
  }, [show, card]);

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-flex"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
      >
        {children}
      </span>
      {show &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            data-testid="card-detail-overlay"
            className="fixed z-50 pointer-events-none"
            style={
              pos
                ? { left: pos.left, top: pos.top }
                : { left: -9999, top: -9999, opacity: 0 }
            }
          >
            <CardDetail card={card} />
          </div>,
          document.body,
        )}
    </>
  );
}

/* ---------- mana cost icons (slice 32) ---------- */

/**
 * Render a parens-style mana cost ({@code "{2}{R}{R}"}) as Andrew
 * Gioia's Mana font icons (https://github.com/andrewgioia/mana,
 * MIT). Each {@code {X}} token becomes one {@code <i class="ms ms-X
 * ms-cost ms-shadow">}, with the mana font CSS imported once in
 * main.tsx.
 *
 * <p>Token mapping (the font's class scheme):
 * <ul>
 *   <li>{@code {R}} → {@code ms-r} — single colored pip</li>
 *   <li>{@code {2}} → {@code ms-2} — generic / numeric</li>
 *   <li>{@code {X}} → {@code ms-x}</li>
 *   <li>{@code {W/U}} → {@code ms-wu} — hybrid (slash dropped)</li>
 *   <li>{@code {2/W}} → {@code ms-2w} — mono-hybrid</li>
 *   <li>{@code {T}} → {@code ms-tap}</li>
 * </ul>
 *
 * <p>Unknown tokens fall back to the literal text so we don't
 * silently swallow exotic costs like Phyrexian {@code {P}} —
 * the Mana font also covers most of these but the explicit
 * fallback keeps the symbol readable even if a future printing
 * uses a glyph the font doesn't support.
 *
 * <p>Token aliases — upstream emits {@code {tap}} as the
 * lowercase string while the font expects {@code ms-tap}; the
 * inner-text path lowercases everything before resolution so both
 * forms work.
 */
export function ManaCost({
  cost,
  size,
}: {
  cost: string;
  size?: 'normal' | 'sm';
}) {
  if (!cost) return null;
  const tokens = cost.match(/\{[^}]+\}/g);
  if (!tokens || tokens.length === 0) return null;
  const sizeClass = size === 'sm' ? 'text-[11px]' : '';
  return (
    <span
      data-testid="mana-cost"
      className={'inline-flex items-center gap-0.5 ' + sizeClass}
    >
      {tokens.map((tok, i) => {
        const inner = tok.slice(1, -1).toLowerCase().replace(/\//g, '');
        // The "tap" symbol comes through as either {T} or {tap}; the
        // mana-font class is `ms-tap` for both.
        const cls = inner === 't' ? 'tap' : inner;
        return (
          <i
            key={i}
            data-symbol={tok}
            className={`ms ms-${cls} ms-cost ms-shadow`}
            aria-label={tok}
          />
        );
      })}
    </span>
  );
}

/* ---------- zone browser (slice 31) ---------- */

/**
 * Clickable zone-count chip ("Grave 3", "Exile 2"). Renders as a
 * non-interactive span when the zone is empty (no panel to open),
 * a button otherwise that toggles a {@link ZoneBrowser} modal.
 *
 * <p>Phase 5 deliverable from PATH_C_PLAN.md "Graveyard / exile /
 * library (top-card-revealed) browsers". Library is intentionally
 * NOT browsable (face-down by default — only revealed when
 * something specifically reveals top cards; that flow comes later
 * via gameTarget on the revealed cards).
 */
function ZoneCounter({
  label,
  zone,
  playerName,
  cards,
}: {
  label: string;
  zone: 'graveyard' | 'exile';
  playerName: string;
  cards: Record<string, WebCardView>;
}) {
  const [open, setOpen] = useState(false);
  const cardList = Object.values(cards);
  const count = cardList.length;
  const empty = count === 0;
  return (
    <span className="relative inline-block">
      <span className="text-zinc-500">{label}</span>{' '}
      {empty ? (
        <span data-testid={`zone-count-${zone}`} className="font-mono">
          {count}
        </span>
      ) : (
        <button
          type="button"
          data-testid={`zone-count-${zone}`}
          onClick={() => setOpen(true)}
          className="font-mono cursor-pointer text-zinc-100 hover:text-fuchsia-300 underline underline-offset-2"
          title={`Browse ${playerName}'s ${zone}`}
        >
          {count}
        </button>
      )}
      {/*
        Slice 55 — resolve animation: zero-size hidden motion.div per
        graveyard / exile card so the cross-zone layoutId graph has a
        destination to glide INTO when an instant or sorcery resolves.
        Without these, a Lightning Bolt resolving from the stack would
        animate its exit (opacity-fade + slide) but the player would
        never see it "land" anywhere — the chip count would just bump
        in silence. With these, Framer matches the exiting stack tile
        against the cardId-paired hidden div at the chip's position
        and glides between them. Fades to zero on arrival; the chip
        count is the persistent record.

        Per-card (not per-zone) so any card moving INTO the zone
        triggers the glide, regardless of order. Zero-size +
        opacity-0 + pointer-events-none means they cost ~nothing in
        layout/paint. Performance budget on this whole LayoutGroup is
        ≤50 elements (see Game.tsx:163); a long game's combined
        graveyards rarely exceed 30 cards.
      */}
      <span
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
      >
        <AnimatePresence initial={false}>
          {cardList.map((card) =>
            card.cardId ? (
              <motion.span
                key={card.id}
                layoutId={card.cardId}
                data-layout-id={card.cardId}
                data-testid={`zone-target-${zone}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={slow({ duration: 0.2 })}
                className="absolute inset-0 block"
                style={{ width: 0, height: 0 }}
              />
            ) : null,
          )}
        </AnimatePresence>
      </span>
      {open && (
        <ZoneBrowser
          title={`${playerName}'s ${zone}`}
          cards={cards}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/**
 * Modal panel listing every card in a public zone. Each card chip
 * is wrapped in {@link HoverCardDetail} so brushing over a card
 * surfaces the same detail overlay used in the hand / battlefield.
 *
 * <p>Closes on backdrop click and on Esc keydown. The Esc handler
 * is registered with {@code capture: true} so it runs before any
 * bubble-phase document listeners (e.g. ActionPanel's hotkey
 * listener) and {@code stopImmediatePropagation} prevents those
 * from firing. That preserves the universal "Esc closes the modal"
 * convention without losing the ActionPanel's other shortcuts.
 */
function ZoneBrowser({
  title,
  cards,
  onClose,
}: {
  title: string;
  cards: Record<string, WebCardView>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [onClose]);

  const entries = Object.values(cards);
  return (
    <div
      data-testid="zone-browser"
      className="fixed inset-0 z-40 flex items-center justify-center"
    >
      <div
        data-testid="zone-browser-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={title}
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[min(90vw,640px)] max-h-[80vh] flex flex-col"
      >
        <header className="flex items-baseline justify-between px-4 py-2 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100 capitalize">
            {title}{' '}
            <span className="text-xs text-zinc-500 font-normal">
              ({entries.length})
            </span>
          </h2>
          <button
            type="button"
            data-testid="zone-browser-close"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex flex-wrap gap-1.5 p-3 overflow-y-auto">
          {entries.map((card) => (
            <HoverCardDetail key={card.id} card={card}>
              <div
                data-testid="zone-browser-card"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-zinc-700 bg-zinc-950"
              >
                <CardThumbnail card={card} size={28} />
                <span className="font-medium text-zinc-100">{card.name}</span>
                {card.manaCost && <ManaCost cost={card.manaCost} size="sm" />}
              </div>
            </HoverCardDetail>
          ))}
        </div>
      </div>
    </div>
  );
}
