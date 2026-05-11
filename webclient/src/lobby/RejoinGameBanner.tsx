import type { WebMyGame } from '../api/schemas';

interface Props {
  /**
   * The list of games the authenticated user can rejoin (seated in
   * the engine, {@code hasLeft=false}). Powered by
   * {@code GET /api/games/mine}. Empty list ⇒ the banner renders
   * nothing — common case at lobby-time, so we don't want any
   * structural placeholder either.
   */
  games: ReadonlyArray<WebMyGame>;
  /**
   * Click handler — receives the game UUID the user wants to rejoin.
   * Caller routes into the Game window via the same setter used by
   * the start-game auto-route in {@code App.tsx}.
   */
  onRejoin: (gameId: string) => void;
}

/**
 * "Rejoin Game" banner for the lobby. Surfaces above the tables list
 * when the user has at least one game they were seated in but haven't
 * conceded (closed the tab, lost network, hit back on the browser,
 * etc.). Hidden when there's nothing to rejoin.
 *
 * <p><b>Why emerald, not amber/fuchsia.</b> Fuchsia is the lobby's
 * primary action color (Create / Join). Amber is already used for
 * the READY_TO_START table state — using it for the banner would
 * cause two amber zones to compete for "act here" attention. Emerald
 * reads as "alive — come back" and is otherwise unused in the lobby,
 * so the rejoin signal stays distinct.
 *
 * <p><b>Opponent rendering.</b> Server filters out the rejoining user
 * from {@code opponentNames}. For 1–2 opponents we render them
 * verbatim ("vs alice, bob"). For 3+ (Free For All, large EDH pods)
 * we collapse to "vs alice +2 more" so the line stays scannable on
 * narrow viewports and screen readers don't have to listen through a
 * comma-separated list. AI seats are part of opponentNames — same
 * string as on the table row above.
 *
 * <p><b>Accessibility.</b> The section is announced as a polite live
 * region so a screen-reader user sees the banner appear mid-session
 * (e.g. user closes a tab during a game, comes back, banner pops in
 * on next poll) without an interrupt. Each row's button carries a
 * per-table aria-label so a SR user iterating multiple rows hears
 * "Rejoin alice's table", not "Rejoin button, Rejoin button."
 */
export function RejoinGameBanner({ games, onRejoin }: Props) {
  if (games.length === 0) {
    return null;
  }
  return (
    <section
      data-testid="rejoin-game-banner"
      aria-label="Games you can rejoin"
      aria-live="polite"
      className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2"
    >
      <header className="flex items-baseline gap-2">
        <span aria-hidden="true" className="text-emerald-300">↩</span>
        <h3 className="text-sm font-semibold text-emerald-200">
          {games.length === 1
            ? 'You have a game in progress'
            : `You have ${games.length} games in progress`}
        </h3>
      </header>
      <ul className="space-y-1.5">
        {games.map((g) => {
          const tableLabel = g.tableName || 'Untitled table';
          return (
            <li
              key={g.gameId}
              data-testid="rejoin-game-row"
              data-game-id={g.gameId}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0 text-sm">
                <p className="font-medium text-zinc-100 truncate">
                  {tableLabel}
                </p>
                {g.opponentNames.length > 0 && (
                  <p className="text-xs text-zinc-400 truncate">
                    vs {formatOpponents(g.opponentNames)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRejoin(g.gameId)}
                aria-label={`Rejoin ${tableLabel}`}
                data-testid="rejoin-game-button"
                className="shrink-0 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm font-medium rounded px-3 py-1.5"
              >
                Rejoin
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Format the opponent list for the row subtitle. ≤2 names render
 * verbatim; 3+ collapse to "first +N more" to keep the line scannable
 * on narrow viewports and to give a clean accessible name.
 */
function formatOpponents(names: ReadonlyArray<string>): string {
  if (names.length <= 2) {
    return names.join(', ');
  }
  return `${names[0]} +${names.length - 1} more`;
}
