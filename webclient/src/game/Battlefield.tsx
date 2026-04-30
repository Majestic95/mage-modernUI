import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebCardView, WebGameView } from '../api/schemas';
import { GameStream } from './stream';
import { useGameStore } from './store';
import {
  deriveInteractionMode,
  type InteractionMode,
} from './interactionMode';
import { isBoardClickable, routeObjectClick } from './clickRouter';
import { ManaCost } from './ManaCost';
import { MyHand } from './MyHand';
import { StackZone } from './StackZone';
import { PlayerArea } from './PlayerArea';
import { gridAreaForOpponent, selectOpponents } from './battlefieldLayout';

export function Battlefield({
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
    () => selectOpponents(gv.players, gv.myPlayerId),
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
      {/* Slice 70-E — SR announcers (priority + elimination) moved
          to GameTable root per technical critic N4. The parent now
          mutates only on grid-shape changes (rare), not on every
          permanent ETB / battlefield update. Below was the original
          slice 69b sr-only announcer placement.

          Slice 69b (ADR 0010 v2 D5 + D13 + synthesis miss #2) — screen-
          reader announcer for priority / phase transitions. Lives at
          the Battlefield root so the live region is dedicated, not
          buried inside a section that mutates for unrelated reasons
          (cards entering / leaving the battlefield etc.). The text
          here is the ONLY content of the live region, so a screen
          reader announces exactly the transition â€” "Priority: Alice,
          PRECOMBAT_MAIN" â€” and nothing else. role=status + aria-live
          polite is the standard pattern: queues behind any open dialog
          and doesn't interrupt mid-utterance (vs assertive). The
          sr-only class hides it visually â€” the visual surfaces are
          the PlayerArea glow rings (D5) + the existing PRIORITY /
          ACTIVE pills (D9 redundant-encoding rule). */}
      {/* SR announcers moved to GameTable.tsx (slice 70-E critic N4). */}
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
      {/* Opponents row(s) â€” top. flex-shrink-0 = intrinsic height.
          Slice 69b (ADR 0010 v2 D5): layout adapts to opponent count
          via CSS Grid. 1 opponent = vertical stack (1v1 unchanged); 2
          opponents = 2-col grid (3p FFA / 2HG-opp-row); 3 opponents =
          3-col grid (4p FFA). Asymmetric 12-o'clock / 9 / 3 layout is
          deferred to v3 polish. The text-pill ACTIVE / PRIORITY
          labels stay alongside the new glow rings (D9 redundant-
          encoding rule). Priority announcement for screen readers
          lives in the dedicated sr-only announcer at the Battlefield
          root above â€” NOT here, because cards entering / leaving
          permanents would mutate this section and trigger spurious
          "priority change" announcements. */}
      {/*
        Slice 70-E (ADR 0011 D5) — 4-pod arrangement per design-spec
        §3 / screens-game-table-commander-4p.md §2. Opponents occupy
        TOP / LEFT / RIGHT positions; self stays at BOTTOM; central
        focal zone (Stack) sits in the middle.

        Grid template:
          ".    top    ."
          "left center right"
          ".    bottom ."

        Empty cells render nothing — the column tracks collapse to
        their content (`auto`) so a 1v1 layout (only `top` opponent)
        doesn't show empty side gutters. Each pod owns its own click
        + drop affordances; the grid is a positioning shell only.
      */}
      <div
        data-testid="four-pod-grid"
        className="flex-1 min-h-0 p-4 grid gap-4"
        // Slice 70-E critic UI-Critical-1 — inline style for the
        // grid-template-areas. The Tailwind bracket arbitrary
        // [grid-template-areas:"..."] form splits on whitespace and
        // dropped the rule when area names contained spaces. Inline
        // style sidesteps the Tailwind tokenizer entirely. Also
        // resolves UI-Important-4 (consistent inline-style approach
        // for both outer + inner grids).
        //
        // Critic UI-Important-3 — side columns use minmax(0, max-content)
        // so a long PlayerFrame name (e.g. a verbose username) can't
        // push the central column off-screen at 1280×720. The
        // max-content cap floors at 0 (collapses to 0 if no opponent
        // is at that position) and grows only up to the longest
        // intrinsic content — a hard ceiling vs auto's "as wide as
        // needed."
        style={{
          gridTemplateAreas:
            '". top ." "left center right" ". bottom ."',
          gridTemplateColumns:
            'minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content)',
          gridTemplateRows: 'auto minmax(0, 1fr) auto',
        }}
      >
        {opponents.map((p, idx) => {
          const area = gridAreaForOpponent(idx, opponents.length);
          return (
            <div key={p.playerId} style={{ gridArea: area }} className="min-w-0">
              <PlayerArea
                player={p}
                perspective="opponent"
                canAct={canAct}
                onObjectClick={onObjectClick}
                targetable={eligibleTargetIds.has(p.playerId)}
                eligibleCombatIds={eligibleCombatIds}
                combatRoles={combatRoles}
                isDropTarget={drag != null}
                onBoardDrop={onBoardDrop}
                // Slice 69b (D13) — clockwise tab order preserved.
                tabIndex={10 + idx}
              />
            </div>
          );
        })}
        {opponents.length === 0 && (
          // Critic UI-Nice-8 — center the empty-state message in the
          // top cell rather than letting it hug the top-left corner.
          <p
            style={{ gridArea: 'top' }}
            className="text-zinc-500 italic text-center self-center"
          >
            No opponents in this view.
          </p>
        )}

        {/* Central focal zone — slice 70-E moves StackZone here per
            spec §3. Stack sits between the four pods rather than
            below the opponents row (the prior slice-27 placement). */}
        <div
          style={{ gridArea: 'center' }}
          data-testid="central-focal-zone"
          className="flex items-center justify-center min-h-0"
        >
          <StackZone stack={gv.stack} />
        </div>

        {/* Self pod — bottom of the 4-pod arrangement. */}
        <div style={{ gridArea: 'bottom' }} className="min-w-0">
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
              tabIndex={9}
            />
          ) : (
            <p className="text-zinc-500 italic">
              Spectator view — no controlling player.
            </p>
          )}
        </div>
      </div>

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
