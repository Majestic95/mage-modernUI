import { useMemo } from 'react';
import type { WebGameView } from '../api/schemas';
import type { InteractionMode } from './interactionMode';
import type { ManaOrbColor } from './ManaOrb';
import { StackZone } from './StackZone';
import { PlayerArea } from './PlayerArea';
import { TabletopCommanderSlot } from './TabletopCommanderSlot';
import { gridAreaForOpponent, selectOpponents } from './battlefieldLayout';
import { computePodCardSizeVars } from './podShrink';
import type { DragState } from './useDragState';
import { LAYOUT_BOUNDS, REDESIGN } from '../featureFlags';
import { useLayoutVariant } from '../layoutVariants';
import { AsymmetricTLayout } from './asymmetricT';

// LEGACY-BRANCH-FORK — slice 70-X.13 (Wave 4) cleanup marker.
// Battlefield forks on REDESIGN inline (slotPart split at ~289,
// frame/rows mount at ~321). When VITE_FEATURE_REDESIGN flips
// default-on, follow the same mechanical-cleanup procedure as
// GameTable.tsx (grep "REDESIGN" → unwrap each fork).
export function Battlefield({
  gv,
  mode,
  canAct,
  onObjectClick,
  onSpendMana,
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
  /**
   * 2026-05-03 — passes the local mana-pool spend callback down to
   * AsymmetricTLayout so the floating local mana pool by the local
   * portrait can dispatch click-to-spend during gamePlayMana /
   * gamePlayXMana dialogs. {@code null} when no stream is connected
   * (orbs render as non-interactive display elements).
   */
  onSpendMana: ((color: ManaOrbColor) => void) | null;
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

  // Slice B-1.5 — layout-variant routing. tabletop overrides
  // LAYOUT_BOUNDS=true to use the 4-pod grid (cross/plus); current
  // keeps asymmetric-T.
  const variant = useLayoutVariant();

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
    // Slice 70-Z polish round 18 (user direction 2026-04-30) — no
    // scrolling on the battlefield viewport in either dimension.
    // Was `overflow-y-auto` (slice-57 safety valve for small-laptop
    // intrinsic-height overflow); the local PlayerFrame's corner
    // mount + the floating hand fan + larger card sizes pushed
    // content past viewport bounds and the scrollbar appeared. The
    // user wants a static viewport — content beyond bounds is
    // clipped rather than scrolled.
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* 2026-05-03 asymmetric-T branch — when LAYOUT_BOUNDS=true the
          battlefield switches to the "asymmetric T" layout per the
          industry-research recommendation: top 55% holds 3 stacked
          opponent lanes, bottom 45% holds the local pod with full
          width and sub-rows. The 4-pod grid below is the legacy
          path retained for instant flag revert.
          Slice B-1.5 — variant=tabletop overrides this branch and
          uses the legacy 4-pod grid (cross/plus arrangement) instead.
          Tabletop's spec calls for top + left + right + bottom pods
          around a central focal area, matching the legacy 4-pod grid
          structure. The asymmetric-T layout is reserved for variant=
          'current'; the 4-pod grid serves both `!LAYOUT_BOUNDS` and
          `variant === 'tabletop'`. Renders below the announcer-region
          siblings inserted by GameTable. */}
      {LAYOUT_BOUNDS && variant !== 'tabletop' && (
        <AsymmetricTLayout
          me={me}
          opponents={opponents}
          stack={gv.stack}
          combat={gv.combat}
          mode={mode}
          canAct={canAct}
          onObjectClick={onObjectClick}
          onSpendMana={onSpendMana}
          onBoardDrop={onBoardDrop}
          drag={drag}
          eligibleTargetIds={eligibleTargetIds}
          eligibleCombatIds={eligibleCombatIds}
          combatRoles={combatRoles}
        />
      )}
      {(!LAYOUT_BOUNDS || variant === 'tabletop') && (
      <>
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
        // Slice B-2 (variant=tabletop) — placeholder frame chrome.
        // `data-tabletop-frame` attribute + neutral-dark border ring
        // when variant=tabletop, per element #2 spec ("placeholder
        // only, wooden treatment deferred"). The attribute lets
        // future slices light up the real wood/metal/etc. treatment
        // without re-plumbing the wrapper. variant=current renders
        // the grid without the attribute / extra border.
        data-tabletop-frame={variant === 'tabletop' || undefined}
        // Slice 70-Z polish round 20 (user direction 2026-04-30) —
        // padding-bottom reserves clearance for the fixed-position
        // hand fan. Hand section is `h-[280px]` anchored at
        // `bottom: calc(var(--card-size-large) * -7/5 * 0.25)` (i.e.
        // 25% of card height sits BELOW viewport), so the visible
        // hand-fan strip occupies ~280 − 63 ≈ 217px above viewport
        // bottom. pb-56 (224px) keeps the bottom pod's battlefield
        // rows clear of the hand fan with a hair of breathing room.
        className={
          // Slice B-9-B.3 — pb-56 (224px) reserved space at the
          // bottom of the grid for the floating hand fan, restored
          // for tabletop. B-9-A.6 dropped it to give pods more
          // room, but the hand fan's visible footprint (~217px
          // above viewport bottom) covered most of the bottom pod.
          // pb-56 puts the bottom cell exactly above the hand fan
          // with ~7px clearance. Trade: top/bottom pods are
          // ~253px instead of ~309px, but bottom is fully visible.
          (variant === 'tabletop'
            ? 'flex-1 min-h-0 p-4 pb-56 grid gap-4 border-4 border-zinc-600 rounded-lg'
            : 'flex-1 min-h-0 p-4 pb-56 grid gap-4')
        }
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
          // Slice B-9-A.2 — variant-tabletop load-bearing rule T1
          // ("zones are fixed dimensional anchors; cards inside
          // adapt") REQUIRES deterministic cell sizes. The legacy
          // `minmax(0, max-content)` / `auto` tracks let cells
          // shrink to content — empty pods would collapse to thin
          // strips and full pods would expand, both violating T1.
          // Fixed percentages give each pod cell a deterministic
          // rectangle regardless of content; cards adapt within
          // (shrink → stack → scroll) per element #11.
          gridTemplateColumns:
            variant === 'tabletop'
              ? '20% 60% 20%'
              : 'minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content)',
          // Slice B-9-B.4 (user direction 2026-05-03) — left/right
          // pods (which live in middle row) needed more vertical
          // room. Reverted middle-row to 60% (was 50% in B-9-A.5);
          // top/bottom shrink to 20% each (back to original B-9-A.2
          // values). With smaller-gap (B-9-A.5's gap-2) and pb-56
          // restored (B-9-B.3), top/bottom cells now ~210px which
          // still leaves PlayerFrame + a visible battlefield-area.
          // Side pods grow ~100px taller, matching the user's
          // "extend down to the red line" red-line annotation.
          gridTemplateRows:
            variant === 'tabletop'
              ? '20% 60% 20%'
              : 'auto minmax(0, 1fr) auto',
        }}
      >
        {opponents.map((p, idx) => {
          const area = gridAreaForOpponent(idx, opponents.length);
          // Slice 70-Z polish round 20 (user direction 2026-04-30) —
          // `flex items-center` vertically centers PlayerArea inside
          // a 1fr grid cell (LEFT / RIGHT pods sat at ~30% from top
          // before; the row is tall, the content shorter). For TOP,
          // we keep the original block layout: turning the TOP
          // wrapper into a flex container collapses PlayerArea to
          // its intrinsic width and pins it to the cell's left edge,
          // breaking the horizontal centering that the original
          // grid-stretched block layout provided.
          const isSidePod = area === 'left' || area === 'right';
          // Layout containment (Tier 1) + Tier 2 dynamic card-shrink
          // are now always-on for the legacy 4-pod path (2026-05-03).
          // The LAYOUT_BOUNDS gate now switches at the OUTER fork
          // (legacy vs asymmetric-T) above; flipping
          // VITE_FEATURE_LAYOUT_BOUNDS=false picks the legacy path
          // WITH its Tier 1/2 fixes intact (the previous "good
          // state") rather than reverting all the way back to the
          // unbounded slice-70-Y centered overflow.
          // Slice B-9-B.5 — for tabletop, drop pb-[18vh] (~259px
          // reserved at bottom of side pod wrappers). The hand fan
          // clearance is handled by the grid's pb-56; side pods
          // don't need their own additional bottom reserve. With
          // pb-[18vh] in place, side pods couldn't grow even when
          // middle row% was bumped — the inner pb swallowed the
          // gain. variant=current keeps the existing pb-[18vh].
          const sidePodClasses =
            variant === 'tabletop'
              ? ' flex items-stretch overflow-hidden min-h-0'
              : ' flex items-stretch pb-[18vh] overflow-hidden min-h-0';
          const podCardSizeVars = computePodCardSizeVars(
            Object.keys(p.battlefield).length,
          );
          const wrapperStyle = podCardSizeVars
            ? { gridArea: area, ...podCardSizeVars }
            : { gridArea: area };
          // Slice B-9-B reverted (B-9-B.2) — the dual-PlayerArea
          // (rows + absolute-positioned frame) restructure broke
          // opponent portrait visibility. Reverted to single
          // PlayerArea call, default render path (frame inside
          // cell, eating ~130px of cell height). Accepts the
          // asymmetry between opponent cells and the local cell
          // (which uses the slotPart split with floating frame
          // corner mount). This matches the existing `current`
          // REDESIGN behavior and keeps all portraits visible.
          // Element #9's "portraits outside colored zone" is
          // structurally complex (the overflow-hidden chain on
          // ancestors clips outward-positioned frames) — defer
          // to a future slice that addresses the overflow-hidden
          // chain holistically.
          // Slice B-12-A — commander slot anchor per pod orientation
          // (per element #5). Slot sits absolute-positioned inside
          // the cell at the outside corner. Cell wrapper gets
          // `relative` for tabletop so the absolute child anchors
          // correctly.
          const isTabletop = variant === 'tabletop';
          const commanderSlotAnchorClass = isTabletop
            ? area === 'top'
              ? 'absolute top-2 right-2 z-10'
              : area === 'left'
                ? 'absolute bottom-2 left-2 z-10'
                : area === 'right'
                  ? 'absolute bottom-2 right-2 z-10'
                  : ''
            : '';
          return (
            <div
              key={p.playerId}
              style={wrapperStyle}
              data-side-pod={isSidePod || undefined}
              data-bounded={isSidePod ? 'true' : undefined}
              data-shrunk={podCardSizeVars ? 'true' : undefined}
              className={
                'min-w-0' +
                (isSidePod ? sidePodClasses : '') +
                (isTabletop ? ' relative' : '')
              }
            >
              {isTabletop && (
                <div className={commanderSlotAnchorClass}>
                  <TabletopCommanderSlot player={p} />
                </div>
              )}
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
                eligibleTargetIds={eligibleTargetIds}
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
            below the opponents row (the prior slice-27 placement).

            Slice 70-Z polish round 19 + 21 (user directive 2026-04-30)
            — round 19 added translateY(-8vh) to lift the bumped
            255px focal toward viewport center. Round 21 halved focal
            255→128 AND reverted battlefield cards to the original
            72/80, shrinking the bottom-pod footprint. With both
            changes, the grid's center-row midpoint already lands at
            the visual center of the battlefield, so the upward
            translate now over-corrects (focal favored the top half).
            Reverted to no translate — the grid's natural center
            placement is correct again. */}
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

        {/* Self pod — bottom-center of the 4-pod arrangement.
            Slice 70-Z polish round 17 (user direction 2026-04-30) —
            REDESIGN splits the local pod across two slots:
            battlefield ROWS render in this bottom-center cell
            (slotPart='rows'), while the PlayerFrame mounts as a
            fixed-positioned sibling at the battlefield's bottom-
            right corner (slotPart='frame', see below). Legacy keeps
            the unified pod here. */}
        <div
          style={{ gridArea: 'bottom' }}
          className={
            'min-w-0' + (variant === 'tabletop' ? ' relative' : '')
          }
        >
          {variant === 'tabletop' && me && (
            <div className="absolute bottom-2 right-2 z-10">
              <TabletopCommanderSlot player={me} />
            </div>
          )}
          {me ? (
            <PlayerArea
              player={me}
              perspective="self"
              position="bottom"
              // Slice B-9-B.6 — for tabletop, drop the slotPart split
              // so the bottom pod renders with frame inside cell
              // (matching opponents). Top + bottom colored zones
              // become structurally symmetric. variant=current keeps
              // the slotPart='rows' split + floating corner frame.
              {...(REDESIGN && variant !== 'tabletop'
                ? { slotPart: 'rows' as const }
                : {})}
              canAct={canAct}
              onObjectClick={onObjectClick}
              targetable={eligibleTargetIds.has(me.playerId)}
              eligibleTargetIds={eligibleTargetIds}
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

      {/* Slice 70-Z polish round 17 + 19 — local PlayerFrame
          mounted at fixed bottom-right of the Battlefield region
          (anchors to the battlefield's relative-positioned root).
          The PlayerFrameInfoCluster (Lib/Hand/Grave/Exile chips)
          mounts at `top-full` of the PlayerFrame and extends
          BELOW the frame's content box. Round 19 (user direction
          2026-04-30) raised the corner mount from bottom-2 (8px)
          to bottom-12 (48px) so the overflowing cluster fits
          above the battlefield bottom edge with safe clearance,
          and shifted left from right-2 to right-6 (8 → 24px) so
          the portrait isn't pinned tight against the side-panel
          boundary. z-index keeps it ABOVE any battlefield content
          but BELOW floating overlays like GameDialog.
          REDESIGN-only mount; legacy renders the unified pod above. */}
      {REDESIGN && me && variant !== 'tabletop' && (
        <div
          data-testid="local-player-frame-corner"
          // Round 20 (user direction 2026-04-30) — bumped right
          // 24 → 40px so the Exile chip + count have breathing
          // room from the side-panel boundary.
          //
          // 2026-05-03 z-index raise (z-20 → z-40): the hand region
          // mounted by GameTable is `fixed ... z-30` with an inner
          // pointer-events-auto wrapper that covers the entire ~280px
          // bottom strip including this corner's footprint. At z-20
          // the hand wrapper intercepted every click meant for the
          // graveyard / exile chips here — the chip rendered as a
          // button but never received its click. z-40 puts the
          // corner above the hand wrapper for hit-testing without
          // visually changing anything (the corner is small, the
          // hand has no card art directly under it).
          className="absolute bottom-12 right-10 z-40 pointer-events-auto"
        >
          <PlayerArea
            player={me}
            perspective="self"
            position="bottom"
            slotPart="frame"
            canAct={canAct}
            onObjectClick={onObjectClick}
            targetable={eligibleTargetIds.has(me.playerId)}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
            isDropTarget={false}
            onBoardDrop={onBoardDrop}
            tabIndex={9}
          />
        </div>
      )}

      {/* Slice 70-F — MyHand extracted to its own GameTable grid
          region (region 4 per spec §4). Battlefield no longer
          renders the hand inline; the bottom-region of the
          GameTable shell mounts MyHand as a sibling of Battlefield,
          consuming drag state from the same useDragState hook
          via GameTable. */}
      </>
      )}
    </div>
  );
}

/* AsymmetricTLayout + OpponentLane + LocalPod live in
 * `./asymmetricT.tsx` — extracted out of this file 2026-05-03 to
 * keep Battlefield.tsx focused on the legacy 4-pod path + the
 * outer LAYOUT_BOUNDS fork. */
