import { useMemo } from 'react';
import type { WebGameView } from '../api/schemas';
import type { GameStream } from './stream';
import { ActionPanel } from '../pages/ActionPanel';
import { Battlefield } from './Battlefield';
import { GameLog } from './GameLog';
import { GameDialog } from './dialogs/GameDialog';
import { PhaseTimeline } from './PhaseTimeline';
import { formatEliminationAnnouncement } from './battlefieldLayout';

/**
 * Slice 70-E (ADR 0011 D5) — 6-region CSS Grid shell per
 * design-system spec §3 / screens-game-table-commander-4p.md §1-§6.
 *
 * <pre>
 *   ┌──────────────────────────────────────────┬─────────────┐
 *   │ HEADER (lobby name, controls)            │             │
 *   ├──────────────────────────────────────────┤             │
 *   │                                          │ SIDE PANEL  │
 *   │           BATTLEFIELD (4-pod +           │   (Phase    │
 *   │            central focal zone)           │  + GameLog  │
 *   │                                          │  + Cmdr Dmg │
 *   │                                          │   slot)     │
 *   ├──────────────────────────────────────────┤             │
 *   │ ACTION area (bottom-right)               │             │
 *   └──────────────────────────────────────────┴─────────────┘
 * </pre>
 *
 * <p><b>Slice scope trade-off (documented for slice 70-F follow-up):</b>
 * Spec §4 puts MyHand in its own region between Battlefield and
 * Action. This slice keeps MyHand inside the Battlefield region's
 * render tree because the drag-state ownership currently lives in
 * Battlefield (drag started in MyHand's onPointerDown,
 * drop dispatched from PlayerArea's onPointerUp). Lifting drag
 * state up to GameTable is ~30 LOC of state plumbing — slice 70-F
 * will do the lift alongside CommanderDamageTracker (which also
 * needs prop access from this level). Today the visual shape is
 * "battlefield + hand stacked vertically inside the battlefield
 * region" instead of "battlefield region / hand region as separate
 * grid cells."
 *
 * <p><b>LayoutGroup contract (technical critic C1):</b> The
 * {@code <MotionConfig reducedMotion="user"><LayoutGroup>} wrap stays
 * in {@code Game.tsx}. GameTable renders BENEATH it. Anything that
 * needs cross-zone layoutId glides (stack→battlefield, hand→stack)
 * must remain a descendant of that LayoutGroup; moving the wrap into
 * GameTable would orphan {@code GameDialog} + {@code GameEndOverlay}
 * which are siblings, not children, of GameTable.
 *
 * <p><b>Dialog dock (technical critic I1):</b> Three non-blocking
 * dialogs (gameSelect / gameTarget / gamePlayMana) render at
 * {@code fixed bottom-4 right-4} today. Without adjustment they
 * physically overlap the new side panel. GameTable exposes
 * {@code --side-panel-width} as a CSS custom property on the root;
 * GameDialog reads it via {@code right-[calc(var(--side-panel-width)+1rem)]}
 * to dock just left of the panel.
 *
 * <p><b>SR announcers (technical critic N4):</b> The priority +
 * elimination live regions migrate from Battlefield to here so their
 * parent doesn't mutate for unrelated layout reasons (slice 69d's
 * isolation pattern).
 */
interface Props {
  gameView: WebGameView;
  stream: GameStream | null;
}

// Side panel column width — clamps so the battlefield gets enough
// room at 1280×720 (tightest target per ADR R5) without letting the
// panel grow unreadably wide at 2560×1440.
const SIDE_PANEL_WIDTH = 'clamp(280px, 22vw, 360px)';

export function GameTable({ gameView, stream }: Props) {
  // Slice 69d (D11a + D13) — eliminated-player live region. Now at
  // GameTable root so the parent doesn't mutate when battlefield
  // contents change. Empty string when KEEP_ELIMINATED is on (the
  // PlayerFrame aria-label conveys it; see battlefieldLayout.ts).
  const eliminationText = useMemo(
    () => formatEliminationAnnouncement(gameView.players),
    [gameView.players],
  );

  return (
    <div
      data-testid="game-table"
      className="h-full grid bg-zinc-950 text-zinc-100 overflow-hidden"
      // Slice 70-E critic UI-Critical-1 — inline style for the grid
      // template. The Tailwind bracket-arbitrary form was tokenizing
      // on whitespace inside the area-name strings; inline style
      // sidesteps that. Also exposes --side-panel-width as a CSS
      // variable so the dialog dock (GameDialog.tsx) can offset its
      // bottom-right shells to sit LEFT of the panel rather than
      // overlap it (technical critic I1).
      style={{
        ['--side-panel-width' as string]: SIDE_PANEL_WIDTH,
        gridTemplateAreas:
          '"header header" "battlefield sidepanel" "action sidepanel"',
        gridTemplateRows: 'auto 1fr auto',
        gridTemplateColumns: `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`,
      }}
    >
      {/*
        SR announcers — slice 69d isolated regions, relocated per
        slice 70-E technical critic N4.
      */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="priority-announcer"
        className="sr-only"
      >
        Priority: {gameView.priorityPlayerName || '—'}, Active:{' '}
        {gameView.activePlayerName || '—'}, {gameView.phase || ''}{' '}
        {gameView.step || ''}
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="elimination-announcer"
        className="sr-only"
      >
        {eliminationText}
      </div>

      <header
        data-testid="game-table-header"
        className="[grid-area:header] border-b border-zinc-800"
      >
        {/* GameHeader is mounted by the parent Game.tsx — slot via
          children would couple GameTable to the header internals.
          Today's shell renders as a header bar + the existing
          PhaseTimeline ribbon below; slice 70-E moves PhaseTimeline
          into the side panel instead. The actual header content is
          rendered by Game.tsx as a sibling of GameTable. */}
      </header>

      <main
        data-testid="game-table-battlefield"
        className="[grid-area:battlefield] min-w-0 min-h-0 flex flex-col"
      >
        <Battlefield gv={gameView} stream={stream} />
      </main>

      <aside
        data-testid="game-table-sidepanel"
        className={
          '[grid-area:sidepanel] flex flex-col ' +
          'border-l border-zinc-800 bg-zinc-900/40 min-h-0'
        }
      >
        <PhaseTimeline gameView={gameView} />
        {/*
          Slice 70-E critic UX-3 — wrapper must be flex so GameLog's
          inner flex-1 + min-h-0 chain correctly constrains the
          scroll-container height. Without `flex flex-col` here, the
          flex-1 inside GameLog had no flex parent and would grow to
          intrinsic content height, breaking auto-scroll-to-bottom.
        */}
        <div className="flex-1 min-h-0 flex flex-col">
          <GameLog />
        </div>
        {/*
          Slice 70-F will mount CommanderDamageTracker here. Until
          then, render an unstyled marker div — UI critic Nice-5
          flagged that the previous `border-t + py-2` empty slot
          looked like a render glitch. The aria-hidden div with
          zero content reserves the slot for 70-F without the
          half-state visual chrome.
        */}
        <div
          data-testid="commander-damage-slot"
          aria-hidden="true"
        />
      </aside>

      <footer
        data-testid="game-table-action"
        className="[grid-area:action] border-t border-zinc-800"
      >
        {gameView && <ActionPanel stream={stream} />}
      </footer>

      {/* GameDialog is positioned via fixed children that escape this
        grid; we just mount it here so React's tree owns the lifecycle.
        The dialog's `right-` offset reads --side-panel-width above
        so its bottom-right shells dock LEFT of the panel. */}
      <GameDialog stream={stream} />
    </div>
  );
}
