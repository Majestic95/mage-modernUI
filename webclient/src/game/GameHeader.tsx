import { useState } from 'react';
import type { WebGameView } from '../api/schemas';
import { isSlowmoActive, SLOWMO } from '../animation/debug';
import { REDESIGN } from '../featureFlags';
import { useGameStore } from './store';
import { SettingsModal } from './SettingsModal';
import type { GameStream } from './stream';
import { PhaseTimeline } from './PhaseTimeline';

/**
 * Slice 70-O (picture-catalog §1) — game-table header bar.
 *
 * <p>REDESIGN branch (catalog §1.1-§1.4):
 * <ul>
 *   <li><b>Left:</b> all-caps purple lobby name synthesized from
 *       {@code gameView.players.length} + commander detection.
 *       4-player commander → "COMMANDER — 4 PLAYER FREE-FOR-ALL",
 *       2-player commander → "COMMANDER — 1V1", non-commander
 *       drops the COMMANDER prefix.</li>
 *   <li><b>Right:</b> 4-icon strip — chat (disabled for v1;
 *       slide-out deferred to slice 70-R), layout/zoom (toggles
 *       {@code sidePanelCollapsed} via the store), fullscreen
 *       (calls {@code requestFullscreen}/{@code exitFullscreen}),
 *       settings (opens {@link SettingsModal}).</li>
 * </ul>
 *
 * <p>Per catalog §1.4 these are removed entirely: gameId UUID,
 * slowmo debug badge, connection-state colored dot (per-player
 * DISCONNECTED overlay handles the signal), "Your turn / Opponent's
 * turn" pill (per-pod halo handles it), "Your priority / Waiting"
 * subtext (PriorityTag handles it), inline "Leave" text button
 * (relocated to settings modal alongside Concede).
 *
 * <p>Legacy (non-REDESIGN) branch preserves the slice-23 strip
 * verbatim. Will be deleted in slice 70-Z after the redesign push
 * signs off.
 */
export function GameHeader({
  gameId,
  connection,
  closeReason,
  gameView,
  onLeave,
  stream,
}: {
  gameId: string;
  connection: string;
  closeReason: string;
  gameView: WebGameView | null;
  onLeave: () => void;
  /**
   * Slice 70-O — needed by the REDESIGN branch to wire the Concede
   * action through to the engine. Optional so legacy callers (none
   * after this slice but conservatively typed) don't break.
   */
  stream?: GameStream | null;
}) {
  if (REDESIGN) {
    return (
      <RedesignedHeader
        gameView={gameView}
        onLeave={onLeave}
        stream={stream ?? null}
      />
    );
  }

  // Legacy branch — unchanged from slice 23.
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

/**
 * Slice 70-O — REDESIGN header. Lobby name on the left; 4-icon
 * strip on the right (chat, layout/zoom, fullscreen, settings).
 */
function RedesignedHeader({
  gameView,
  onLeave,
  stream,
}: {
  gameView: WebGameView | null;
  onLeave: () => void;
  stream: GameStream | null;
}) {
  const toggleSidePanel = useGameStore((s) => s.toggleSidePanel);
  const sidePanelCollapsed = useGameStore((s) => s.sidePanelCollapsed);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Fullscreen click — toggles browser fullscreen on the document
  // root. Falls back gracefully if the API is unavailable (older
  // browsers, sandboxed iframes) — the click is a no-op rather
  // than a thrown error.
  const onFullscreen = () => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  };

  return (
    <>
      <header
        data-testid="game-table-header"
        data-redesign="true"
        // Slice 70-Z polish round 23 (user direction 2026-04-30) —
        // the lobby-name banner ("COMMANDER — 4 PLAYER FREE-FOR-ALL"
        // in --color-accent-primary purple over bg-bg-base #0E1A20)
        // got dropped per user feedback ("remove the murky blue
        // banner"). PhaseTimeline relocated FROM the side panel to
        // the header strip and expanded to fill the freed space —
        // turn + phase are higher-frequency reads than the lobby
        // name and earn the prime real estate. Header background
        // now matches PhaseTimeline's bg-zinc-950 so the strip is
        // visually one continuous bar rather than a header band
        // hosting a sub-band. px-0 lets PhaseTimeline's own px-4
        // own the horizontal rhythm; py-0 likewise (PhaseTimeline
        // brings its own py-2). The icon strip keeps its px-6 via
        // its own padding.
        className="flex items-stretch bg-zinc-950"
      >
        <div className="flex-1 min-w-0">
          {gameView && <PhaseTimeline gameView={gameView} />}
        </div>

        <div
          data-testid="header-icon-strip"
          className="flex items-center gap-5 px-6"
        >
          {/* Chat icon — slice 70-R lights up the slide-out. Until
              then the icon is visibly disabled so the click doesn't
              feel like a broken affordance (UI/UX critic N2). */}
          <HeaderIconButton
            testId="header-icon-chat"
            label="Open chat (coming soon)"
            disabled
            onClick={() => {}}
          >
            <ChatIcon />
          </HeaderIconButton>
          <HeaderIconButton
            testId="header-icon-layout"
            label={
              sidePanelCollapsed ? 'Expand side panel' : 'Collapse side panel'
            }
            ariaPressed={sidePanelCollapsed}
            onClick={toggleSidePanel}
          >
            <LayoutIcon collapsed={sidePanelCollapsed} />
          </HeaderIconButton>
          <HeaderIconButton
            testId="header-icon-fullscreen"
            label="Toggle fullscreen"
            onClick={onFullscreen}
          >
            <FullscreenIcon />
          </HeaderIconButton>
          <HeaderIconButton
            testId="header-icon-settings"
            label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </HeaderIconButton>
        </div>
      </header>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onConcede={() => {
            stream?.sendPlayerAction('CONCEDE');
          }}
          onLeave={onLeave}
        />
      )}
    </>
  );
}

