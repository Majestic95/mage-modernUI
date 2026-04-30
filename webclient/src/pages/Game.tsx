import { useEffect, useMemo } from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { useAuthStore } from '../auth/store';
import { GameStream } from '../game/stream';
import { useGameStore } from '../game/store';
import { GameEndOverlay } from '../game/GameEndOverlay';
import { CardAnimationLayer } from '../animation/CardAnimationLayer';
import { DeltaPump } from '../animation/DeltaPump';
import { resetAnimationState } from '../animation/animationState';
import { GameHeader } from '../game/GameHeader';
import { GameTable } from '../game/GameTable';
import { Waiting } from '../game/Waiting';

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
      // Slice 70-Z.3 — clear in-flight animation state alongside the
      // store reset so a player who plays two games in one session
      // doesn't see stale cinematic-cast / impact state on the
      // second game's first cast. animationState lives outside the
      // Zustand store (see animation/animationState.ts) and needs
      // its own reset call.
      resetAnimationState();
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
    // Slice 70-E (ADR 0011 D5) — MotionConfig + LayoutGroup STAY at
    // the page root per technical critic C1. GameTable renders
    // beneath them; siblings (GameDialog, GameEndOverlay) that need
    // to participate in the cross-zone layoutId graph remain
    // descendants of the LayoutGroup. Header banner + protocol-error
    // strip stay at this level so they sit ABOVE GameTable's grid
    // shell rather than competing with it for grid space.
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
          <GameHeader
            gameId={gameId}
            connection={connection}
            closeReason={closeReason}
            gameView={gameView}
            onLeave={onLeave}
            stream={stream}
          />
          {protocolError && (
            <div role="alert" className="bg-red-900/40 border-b border-red-800 px-6 py-2 text-sm text-red-200">
              {protocolError}
            </div>
          )}
          <div className="flex-1 min-h-0">
            {gameView ? (
              <GameTable
                gameId={gameId}
                gameView={gameView}
                stream={stream}
              />
            ) : (
              <Waiting connection={connection} />
            )}
          </div>
          <GameEndOverlay gameId={gameId} onLeave={onLeave} />
          {/* Slice 70-Z.2 — card-animation seam. DeltaPump diffs
              successive gameView snapshots and fans typed events
              through the module-singleton eventBus; CardAnimationLayer
              is the (currently empty) overlay portal that future
              slices (70-Z.3 cinematic, 70-Z.4 impact) mount visuals
              into. Both must sit inside the LayoutGroup so any
              motion.div they later spawn participates in the cross-
              zone cardId-layoutId graph. Both render nothing
              visually in slice 70-Z.2 — this is wiring only. */}
          <CardAnimationLayer />
          <DeltaPump />
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
