import { useMemo } from 'react';
import type { WebCardView, WebGameView } from '../api/schemas';
import type { GameStream } from './stream';
import { ActionButton } from './ActionButton';
import { ActionPanel } from '../pages/ActionPanel';
import { Battlefield } from './Battlefield';
import { CommanderDamageTracker } from './CommanderDamageTracker';
import { GameLog } from './GameLog';
import { GameDialog } from './dialogs/GameDialog';
import { RevealToast } from './RevealToast';
import { ManaCost } from './ManaCost';
import { MulliganModal } from './MulliganModal';
import { MyHand } from './MyHand';
import { PhaseTimeline } from './PhaseTimeline';
import { REDESIGN } from '../featureFlags';
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
import { CommanderColorsProvider } from './useCommanderColors';
import { buildOnSpendMana } from './manaPaymentAdapter';

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

// LEGACY-BRANCH-FORK — slice 70-X.13 (Wave 4) cleanup marker.
// GameTable forks on REDESIGN inline at multiple sites in the return
// JSX (grid templates at ~227-247, header placeholder at ~284, hand
// mounts at ~336+357, etc.) rather than a single if (REDESIGN)
// branch. When VITE_FEATURE_REDESIGN flips default-on:
//   1. grep this file for "REDESIGN" — every site is a fork.
//   2. For ternaries ({REDESIGN ? a : b}): keep the truthy side.
//   3. For guards ({!REDESIGN && ...}): delete the whole block.
//   4. For guards ({REDESIGN && ...}): unwrap, keep the contents.
//   5. Drop the `import { REDESIGN } from '../featureFlags'` once
//      no references remain.
// Mechanical, no behavior change. The same procedure applies to
// PlayerArea.tsx, MyHand.tsx, and Battlefield.tsx — each carries its
// own LEGACY-BRANCH-FORK marker. The physical-file split (a separate
// PlayerArea.redesign.tsx etc.) is intentionally deferred until the
// flag actually flips, so we don't maintain two physical files in
// lockstep that will be reunified anyway.
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
  // Slice 70-O — header layout/zoom icon toggles this; when true the
  // side panel column is removed from the grid template, freeing the
  // space for battlefield + hand. Reads from the store; flips on
  // header click (REDESIGN only).
  const sidePanelCollapsed = useGameStore((s) => s.sidePanelCollapsed);
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

  // Slice 70-X.10 (user feedback 2026-04-30) — when the engine has
  // a gamePlayMana / gamePlayXMana dialog active, surface it as a
  // clickable mana pool. Click → manaType response with the upstream
  // enum string. Slice 70-X.13 (Wave 4) — the color→enum map and
  // dispatch factory moved to manaPaymentAdapter.ts so this layout
  // file isn't carrying a mapping table that should live with the
  // wire contract.
  const onSpendMana = useMemo(
    () => buildOnSpendMana(stream ?? null, pendingDialog),
    [stream, pendingDialog],
  );
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
    <CommanderColorsProvider gameView={gameView}>
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
        ['--side-panel-width' as string]: sidePanelCollapsed
          ? '0px'
          : SIDE_PANEL_WIDTH,
        // Slice 70-F — added a `hand` row between battlefield and
        // action so MyHand sits in its own region per spec §4. The
        // side panel still spans every body row on the right.
        //
        // Slice 70-M (picture-catalog §6.1) — REDESIGN drops the
        // 'action' grid row entirely. The single morphing
        // ActionButton lives at the bottom of the side panel
        // (catalog §5.C). Side panel grows to fill the freed
        // vertical space.
        //
        // Slice 70-O (picture-catalog §1.3) — REDESIGN header
        // layout/zoom icon toggles `sidePanelCollapsed`. When true,
        // the grid drops the sidepanel column entirely (single-
        // column 1fr) so battlefield + hand expand to full width.
        // The side <aside> is still mounted (preserves React tree +
        // store subscriptions) but {@code display: none} hides it
        // visually — re-expanding restores its prior scroll
        // position cheaply.
        // Slice 70-Z polish round 14 (user direction 2026-04-30) —
        // REDESIGN drops the in-grid `hand` row entirely. The hand
        // is now mounted as a `position: fixed` sibling pinned to
        // the viewport bottom, overlapping the battlefield's lower
        // edge so the play area gains the freed vertical space.
        // (Slice 70-O previously also dropped the `header` row for
        // analogous reasons — header is a sibling of GameTable.)
        // Legacy `!REDESIGN` keeps the in-grid hand row since the
        // legacy MyHand still uses panel-tray chrome.
        gridTemplateAreas: REDESIGN
          ? sidePanelCollapsed
            ? '"battlefield"'
            : '"battlefield sidepanel"'
          : '"header header" ' +
            '"battlefield sidepanel" ' +
            '"hand sidepanel" ' +
            '"action sidepanel"',
        gridTemplateRows: REDESIGN
          ? '1fr'
          : 'auto 1fr auto auto',
        gridTemplateColumns:
          REDESIGN && sidePanelCollapsed
            ? 'minmax(0, 1fr)'
            : `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}`,
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

      {/* Slice 70-O — REDESIGN drops the in-grid header slot. The
          actual GameHeader is rendered as a sibling of GameTable
          by Game.tsx (catalog §1.1 "Header sits OUTSIDE the side
          panel"). Legacy !REDESIGN still uses the placeholder
          below because its visual treatment includes a border-b. */}
      {!REDESIGN && (
        <header
          data-testid="game-table-header"
          className="[grid-area:header] border-b border-zinc-800"
        />
      )}

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
            index.css). Slice 70-Z polish reverted the per-priority
            tinting — the backdrop is a static dark-gray + warm-gold
            ambient palette per user direction; the gradient lives
            entirely in the CSS class. */}
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

      {/* Slice 70-Z polish round 14 (user direction 2026-04-30) —
          REDESIGN hand is no longer an in-grid section. It mounts
          as a `position: fixed` sibling pinned to viewport bottom
          with `right: var(--side-panel-width)` so it spans the
          battlefield column only (skips the side panel). The hand
          fan visually OVERLAPS the battlefield's bottom edge for
          space efficiency — battlefield content scrolls / paints
          BEHIND the floating hand. Legacy keeps the in-grid
          panel-tray look since legacy MyHand has chrome that
          shouldn't float. */}
      {!REDESIGN && (
        <section
          data-testid="game-table-hand"
          className="[grid-area:hand] min-w-0 border-t border-zinc-800 px-4 pb-2"
          aria-label="Your hand"
        >
          {me && (
            <MyHand
              hand={gameView.myHand}
              player={me}
              canAct={canAct}
              onObjectClick={onObjectClick}
              isMyTurn={!!me.isActive}
              hasPriority={!!me.hasPriority}
              onPointerDown={beginHandPress}
              draggedCardId={drag?.cardId ?? null}
              onSpendMana={onSpendMana}
              stream={stream}
            />
          )}
        </section>
      )}
      {REDESIGN && me && (
        <section
          data-testid="game-table-hand"
          // Slice 70-Z polish round 16 (user feedback 2026-04-30) —
          // hand container shifted DOWN so ~25% of each card sits
          // BELOW viewport bottom. Frees vertical real estate for
          // the battlefield (the player's local pod + bottom rows
          // become more visible) and matches an MTGA-style "cards
          // sitting at the very bottom of the screen, peeking
          // above" silhouette. Offset is derived from
          // --card-size-large so a future card-size retune
          // propagates automatically: 25% of card height (which
          // is card-width × 7/5 for the 5:7 portrait aspect).
          className="fixed left-0 z-30 px-4 pointer-events-none"
          style={{
            right: 'var(--side-panel-width)',
            bottom: 'calc(var(--card-size-large) * -7 / 5 * 0.25)',
          }}
          aria-label="Your hand"
        >
          {/* pointer-events-none on the section + auto on the
              inner MyHand wrapper so empty stretches of the hand
              area let pod / battlefield content underneath stay
              clickable; only the actual cards capture clicks. */}
          <div className="pointer-events-auto">
            <MyHand
              hand={gameView.myHand}
              player={me}
              canAct={canAct}
              onObjectClick={onObjectClick}
              isMyTurn={!!me.isActive}
              hasPriority={!!me.hasPriority}
              onPointerDown={beginHandPress}
              draggedCardId={drag?.cardId ?? null}
              onSpendMana={onSpendMana}
              stream={stream}
            />
          </div>
        </section>
      )}

      <aside
        data-testid="game-table-sidepanel"
        data-collapsed={sidePanelCollapsed || undefined}
        // Slice 70-O — when collapsed by the header layout/zoom
        // icon, hide via display:none rather than unmounting. The
        // grid template above already drops the sidepanel column,
        // but the React tree (and any subscriptions / scroll
        // positions inside GameLog) stays intact for cheap re-
        // expand.
        hidden={REDESIGN && sidePanelCollapsed}
        className={
          // Slice 70-M critic CARRY-OVER-1 fix — picture-catalog
          // §5.0 specifies --color-bg-elevated (#152229) for the
          // panel background. The legacy `bg-zinc-900/40` was a
          // slice 70-E carryover that the catalog (added
          // 2026-04-29) invalidated.
          '[grid-area:sidepanel] flex flex-col ' +
          'border-l border-zinc-800 bg-bg-elevated min-h-0'
        }
      >
        {/* Slice 70-Z polish round 23 — PhaseTimeline relocated to
            the GameHeader strip in REDESIGN mode; legacy keeps it
            in the side panel's top section so the legacy layout
            doesn't lose the turn/phase indicator. */}
        {!REDESIGN && <PhaseTimeline gameView={gameView} />}
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
        {/* Slice 70-M (picture-catalog §5.C) — single morphing
            ActionButton at the bottom of the side panel under the
            commander damage tracker. REDESIGN-only; legacy keeps
            the multi-button ActionPanel in the action footer
            below.
            Slice 70-O — when the side panel is collapsed via the
            header layout/zoom icon, the button moves to a floating
            bottom-right dock (rendered as a sibling below) so the
            primary action affordance is always reachable. */}
        {REDESIGN && !sidePanelCollapsed && <ActionButton stream={stream} />}
      </aside>

      {/* Slice 70-O critic UI/UX-C1 fix — floating ActionButton
          dock when the side panel is collapsed. Without this,
          collapsing the panel hid the only visible primary-action
          surface; new users without F2 hotkey muscle memory would
          have no way to advance phases. The dock sits at the
          bottom-right of the viewport (where the side-panel
          ActionButton normally lives), pinned via fixed positioning
          so battlefield content can scroll behind it. Mutually
          exclusive with the in-panel mount above so menu / hotkey
          state stays single-source. */}
      {REDESIGN && sidePanelCollapsed && (
        <div
          data-testid="game-table-action-floating-dock"
          className="fixed bottom-3 right-3 z-30 w-[clamp(220px,18vw,320px)]
            rounded-lg bg-bg-elevated/95 backdrop-blur-sm
            border border-zinc-800 shadow-xl p-2"
        >
          <ActionButton stream={stream} />
        </div>
      )}

      {/* Slice 70-M (picture-catalog §6.1) — REDESIGN drops the
          action footer entirely. The morphing button + ellipsis
          menu live in the side panel above. */}
      {!REDESIGN && (
        <footer
          data-testid="game-table-action"
          className="[grid-area:action] border-t border-zinc-800"
        >
          {gameView && <ActionPanel stream={stream} />}
        </footer>
      )}

      {/* GameDialog is positioned via fixed children that escape this
        grid; we just mount it here so React's tree owns the lifecycle.
        The dialog's `right-` offset reads --side-panel-width above
        so its bottom-right shells dock LEFT of the panel. */}
      <GameDialog stream={stream} />

      {/* Bug fix (2026-05-02) — momentary reveal toast (CR 701.16a).
          Mounted at GameTable level so it escapes the grid and floats
          over both battlefield and hand. Dispatched from the store's
          gameInform reducer when a "<player> reveals <card>" log line
          arrives. */}
      <RevealToast />

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
    </CommanderColorsProvider>
  );
}
