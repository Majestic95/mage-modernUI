import type { WebGameEndView } from '../api/schemas';
import { useDraggable } from '../util/useDraggable';
import { useModalA11y } from '../util/useModalA11y';
import { useGameStore } from './store';

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
export function GameEndOverlay({
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
    return (
      <GameEndDialog
        gameId={gameId}
        gameEnd={gameEnd}
        gameLogCount={gameLogCount}
        onLeave={onLeave}
      />
    );
  }

  if (gameOverPending) {
    return (
      <GameOverPendingBanner
        message={lastWrapped?.message}
      />
    );
  }

  return null;
}

/**
 * Top-center "Game over — waiting for next game" banner. Extracted
 * so the {@link useDraggable} hook can mount on a stable component
 * (the parent's branching would break hook order if it ran inline).
 * Pointer-events scoped to the banner itself so the underlying
 * board stays clickable even though the banner is mid-screen.
 */
function GameOverPendingBanner({ message }: { message?: string }) {
  const { ref, containerProps, style } = useDraggable({
    placement: { kind: 'top-center', topMargin: 64 },
  });
  return (
    <div
      ref={ref}
      data-testid="game-over-banner"
      data-drag-handle
      className="z-40 cursor-move select-none bg-zinc-900/95 border border-amber-700/60 rounded-lg px-6 py-3 shadow-xl text-center pointer-events-auto"
      style={style}
      {...containerProps}
    >
      <p className="text-amber-300 font-semibold">Game over</p>
      {message && (
        <p className="text-sm text-zinc-300 mt-1">
          {message.replace(/<[^>]+>/g, '')}
        </p>
      )}
      <p className="text-xs text-zinc-500 mt-1">
        Waiting for the next game…
      </p>
    </div>
  );
}

/**
 * Match-end dialog. Extracted as its own component so {@link
 * useModalA11y} can scope the focus trap + initial focus to a
 * stable ref tied to the dialog's own mount/unmount, rather than
 * the parent's gameEnd-toggle. ESC intentionally does not close
 * this modal — Back-to-lobby is destructive (leaves the room) and
 * there's no other safe dismiss action; the user must click the
 * button explicitly.
 */
function GameEndDialog({
  gameId,
  gameEnd,
  gameLogCount,
  onLeave,
}: {
  gameId: string;
  gameEnd: WebGameEndView;
  gameLogCount: number;
  onLeave: () => void;
}) {
  const { ref: dialogRef, containerProps, style: dragStyle } = useDraggable({
    placement: { kind: 'center' },
  });
  useModalA11y(dialogRef, {});

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
    <>
      <div
        aria-hidden="true"
        data-testid="game-end-backdrop"
        className="fixed inset-0 z-50 bg-black/80"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-end-heading"
        data-testid="game-end-modal"
        className="z-50 w-[min(90vw,448px)] bg-zinc-900 border border-zinc-700 rounded-lg p-8 space-y-4 shadow-2xl text-center"
        style={dragStyle}
        {...containerProps}
      >
        <h2
          id="game-end-heading"
          data-drag-handle
          className={
            'text-2xl font-semibold cursor-move select-none ' +
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
    </>
  );
}
