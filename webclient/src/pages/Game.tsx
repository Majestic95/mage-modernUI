import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from 'framer-motion';
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
  type BattlefieldRow,
} from '../game/battlefieldRows';
import type {
  WebCardView,
  WebGameView,
  WebPermanentView,
  WebPlayerView,
} from '../api/schemas';
import { ActionPanel } from './ActionPanel';
import { CardFace } from '../game/CardFace';
import { ManaCost } from '../game/ManaCost';
import { HoverCardDetail } from '../game/HoverCardDetail';
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
import { slow, SLOWMO } from '../animation/debug';
import {
  BATTLEFIELD_ENTER_EXIT,
  HAND_HOVER_LIFT_MS,
  LAYOUT_GLIDE,
  STACK_ENTER_EXIT,
  STACK_ZONE_COLLAPSE_MS,
  UNTAP_STAGGER_DELAY_MS,
} from '../animation/transitions';

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

/**
 * Stack zone â€” slice 27. Renders the spells / abilities currently on
 * the stack between the opponents row and the self row. Collapses to
 * {@code null} when empty so the surrounding layout doesn't shift.
 *
 * <p>Order: newest-first ({@code Object.values(...).reverse()}). The
 * upstream wire preserves insertion order via {@code LinkedHashMap}
 * (oldest first); reversing matches the MTGO/MTGA convention of
 * showing the top-of-stack at the top of the UI.
 *
 * <p>No click handlers in this slice â€” interacting with stack
 * objects is rare in 1v1 and would conflict with the free-priority
 * click router. The tooltip surfaces the rules text so the player
 * can see what's about to resolve.
 */
