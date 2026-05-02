import { useEffect, useState } from 'react';
import { REVEAL_TOAST_TTL_MS, useGameStore } from './store';
import { renderUpstreamMarkup } from './dialogs/markupRenderer';

/**
 * Bug fix (2026-05-02) — momentary reveal toast. Per CR 701.16a a
 * reveal "shows the card to all players, then ceases to do so" — it
 * is NOT a persistent zone. The store's gameInform reducer detects
 * "<player> reveals <card>" log lines and pushes them to
 * {@code recentReveals}; this component renders any entry younger
 * than {@link REVEAL_TOAST_TTL_MS} ms as an overlay banner near the
 * top of the screen, then lets it expire.
 *
 * <p>Design notes:
 * <ul>
 *   <li>Uses {@code role="status"} + {@code aria-live="polite"} so
 *     SR users hear the reveal — accessibility-equivalent of the
 *     "show to all players" rule.</li>
 *   <li>{@code data-essential-motion} marks the fade as state-
 *     conveying so reduced-motion users still see it (per the
 *     animation contract introduced in slice 087e57f5).</li>
 *   <li>A 250ms ticker re-evaluates expiry without mutating store
 *     state — keeps the reducer pure. Old entries linger in the
 *     queue until the next reveal frame arrives or {@link reset}
 *     fires; they just stop rendering.</li>
 * </ul>
 */
export function RevealToast() {
  const reveals = useGameStore((s) => s.recentReveals);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (reveals.length === 0) return;
    const tid = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tid);
  }, [reveals.length]);

  const visible = reveals.filter((r) => now - r.addedAt < REVEAL_TOAST_TTL_MS);
  if (visible.length === 0) return null;

  return (
    <div
      data-testid="reveal-toast-stack"
      className="pointer-events-none fixed left-1/2 -translate-x-1/2 top-16 z-50 flex flex-col items-center gap-2"
    >
      {visible.map((reveal) => (
        <div
          key={reveal.id}
          role="status"
          aria-live="polite"
          data-testid="reveal-toast"
          data-essential-motion="true"
          className={
            'pointer-events-auto inline-flex items-center gap-2 rounded-lg ' +
            'bg-zinc-900/95 border border-sky-400/60 shadow-xl ' +
            'px-4 py-2 text-zinc-100 backdrop-blur-sm animate-reveal-toast-in'
          }
        >
          <span className="text-[10px] uppercase tracking-wider text-sky-300 font-semibold">
            Reveal
          </span>
          <span className="text-sm">
            {renderUpstreamMarkup(reveal.message)}
          </span>
        </div>
      ))}
    </div>
  );
}
