import { useMemo } from 'react';
import type { WebCardView, WebGameView } from '../api/schemas';
import type { GameStream } from './stream';
import { ActionPanel } from '../pages/ActionPanel';
import { Battlefield } from './Battlefield';
import { CommanderDamageTracker } from './CommanderDamageTracker';
import { GameLog } from './GameLog';
import { GameDialog } from './dialogs/GameDialog';
import { ManaCost } from './ManaCost';
import { MulliganModal } from './MulliganModal';
import { MyHand } from './MyHand';
import { PhaseTimeline } from './PhaseTimeline';
import {
  formatEliminationAnnouncement,
  selectOpponents,
  useConnectionStateAnnouncements,
} from './battlefieldLayout';
import {
  deriveInteractionMode,
  type InteractionMode,
} from './interactionMode';
import { isBoardClickable, routeObjectClick } from './clickRouter';
import { useDragState } from './useDragState';
import { useGameStore } from './store';

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
  gameId: string;
  gameView: WebGameView;
  stream: GameStream | null;
}

// Side panel column width — clamps so the battlefield gets enough
// room at 1280×720 (tightest target per ADR R5) without letting the
// panel grow unreadably wide at 2560×1440.
const SIDE_PANEL_WIDTH = 'clamp(280px, 22vw, 360px)';

export function GameTable({ gameId, gameView, stream }: Props) {
  // Slice 69d (D11a + D13) — eliminated-player live region. Now at
  // GameTable root so the parent doesn't mutate when battlefield
  // contents change. Empty string when KEEP_ELIMINATED is on (the
  // PlayerFrame aria-label conveys it; see battlefieldLayout.ts).
  const eliminationText = useMemo(
    () => formatEliminationAnnouncement(gameView.players),
    [gameView.players],
  );
  // Slice 70-H.5 (per slice 70-H critic UX-I3) — diff-based aria-live
  // text for connection-state transitions. The PlayerFrame's
  // role="group" aria-label already says "disconnected" but most SR
  // engines don't announce attribute changes on a group; this
  // dedicated polite region announces "alice disconnected" /
  // "alice reconnected" once per transition so SR users get parity
  // with the sighted-user pill fade.
  const connectionStateText = useConnectionStateAnnouncements(gameView.players);

  // Slice 70-F — drag-state ownership lifted from Battlefield. With
  // MyHand now in its own grid region (sibling of Battlefield, not
  // child), the two need a shared owner for the drag state. The
  // hook also owns the document-level pointermove/up listeners.
  const { drag, beginHandPress } = useDragState();

  // Slice 70-F — interaction-mode derivation lifted alongside drag
  // state so MyHand (drag source) and Battlefield (drop targets +
  // PlayerArea click) can share one source of truth. Battlefield
  // re-derives gv-shape data (eligibleTargetIds, combatRoles, me,
  // opponents) internally — those are cheap and don't need lifting.
  const pendingDialog = useGameStore((s) => s.pendingDialog);
  const clearDialog = useGameStore((s) => s.clearDialog);
  const me = useMemo(
    () => gameView.players.find((p) => p.playerId === gameView.myPlayerId) ?? null,
    [gameView.players, gameView.myPlayerId],
  );
  const opponents = useMemo(
    () => selectOpponents(gameView.players, gameView.myPlayerId),
    [gameView.players, gameView.myPlayerId],
  );
  const mode: InteractionMode = useMemo(
    () => deriveInteractionMode(pendingDialog),
    [pendingDialog],
  );
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

  // Floating drag preview — was inside Battlefield's render tree;
  // moved here so it sits at the same DOM level as MyHand and the
  // pod regions, all under one fixed-position overlay. The card
  // lookup uses gv.myHand (the only place drag origins are bound
  // today).
  const draggedCard: WebCardView | null = useMemo(() => {
    if (!drag) return null;
    return gameView.myHand[drag.cardId] ?? null;
  }, [drag, gameView.myHand]);

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
        // Slice 70-F — added a `hand` row between battlefield and
        // action so MyHand sits in its own region per spec §4. The
        // side panel still spans every body row on the right.
        gridTemplateAreas:
          '"header header" ' +
          '"battlefield sidepanel" ' +
          '"hand sidepanel" ' +
          '"action sidepanel"',
        gridTemplateRows: 'auto 1fr auto auto',
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
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="connection-state-announcer"
        className="sr-only"
      >
        {connectionStateText}
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
        className="[grid-area:battlefield] min-w-0 min-h-0 flex flex-col relative"
      >
        {/*
          Slice 70-F — particle-drift ambient backdrop. Sits behind
          the battlefield content via absolute positioning + lower
          stacking (no z-index needed; the children don't set their
          own). Reduced-motion silences the keyframe per slice 70-B
          contract (no data-essential-motion = killed under reduce).
        */}
        <div
          data-testid="particle-drift-layer"
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none overflow-hidden"
        >
          {/* Slice 70-F critic UI-#2 — opacity-40 wrapper dropped;
            the keyframe owns the final alpha so the layer is
            actually visible (per-gradient alphas raised in
            index.css). */}
          <div className="animate-particle-drift h-full w-full" />
        </div>

        <Battlefield
          gv={gameView}
          mode={mode}
          canAct={canAct}
          onObjectClick={onObjectClick}
          drag={drag}
        />
      </main>

      <section
        data-testid="game-table-hand"
        className="[grid-area:hand] min-w-0 border-t border-zinc-800 px-4 pb-2"
        aria-label="Your hand"
      >
        {me && (
          <MyHand
            hand={gameView.myHand}
            canAct={canAct}
            onObjectClick={onObjectClick}
            isMyTurn={!!me.isActive}
            hasPriority={!!me.hasPriority}
            onPointerDown={beginHandPress}
            draggedCardId={drag?.cardId ?? null}
          />
        )}
      </section>

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
          {/* Slice 70-L — players prop drives the redesigned
              game-log avatar resolution. Legacy log path
              ignores it cleanly (default = empty list). */}
          <GameLog players={gameView.players} />
        </div>
        {/*
          Slice 70-F — CommanderDamageTracker mounts in the slot
          70-E reserved. Client-only manual tracker per spec §7.15
          (the engine does not enforce its accuracy). Hidden when
          there's no commander game in progress (no command zone
          entries on any player).
        */}
        <CommanderDamageTracker
          gameId={gameId}
          gameView={gameView}
          opponents={opponents}
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

      {/* Slice 70-F — Mulligan modal wraps the engine's gameAsk
          mulligan flow with the spec §Mulligan full-mode chrome
          (4-pod "deciding" status panels). Wire contract is
          unchanged — MulliganModal renders AskDialog inside its
          modal shell; the response goes through the same
          sendPlayerResponse path. */}
      <MulliganModal stream={stream} gameView={gameView} />

      {/* Slice 70-F — floating drag preview moved up from
          Battlefield. Sits at the GameTable level so it can float
          over the hand region (now a sibling) as well as the
          battlefield. fixed + pointer-events-none so it never eats
          clicks. */}
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
    </div>
  );
}
