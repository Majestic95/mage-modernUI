import { useMemo } from 'react';
import type { WebGameView } from '../api/schemas';
import type { InteractionMode } from './interactionMode';
import { StackZone } from './StackZone';
import { PlayerArea } from './PlayerArea';
import { gridAreaForOpponent, selectOpponents } from './battlefieldLayout';
import type { DragState } from './useDragState';

export function Battlefield({
  gv,
  mode,
  canAct,
  onObjectClick,
  drag,
}: {
  gv: WebGameView;
  /**
   * Slice 70-F — interaction state lifted to GameTable so MyHand
   * (now in its own grid region, sibling of Battlefield) and the
   * battlefield's PlayerAreas share one source of truth. Battlefield
   * is now a render-mostly consumer; the only derivations it still
   * owns are gv-shape data (me, opponents, eligibleTargetIds,
   * combatRoles).
   */
  mode: InteractionMode;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  drag: DragState | null;
}) {
  const me = useMemo(
    () => gv.players.find((p) => p.playerId === gv.myPlayerId) ?? null,
    [gv.players, gv.myPlayerId],
  );
  const opponents = useMemo(
    () => selectOpponents(gv.players, gv.myPlayerId),
    [gv.players, gv.myPlayerId],
  );

  // Drop dispatch — drag-in-progress on a PlayerArea pointerup is
  // routed as an object click so the engine treats it identically
  // to a click on the destination board. Lives here (not in
  // GameTable) because it consumes onObjectClick which is itself
  // a callback to GameTable's click-router output.
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

  // Slice 70-F — floating drag preview moved to GameTable. With the
  // hand region now a sibling of the battlefield region, the
  // preview belongs at the shell level so it can float over either
  // region as the cursor crosses between them. Battlefield no
  // longer owns a `draggedCard` lookup or the preview JSX.

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
      {/* SR announcers + drag preview moved to GameTable.tsx
          (slice 70-E critic N4 + slice 70-F MyHand region extract). */}
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
                // Slice 70-K — pod position drives the redesigned
                // PlayerArea's flex direction (vertical for top,
                // horizontal for left/right). gridAreaForOpponent
                // returns 'top' | 'left' | 'right'; PlayerAreaPosition
                // accepts those plus 'bottom' (used by the self pod
                // below).
                position={area}
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
          {/* Slice 70-N — combat threaded through so the REDESIGN
              focal-zone renderer can switch to combat-arrow mode
              when stack is empty AND combat is in progress
              (catalog §3.2). gv.combat is already memoized into
              combatRoles above; pass the raw groups here so
              StackZone can map attackers → defenders / blockers
              by ID. Legacy branch ignores the prop. */}
          <StackZone stack={gv.stack} combat={gv.combat} />
        </div>

        {/* Self pod — bottom of the 4-pod arrangement. */}
        <div style={{ gridArea: 'bottom' }} className="min-w-0">
          {me ? (
            <PlayerArea
              player={me}
              perspective="self"
              position="bottom"
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

      {/* Slice 70-F — MyHand extracted to its own GameTable grid
          region (region 4 per spec §4). Battlefield no longer
          renders the hand inline; the bottom-region of the
          GameTable shell mounts MyHand as a sibling of Battlefield,
          consuming drag state from the same useDragState hook
          via GameTable. */}
    </div>
  );
}
