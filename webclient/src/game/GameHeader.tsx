import type { WebGameView } from '../api/schemas';
import { isSlowmoActive, SLOWMO } from '../animation/debug';

/* ---------- header ---------- */

export function GameHeader({
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
