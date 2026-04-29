import { useEffect, useRef } from 'react';
import { useGameStore } from './store';

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
export function GameLog() {
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