function StackZone({ stack }: { stack: Record<string, WebCardView> }) {
  const entries = Object.values(stack).reverse();
  // Slice 50 â€” keep the section mounted while AnimatePresence flushes
  // the last exit animation, otherwise the stack tile pops out
  // immediately when the spell resolves and the section unmounts.
  const isEmpty = entries.length === 0;
  return (
    <section
      data-testid="stack-zone"
      className={`flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 transition-opacity ${
        isEmpty ? 'opacity-0 pointer-events-none h-0 overflow-hidden py-0 border-b-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${STACK_ZONE_COLLAPSE_MS * SLOWMO}ms` }}
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
        Stack ({entries.length}) â€” top resolves first
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {entries.map((card, idx) => {
            const tooltip = [card.typeLine, ...(card.rules ?? [])]
              .filter(Boolean)
              .join('\n');
            // Slice 52c â€” layoutId={card.cardId} ties this stack tile
            // to the resolved permanent's battlefield tile (same
            // cardId after the spell resolves, since cardId is the
            // underlying-Card UUID â€” Spell.id â‰  Permanent.id but
            // Spell.getCard().getId() === Permanent.id). LayoutGroup
            // at the Game-page root crosses the AnimatePresence
            // boundary so Framer matches the two siblings.
            //
            // Empty-string cardId is a defensive default for older
            // fixtures (slice 52b) â€” passing '' as layoutId would
            // collide every "missing" card into one shared id.
            // {@code undefined} disables layout-id matching for
            // that tile.
            const layoutId = card.cardId ? card.cardId : undefined;
            return (
              <motion.div
                key={card.id}
                layout
                layoutId={layoutId}
                data-layout-id={layoutId}
                initial={{ opacity: 0, y: -16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.85 }}
                transition={slow(STACK_ENTER_EXIT)}
              >
                <HoverCardDetail card={card}>
                  <div
                    data-testid="stack-entry"
                    className="relative"
                    title={tooltip || card.name}
                  >
                    <StackTileFace card={card} />
                    {idx === 0 && (
                      <span
                        data-testid="stack-top-marker"
                        className="absolute -top-1.5 -right-1.5 text-[9px] font-semibold bg-fuchsia-500 text-zinc-100 px-1 rounded shadow"
                      >
                        TOP
                      </span>
                    )}
                  </div>
                </HoverCardDetail>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}

/**
 * Small card-shaped tile for stack entries (slice 48). Same 5:7
 * shape as HandCardFace / BattlefieldTileFace, scaled down to
 * 60Ã—84 â€” the stack rarely holds more than 1-3 entries in 1v1, but
 * the tile needs to stay narrow so the stack-zone header doesn't
 * eat too much battlefield real estate.
 *
 * <p>Defensive image-fail fallback identical to HandCardFace â€”
 * a name-only gradient silhouette so a missing print doesn't
 * leave a broken-image icon on the stack.
 */
function StackTileFace({ card }: { card: WebCardView }) {
  return <CardFace card={card} size="stack" />;
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

/**
 * Slice 53 â€” one MTGA-style row of permanents. Owns its own
 * {@link AnimatePresence} so enter / exit animations fire
 * independently per row when permanents move between rows (e.g. an
 * animated land flipping in / out of creature status) or land here
 * from another zone. The wrapper {@code <div>} is plain DOM â€” no
 * motion â€” so a row container appearing or disappearing is a
 * structural change, not an animation, and won't orphan any tile
 * springs mid-flight.
 */
function BattlefieldRowGroup({
  row,
  permanents,
  canAct,
  onObjectClick,
  eligibleCombatIds,
  combatRoles,
}: {
  row: BattlefieldRow;
  permanents: WebPermanentView[];
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  return (
    <div
      data-testid="battlefield-row"
      data-row={row}
      className="flex flex-wrap gap-2 min-h-[16px]"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {permanents.map((perm, index) => {
          const layoutId = perm.card.cardId ? perm.card.cardId : undefined;
          return (
            <motion.div
              key={perm.card.id}
              layout
              layoutId={layoutId}
              data-layout-id={layoutId}
              initial={{ opacity: 0, y: 24, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.85 }}
              transition={slow(BATTLEFIELD_ENTER_EXIT)}
            >
              <BattlefieldTile
                perm={perm}
                canAct={canAct}
                onClick={onObjectClick}
                isEligibleCombat={eligibleCombatIds.has(perm.card.id)}
                combatRole={combatRoles.get(perm.card.id) ?? null}
                rotateDelay={(index * UNTAP_STAGGER_DELAY_MS) / 1000}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/**
 * Slice 45 â€” replaces the slice-9-era {@code PermanentChip} text-chip
 * with a card-shaped tile (5:7 aspect, ~80Ã—112). Mirrors
 * {@link HandCardFace} for the visual base â€” Scryfall art, mana cost,
 * name banner, P/T â€” and adds the battlefield-specific affordances:
 * tap rotation (90Â° clockwise), combat highlight ring, ATK/BLK
 * badges, damage chip, counter chip, summoning-sickness border.
 *
 * <p>Each tile is rendered inside a fixed 112Ã—112 square slot so the
 * tap rotation (which swaps the tile's bounding box from 80Ã—112
 * portrait to 112Ã—80 landscape) stays within the slot â€” neighbors
 * never reflow when a card taps.
 *
 * <p>The slot wrapper sits OUTSIDE {@link HoverCardDetail} on
 * purpose: HoverCardDetail's trigger span is {@code position:
 * relative}, and the slice-44a bug demonstrated that any
 * absolutely-positioned descendant collapses to the left edge of
 * that inline-flex span. The slot itself is a flex item (no
 * absolute positioning), so the bug doesn't trigger here, but
 * keeping the layout box outside HoverCardDetail also makes the
 * trigger element's bounding box exactly the tile, which gives
 * cleaner positioning for the popover.
 */
function BattlefieldTile({
  perm,
  canAct,
  onClick,
  isEligibleCombat,
  combatRole,
  rotateDelay,
}: {
  perm: WebPermanentView;
  canAct: boolean;
  onClick: (id: string) => void;
  /**
   * Slice 26 â€” the engine has marked this permanent as a legal
   * attacker (declareAttackers) or legal blocker (declareBlockers).
   * Renders an amber highlight ring so the player can see at a
   * glance which creatures the click-to-toggle gesture applies to.
   */
  isEligibleCombat: boolean;
  /**
   * Slice 26 â€” non-null when this permanent is currently in a
   * combat group ({@code gv.combat[]}). Drives the ATK / BLK badge.
   */
  combatRole: 'attacker' | 'blocker' | null;
  /**
   * Slice 58 â€” index-based stagger delay (in seconds) applied to the
   * tap/untap rotation spring. Produces a wave on start-of-turn untap.
   */
  rotateDelay?: number;
}) {
  const tapped = perm.tapped;
  return (
    // Fixed 112Ã—112 slot â€” the tile (80Ã—112 portrait) and its tapped
    // state (112Ã—80 landscape) both fit. flex centering keeps the
    // tile aligned regardless of orientation.
    <div className="w-[112px] h-[112px] flex items-center justify-center">
      <HoverCardDetail card={perm.card}>
        <button
          type="button"
          data-testid="permanent"
          data-tapped={tapped}
          data-combat-eligible={isEligibleCombat || undefined}
          data-combat-role={combatRole ?? undefined}
          disabled={!canAct}
          onClick={() => onClick(perm.card.id)}
          title={
            canAct
              ? `${perm.card.name} â€” click to tap/activate`
              : perm.card.typeLine
          }
          className={
            'select-none rounded-lg ' +
            (canAct
              ? 'cursor-pointer hover:ring-1 hover:ring-fuchsia-500'
              : 'cursor-default')
          }
        >
          <BattlefieldTileFace
            perm={perm}
            isEligibleCombat={isEligibleCombat}
            combatRole={combatRole}
            tapped={tapped}
            rotateDelay={rotateDelay}
          />
        </button>
      </HoverCardDetail>
    </div>
  );
}

/**
 * Inner card layout for {@link BattlefieldTile}. Layered:
 *   - Scryfall art covering the body via {@code normal} version
 *   - Mana cost overlay top-right
 *   - Name banner across the bottom
 *   - P/T overlay bottom-right (creatures) / loyalty (planeswalkers)
 *   - Counter chip top-left (when {@code card.counters} non-empty)
 *   - Damage chip lower-left (when {@code damage > 0})
 *   - Combat ATK / BLK badge top-left (over the counter chip slot;
 *     they shouldn't both be present in practice â€” combat badges
 *     only appear during declare-blockers/attackers, counters can
 *     appear any time but the visual collision is mild)
 *   - Combat-eligible amber ring on the outer card box
 *   - Tap state: rotate 90Â° clockwise + opacity 60%
 *   - Summoning sickness: subtle dashed zinc border (replaces the
 *     legacy italic text styling â€” italics don't carry meaning on
 *     a card-art tile)
 *
 * <p>Falls back to a name-only silhouette when Scryfall has no art
 * (token, ad-hoc emblem, etc.) â€” same defensive pattern as
 * {@link HandCardFace}.
 */
function BattlefieldTileFace({
  perm,
  isEligibleCombat,
  combatRole,
  tapped,
  rotateDelay,
}: {
  perm: WebPermanentView;
  isEligibleCombat: boolean;
  combatRole: 'attacker' | 'blocker' | null;
  tapped: boolean;
  rotateDelay?: number;
}) {
  return (
    <CardFace
      card={perm.card}
      size="battlefield"
      perm={perm}
      isEligibleCombat={isEligibleCombat}
      combatRole={combatRole}
      tapped={tapped}
      rotateDelay={rotateDelay}
    />
  );
}

function MyHand({
  hand,
  canAct,
  onObjectClick,
  isMyTurn,
  hasPriority,
  onPointerDown,
  draggedCardId,
}: {
  hand: Record<string, WebCardView>;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  isMyTurn: boolean;
  hasPriority: boolean;
  /**
   * Slice 36 â€” bound on each hand-card button to start the drag-
   * to-play gesture. The Battlefield owner decides whether the
   * press becomes a drag (5px movement threshold) or stays a
   * click; both paths route through {@code onObjectClick}.
   */
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  /**
   * Slice 36 â€” id of the card currently being dragged, if any.
   * The matching hand chip dims so the user can see which one is
   * "in flight". Other chips render normally.
   */
  draggedCardId: string | null;
}) {
  const cards = Object.values(hand);
  // Slice 23: clearer reason when hand is disabled.
  // - !hasPriority â†’ engine isn't waiting on you
  // - hasPriority && !isMyTurn â†’ you can react with instants but
  //   not play lands / sorceries; the user-typical click on a
  //   Forest is silently rejected by upstream because it's not
  //   their main phase.
  // The hint text spells out the rule so the user doesn't have to
  // internalize Magic's priority/timing system to understand why.
  const disabledHint = !hasPriority
    ? 'Waiting for opponent'
    : !isMyTurn
      ? 'Wait for your turn â€” most cards are sorcery-speed'
      : '';

  const cardTooltip = (card: WebCardView) => {
    if (canAct && isMyTurn) return `${card.name} â€” click to play/cast`;
    if (canAct && !isMyTurn) {
      // Instant-speed only on opponent's turn. Today we don't
      // distinguish instants in the UI; the engine will gameError
      // on illegal sorcery-speed clicks. Hint accordingly.
      return `${card.name} â€” only instants are playable on opponent's turn`;
    }
    return card.typeLine;
  };

  return (
    <div
      data-testid="my-hand"
      className="rounded border border-zinc-800 bg-zinc-900/40 p-3"
    >
      <div className="text-xs text-zinc-500 mb-2 uppercase tracking-wide flex items-baseline justify-between">
        <span>Your hand ({cards.length})</span>
        {disabledHint && (
          <span
            data-testid="hand-disabled-hint"
            className="text-[10px] normal-case tracking-normal text-zinc-500 italic"
          >
            {disabledHint}
          </span>
        )}
      </div>
      {/* Slice 44 â€” arc-fan hand layout per ADR 0005 Â§5. Cards are
          absolute-positioned along an arc with subtle per-card
          rotation, hover lifts the focused card to 0Â° + scale 1.15
          + raises z-index. Pointer-events DnD from slice 36 still
          works because the underlying button keeps the same
          handlers and testid. The wrapper is `h-44` so the lift
          has room without pushing layout.*/}
      {/*
        Slice 57 (UX audit fix C) â€” h-44 (176px) was 20px short for
        the 140px card + 56px hover-lift (= 196px needed). The
        lifted card was clipping at the top against the MyHand border.
        h-52 = 208px gives 12px overhead headroom plus pt-14 ensures
        the lift origin sits below the section header so a hovered
        card can fully float above without intersecting the "Your hand"
        label.
      */}
      <div className="relative h-52 pt-2">
        {cards.length === 0 ? (
          <span className="absolute left-3 top-3 text-xs text-zinc-600 italic">
            Empty hand.
          </span>
        ) : (
          // Slice 54 â€” wrap in AnimatePresence so a card removed from
          // the hand (cast / discard / shuffle-into-library) gets its
          // exit phase. Without this, Framer never sees the source
          // bbox and the layoutId={card.cardId} match (slices 52a-c)
          // can't fire â€” the stack tile pops up from above instead of
          // gliding from the hand position.
          <AnimatePresence mode="popLayout" initial={false}>
            {cards.map((card, idx) => {
              const isDragging = draggedCardId === card.id;
              return (
                <HandCardSlot
                  key={card.id}
                  card={card}
                  index={idx}
                  total={cards.length}
                  canAct={canAct}
                  isDragging={isDragging}
                  onObjectClick={onObjectClick}
                  onPointerDown={onPointerDown}
                  tooltip={cardTooltip(card)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* ---------- hand fan layout (slice 44) ---------- */

/**
 * Compute the resting-state transform + z-index for one card in the
 * arc fan. Cards spread symmetrically around center; angle and
 * x-offset scale linearly with distance from center; y-offset is a
 * shallow downward arc so the leftmost / rightmost cards droop
 * slightly (matches the way real hands of cards sit). Hover state
 * overrides this in the slot itself.
 */
function fanGeometry(index: number, total: number): {
  x: number;
  y: number;
  rot: number;
} {
  if (total <= 1) return { x: 0, y: 0, rot: 0 };
  const fromCenter = index - (total - 1) / 2;
  // Tighter spread when the hand is large so cards stay visible.
  const spreadPx = total > 5 ? Math.max(40, 80 - (total - 5) * 6) : 80;
  const maxAngle = 12;
  const x = fromCenter * spreadPx;
  const y = Math.abs(fromCenter) * 3;
  const rot = (fromCenter / ((total - 1) / 2)) * maxAngle;
  return { x, y, rot };
}

/**
 * One card in the hand fan. Wraps the existing
 * {@link HoverCardDetail} (rich popover) and adds an inner local
 * hover state for the lift / un-rotate / scale-up animation.
 */
function HandCardSlot({
  card,
  index,
  total,
  canAct,
  isDragging,
  onObjectClick,
  onPointerDown,
  tooltip,
}: {
  card: WebCardView;
  index: number;
  total: number;
  canAct: boolean;
  isDragging: boolean;
  onObjectClick: (id: string) => void;
  onPointerDown: (cardId: string, ev: React.PointerEvent) => void;
  tooltip: string;
}) {
  const [lifted, setLifted] = useState(false);
  const { x, y, rot } = fanGeometry(index, total);
  // Hover lift cancels the rotation, raises the card, scales it up,
  // and bumps z so it sits above siblings. Transform applied to the
  // OUTER absolute-positioned wrapper rather than the button â€” the
  // button is wrapped by HoverCardDetail's `relative inline-flex`
  // span, which would otherwise become the positioned ancestor and
  // collapse every card to the left edge of its own tiny span (the
  // bug fix from slice 44 follow-up).
  const transform = lifted
    ? `translate(-50%, 0) translateX(${x}px) translateY(-56px) rotate(0deg) scale(1.15)`
    : `translate(-50%, 0) translateX(${x}px) translateY(${y}px) rotate(${rot}deg)`;
  // Slice 52c â€” layoutId pinned to an INNER motion.div so the
  // fan-arc CSS transform on the OUTER div doesn't conflict with
  // Framer's layout-tracking. Framer reads the motion element's
  // bounding-client-rect to compute glide trajectories â€” putting
  // layoutId on the outer (fan-positioned) div would make Framer
  // think every hand card is already at the rotated/translated
  // position, and the cross-zone glide would start from the wrong
  // spot. The inner motion.div sits inside the button at the
  // visible 100Ã—140 face position, so its bbox matches what the
  // user actually sees.
  //
  // Empty cardId â†’ omit layoutId (defensive default; see slice 52b).
  const layoutId = card.cardId ? card.cardId : undefined;
  return (
    <div
      className="absolute left-1/2 top-2 transition-transform ease-out origin-bottom"
      style={{
        transform,
        // Slice 57 â€” z-index ladder (audit finding 8): hand-lift caps
        // at 20 so it stays UNDER ActionPanel (z-30), drag preview
        // (z-40 â†’ z-50), modals (z-50), and hover popover portals.
        // Pre-fix this was 100 â€” paints over ActionPanel + GameDialog.
        zIndex: lifted ? 20 : index,
        transitionDuration: `${HAND_HOVER_LIFT_MS * SLOWMO}ms`,
      }}
    >
      <HoverCardDetail card={card}>
        <button
          type="button"
          data-testid="hand-card"
          data-card-id={card.id}
          data-dragging={isDragging || undefined}
          data-lifted={lifted || undefined}
          disabled={!canAct}
          onClick={() => onObjectClick(card.id)}
          onPointerDown={(ev) => canAct && onPointerDown(card.id, ev)}
          onMouseEnter={() => setLifted(true)}
          onMouseLeave={() => setLifted(false)}
          onFocus={() => setLifted(true)}
          onBlur={() => setLifted(false)}
          title={tooltip}
          className={
            'select-none ' +
            (canAct
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default opacity-70') +
            (isDragging ? ' opacity-30' : '')
          }
        >
          <motion.div
            layoutId={layoutId}
            data-layout-id={layoutId}
            transition={{ layout: slow(LAYOUT_GLIDE) }}
          >
            <HandCardFace card={card} />
          </motion.div>
        </button>
      </HoverCardDetail>
    </div>
  );
}

/**
 * Card-shaped tile (5:7 aspect) for the hand fan. Layered:
 *   - Scryfall art via `normal` version covering the upper body
 *   - Mana cost overlay top-right
 *   - Name banner across the bottom (over the art's bottom edge)
 *   - P/T overlay bottom-right for creatures, loyalty for walkers
 *
 * Falls back to a name-only card silhouette when Scryfall has no
 * matching print (token, ad-hoc emblem, etc.) â€” same defensive
 * pattern as the slice-43 thumbnail.
 */
function HandCardFace({ card }: { card: WebCardView }) {
  return <CardFace card={card} size="hand" />;
}