interface IconBtnProps {
  testId: string;
  label: string;
  onClick: () => void;
  /** Optional aria-pressed for toggle buttons (layout/zoom). */
  ariaPressed?: boolean;
  /**
   * Slice 70-O — when true the button is non-interactive and rendered
   * at reduced opacity. Used by the chat icon until slice 70-R lights
   * up the slide-out panel; visible-but-inactive reads as "coming
   * soon" without the icon disappearing.
   */
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Slice 70-O — shared header icon button. 16px SVG inside a 24px
 * button frame, soft-grey outline (`--color-text-secondary`), fill
 * brightens to `--color-text-primary` on hover. No background
 * change. Picture-catalog §1.3 visual contract.
 */
function HeaderIconButton({
  testId,
  label,
  onClick,
  ariaPressed,
  disabled,
  children,
}: IconBtnProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={ariaPressed}
      title={label}
      className="
        flex items-center justify-center w-6 h-6 rounded
        text-text-secondary hover:text-text-primary
        focus-visible:outline focus-visible:outline-2
        focus-visible:outline-accent-primary
        disabled:opacity-50 disabled:cursor-not-allowed
        disabled:hover:text-text-secondary
        transition-colors
      "
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------
// Inline SVG icons (slice 70-O)
//
// Hand-coded rather than pulling in an icon library (lucide /
// heroicons) for a single use. Each icon is a 20×20 viewbox with
// `currentColor` strokes — the wrapper button drives the color via
// Tailwind `text-*` classes so theme switches "just work."
// ---------------------------------------------------------------

function ChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5.5C3 4.67 3.67 4 4.5 4h11c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H7l-3 3v-3H4.5C3.67 14 3 13.33 3 12.5v-7Z" />
    </svg>
  );
}

function LayoutIcon({ collapsed }: { collapsed: boolean }) {
  // Two arrows facing in (collapse) when expanded; arrows facing out
  // (expand) when collapsed. The visual flips so the icon's
  // direction always indicates what the click WILL do, not the
  // current state.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {collapsed ? (
        <>
          <path d="M3 7l3-3v6Z" />
          <path d="M17 7l-3-3v6Z" />
          <path d="M3 13l3 3v-6Z" />
          <path d="M17 13l-3 3v-6Z" />
        </>
      ) : (
        <>
          <path d="M6 4l-3 3h6Z" />
          <path d="M14 4l3 3h-6Z" />
          <path d="M6 16l-3-3h6Z" />
          <path d="M14 16l3-3h-6Z" />
        </>
      )}
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7V3h4" />
      <path d="M17 7V3h-4" />
      <path d="M3 13v4h4" />
      <path d="M17 13v4h-4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6" />
    </svg>
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
