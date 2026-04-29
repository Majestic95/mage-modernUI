import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
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
} from '../game/battlefieldRows';
import type {
  WebCardView,
  WebGameView,
  WebPlayerView,
} from '../api/schemas';
import { ActionPanel } from './ActionPanel';
import { ManaCost } from '../game/ManaCost';
import { CardThumbnail } from '../game/CardThumbnail';
import { CommandZone } from '../game/CommandZone';
import { LifeTotal } from '../game/LifeTotal';
import { ManaPool } from '../game/ManaPool';
import { ZoneCounter } from '../game/ZoneBrowser';
import { GameDialog } from './GameDialog';
import { GameEndOverlay } from '../game/GameEndOverlay';
import { PhaseTimeline } from '../game/PhaseTimeline';
import { GameLog } from '../game/GameLog';
import { GameHeader } from '../game/GameHeader';
import { Waiting } from '../game/Waiting';
import { BattlefieldRowGroup } from '../game/BattlefieldRowGroup';
import { MyHand } from '../game/MyHand';
import { StackZone } from '../game/StackZone';

interface Props {
  gameId: string;
  onLeave: () => void;
}

/**
 * Slice A static game window â€” read-only render of the latest
 * {@link WebGameView} (per ADR 0005 Â§5.1).
 *
 * <p>Layout: opponent at top, controlling player at bottom. Each side
 * shows life total, hand count (or hand cards for self), zone counts,
 * mana pool, and battlefield as named cards with tapped/sick markers.
 * Stack, combat groups, graveyard / exile / sideboard panels and chat
 * land in slice B; player input lands in slice C (ADR Â§5.2).
 *
 * <p>The component owns one {@link GameStream} for its lifetime â€” open
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
    // React 19 StrictMode dev runs effects setup â†’ cleanup â†’ setup
    // in quick succession. A naive synchronous open() fires a real
    // WebSocket connect on the first mount. The connect triggers
    // upstream's joinGame on the server, the cleanup immediately
    // closes the socket (EofException + 1006), and upstream is left
    // in a half-joined state until its 10-second recovery timer
    // fires "Forced join" â€” by which time the AI has played its
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
    // Slice 52c â€” MotionConfig + LayoutGroup wrap the whole game
    // window so the three card-face components (StackTileFace,
    // BattlefieldTile, HandCardSlot) participate in one shared
    // Framer-Motion layoutId graph. Without LayoutGroup, layoutId
    // matching only happens within a single AnimatePresence; our
    // zones live in separate AnimatePresences (stack vs.
    // battlefield), so cross-zone glides need the LayoutGroup to
    // bridge them. MotionConfig.reducedMotion="user" honors the
    // OS-level prefers-reduced-motion setting â€” users with it on
    // see instant transitions instead of glides.
    //
    // Sideboard/draft zones don't yet exist as separate components
    // in this fork; if they're ever added in their own panel and
    // don't need cross-zone glides into the in-game stack, scope
    // their LayoutGroup separately to avoid the 60+-card hand-fan
    // performance hit.
    //
    // SCOPE CONTRACT (read before adding new animated UI):
    //   â€¢ Anything that should glide via layoutId must render as a
    //     descendant of THIS LayoutGroup. The hand fan, stack zone,
    //     and battlefield are all reached via Battlefield â†’ so they
    //     qualify.
    //   â€¢ Anything modal/overlay that should NOT participate in
    //     layoutId matching (sideboard panels, deck builder, future
    //     spell-history panel, etc.) must render outside this tree
    //     â€” preferably via a portal at App.tsx level. SideboardModal
    //     already lives in App.tsx for that reason. HoverCardDetail
    //     uses createPortal to escape this scope; that's intentional.
    //   â€¢ Performance budget: keep tracked motion elements inside the
    //     LayoutGroup â‰¤ ~50 during a turn. A typical game is â‰¤7 hand
    //     + â‰¤20 battlefield + â‰¤3 stack â‰ˆ 30 elements, well within
    //     budget. If a future feature would exceed that (e.g. a
    //     graveyard popover that shows 60 cards with layoutId), put
    //     it in its own LayoutGroup or no LayoutGroup at all.
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
          <GameHeader
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
  // pending dialog + game view â€” pure derivation, no stored state.
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

  // Slice 36 â€” drag-to-play from hand. Pointer-events DnD per ADR
  // 0005 Â§6 (no third-party library). Anchor the press in a ref so
  // a quick click (no movement) stays a click; cross a 5px
  // threshold to enter drag mode and surface a floating preview
  // following the cursor. PlayerArea elements are the drop zones;
  // they fire onPointerUp which (when drag is active) routes the
  // hand-card UUID through the same clickRouter the click path
  // uses â€” same engine behavior, just a more natural mouse-first
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
  // progress, that's a "drop on the board" â€” route the hand-card
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

  // Slice 26 â€” combat highlighting:
  // - eligibleCombatIds: legal-attacker / legal-blocker set during the
  //   matching combat step. Empty in any other mode.
  // - combatRoles: which permanents are *currently* attacking or
  //   blocking, per gv.combat[]. Independent of mode â€” drives the
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

  // Slice 36 â€” surface the dragged card as a floating preview that
  // tracks the cursor. We resolve the card object from the hand
  // (the only place drag origins are bound today).
  const draggedCard = useMemo<WebCardView | null>(() => {
    if (!drag) return null;
    return gv.myHand[drag.cardId] ?? null;
  }, [drag, gv.myHand]);

  return (
    // Slice 57 (UX audit fix B) â€” Battlefield restructure. Pre-fix:
    // self section was flex-1 overflow-auto and contained MyHand,
    // so when the self battlefield + hand overflowed, MyHand scrolled
    // off the bottom and the action panel sat behind clipped cards.
    //
    // Post-fix: opponent section + stack + self battlefield section
    // each handle their own intrinsic content (no per-section scroll).
    // MyHand is pulled OUT of the self section into its own
    // flex-shrink-0 slot at the bottom of Battlefield, so it's
    // always visible at full height regardless of how many
    // permanents are out. The whole Battlefield wrapper gets
    // overflow-y-auto for the rare case the combined intrinsic
    // height exceeds the viewport on a small laptop.
    <div className="flex-1 flex flex-col relative overflow-y-auto">
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
      {/* Opponents row(s) â€” top. flex-shrink-0 = intrinsic height. */}
      <section className="flex-shrink-0 border-b border-zinc-800 p-4 space-y-4">
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

      {/* Stack â€” between players (slice 27). Collapses to nothing
          when empty so the surrounding layout doesn't shift. */}
      <StackZone stack={gv.stack} />

      {/* Self battlefield â€” middle-bottom. flex-1 so it absorbs
          excess vertical space when small (no awkward gap to hand). */}
      <section className="flex-1 p-4 space-y-4 min-h-0">
        {me ? (
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
        ) : (
          <p className="text-zinc-500 italic">
            Spectator view â€” no controlling player.
          </p>
        )}
      </section>

      {/* My hand â€” bottom slot, ALWAYS visible at full height. Was
          inside self section pre-slice-57; moved out so an
          overflowing battlefield can't scroll the hand off-screen. */}
      {me && (
        <div className="flex-shrink-0 border-t border-zinc-800 px-4 pb-2">
          <MyHand
            hand={gv.myHand}
            canAct={canAct}
            onObjectClick={onObjectClick}
            isMyTurn={!!me.isActive}
            hasPriority={!!me.hasPriority}
            onPointerDown={beginHandPress}
            draggedCardId={drag?.cardId ?? null}
          />
        </div>
      )}
    </div>
  );
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
   * Slice 26 â€” IDs the engine considers legal attackers (during
   * declareAttackers) or legal blockers (during declareBlockers).
   * Empty set in any other mode.
   */
  eligibleCombatIds: Set<string>;
  /**
   * Slice 26 â€” permanents already in a combat group, mapped to
   * their role. Drives the ATK / BLK badge on each chip.
   */
  combatRoles: Map<string, 'attacker' | 'blocker'>;
  /**
   * Slice 36 â€” true while a hand-card drag is in progress. Adds a
   * dashed ring around the area so the user can see where releasing
   * will play the card.
   */
  isDropTarget: boolean;
  /**
   * Slice 36 â€” fired on pointerup over the area. The Battlefield
   * checks its own drag state and dispatches the play action when
   * appropriate; if no drag was active this is a no-op.
   */
  onBoardDrop: () => void;
}) {
  const battlefield = Object.values(player.battlefield);
  // Slice 53 â€” group permanents into MTGA-style rows (creatures /
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
          // Slice 50 â€” ETB animation. Slides up from below + scales
          // so the eye reads "spell resolves into permanent" as one
          // motion.
          //
          // Slice 52c â€” pairs with the StackZone {@code layoutId} so
          // a resolving creature spell glides from its stack tile to
          // its battlefield tile (same {@code cardId}). LayoutGroup
          // at the Game root bridges the two AnimatePresences so
          // Framer can match the IDs across zones. The
          // {@code initial}/{@code exit} y+scale springs above keep
          // working alongside layoutId â€” layout-driven motion uses
          // the {@code transition.layout} spring (LAYOUT_GLIDE, baked
          // into BATTLEFIELD_ENTER_EXIT), and the regular
          // {@code initial}/{@code exit} keys use the default spring
          // on this transition.
          //
          // Slice 53 â€” split into three type-grouped rows. Each row
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
