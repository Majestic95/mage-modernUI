import type { CSSProperties } from 'react';
import { bucketBattlefield, rowOrder } from './battlefieldRows';
import type { WebPlayerView } from '../api/schemas';
import { CommandZone } from './CommandZone';
import { PlayerFrame } from './PlayerFrame';
import { BattlefieldRowGroup } from './BattlefieldRowGroup';
import { REDESIGN } from '../featureFlags';
import { useLayoutVariant } from '../layoutVariants';
import { computeTabletopZoneBackground } from './halo';
import { useGameStore } from './store';

/** Stable empty Set so the optional prop default doesn't recreate
 *  on every render (would defeat downstream useMemo). */
const EMPTY_ID_SET: Set<string> = new Set();

/**
 * Slice 70-K — pod position within the 4-pod grid. Drives both the
 * REDESIGN-mode flex direction (vertical for top/bottom, horizontal
 * for left/right) and the portrait sizing inside PlayerFrame.
 *
 * <p>Defaults to {@code 'bottom'} when the caller omits the prop —
 * preserves legacy behavior for existing tests that don't pass
 * the new prop.
 */
export type PlayerAreaPosition = 'top' | 'left' | 'right' | 'bottom';

export function PlayerArea({
  player,
  perspective,
  position = 'bottom',
  canAct,
  onObjectClick,
  targetable,
  eligibleTargetIds = EMPTY_ID_SET,
  eligibleCombatIds,
  combatRoles,
  isDropTarget,
  onBoardDrop,
  tabIndex,
  slotPart,
}: {
  player: WebPlayerView;
  perspective: 'self' | 'opponent';
  /**
   * Slice 70-K — pod position in the 4-pod grid. Battlefield passes
   * the result of {@link gridAreaForOpponent} for opponents and
   * {@code 'bottom'} for the local player. Used by the REDESIGN
   * branch to choose flex-row vs flex-col layout. Defaults to
   * {@code 'bottom'} so legacy tests don't need to be updated.
   */
  position?: PlayerAreaPosition;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  /**
   * True when a target dialog is pending and the player is a legal
   * target. Click-on-name then dispatches the player's UUID as the
   * target response. Slice 15.
   */
  targetable: boolean;
  /**
   * Slice 70-Z bug fix — full set of UUIDs the engine considers
   * legal targets for the active gameTarget dialog. Includes
   * battlefield permanents (own AND opponent), players, and any
   * other targetable object UUIDs the engine pre-filters into
   * {@code possibleTargets}. Forwarded into BattlefieldRowGroup so
   * each tile can pulse via CardFace's {@code targetableForDialog}
   * when its id is in this set. Empty in any non-target mode.
   * Defaults to an empty set so legacy tests don't need to thread
   * it explicitly.
   */
  eligibleTargetIds?: Set<string>;
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
  /**
   * Slice 69b (ADR 0010 v2 D13) â€” explicit tab order for keyboard
   * navigation. Battlefield assigns clockwise indices to opponents so
   * a 4p FFA target picker traverses you â†’ opp-right â†’ opp-top â†’
   * opp-left. Optional â€” undefined falls back to natural DOM order.
   */
  tabIndex?: number;
  /**
   * Slice 70-Z polish round 17 — splits the local pod across two
   * separate grid slots: battlefield rows in the bottom-center
   * (where they've always been), and the PlayerFrame in a fixed-
   * positioned corner mount at bottom-right of the battlefield.
   * {@code 'rows'} renders only the battlefield rows; {@code
   * 'frame'} renders only the PlayerFrame; undefined renders both
   * (legacy / opponent default). Drop-target affordance applies
   * only to the rows mount.
   */
  slotPart?: 'rows' | 'frame';
}) {
  const battlefield = Object.values(player.battlefield);
  // Slice 53 â€” group permanents into MTGA-style rows (creatures /
  // other / lands), mirrored for the opponent so lands sit closest
  // to each player's hand. Empty rows render nothing so a turn-1
  // board with one Forest shows just the lands row.
  const rows = bucketBattlefield(battlefield);

  // Slice B-1.5 (variant=tabletop) — per-pod commander-identity zone
  // background. Mirrors the OpponentLane/LocalPod consumer pattern
  // from slice B-1; current rendering is unchanged because the style
  // is undefined for variant !== 'tabletop'. Color-identity resolution
  // mirrors PlayerPortrait's pattern (slice 70-J): prefer the live
  // colorIdentity from the wire; fall back to gameStore snapshot when
  // the live value is empty.
  const variant = useLayoutVariant();
  const colorIdentitySnapshot = useGameStore(
    (s) => s.colorIdentitySnapshots?.[player.playerId],
  );
  const resolvedColorIdentity =
    player.colorIdentity && player.colorIdentity.length > 0
      ? player.colorIdentity
      : (colorIdentitySnapshot ?? player.colorIdentity ?? []);
  const tabletopZoneStyle: CSSProperties | undefined =
    variant === 'tabletop'
      ? {
          background: computeTabletopZoneBackground(
            resolvedColorIdentity,
            player.hasLeft,
          ),
        }
      : undefined;
  const orderedRows = rowOrder(perspective);
  // Slice 70-Z.1 critic Tech IMP-1 — `rowOrder` was narrowed to the
  // two MAIN rows (creatures + lands) for the redesigned per-pod
  // composition; the legacy branch needs the full 3-row stack with
  // artifacts in the middle (matches pre-70-Z.1 layout exactly so
  // production users on REDESIGN=false don't lose visibility of
  // artifacts/enchantments/battles when this slice ships).
  const legacyOrderedRows: readonly ('creatures' | 'artifacts' | 'lands')[] =
    perspective === 'self'
      ? (['creatures', 'artifacts', 'lands'] as const)
      : (['lands', 'artifacts', 'creatures'] as const);

  // Slice 69b (ADR 0010 v2 D5) â€” active / priority glow rings.
  // Stack additively: a player who is both active AND has priority
  // (the typical 1v1 case during their own turn) shows both glows
  // composed via box-shadow. Tokens route through tokens.css so
  // Phase 7 light theme can override. Drop-target dashed ring is
  // mutually exclusive with status glows â€” a hand-drag in progress
  // is a UI mode, not a status, and the dashed border makes the
  // destination unambiguous at FFA densities.
  // Slice 70-A (ADR 0011 D4) â€” renamed from --active-glow /
  // --priority-glow to the --color-* namespace. Values unchanged.
  const statusBoxShadow = isDropTarget
    ? undefined
    : [
        player.isActive ? '0 0 0 2px var(--color-team-active-glow)' : null,
        player.hasPriority ? '0 0 1.25rem var(--color-team-priority-glow)' : null,
      ]
        .filter(Boolean)
        .join(', ') || undefined;

  // Slice 70-D — aria-label synthesis moved to PlayerFrame (which
  // owns the persona signals). The outer container drops its
  // explicit label; SR users now traverse PlayerFrame's group label
  // → battlefield contents (self-describing via permanent chips).

  // Slice 70-K — battlefield rows, factored out for shared use across
  // both the legacy strip layout and the redesigned position-aware
  // layout below. Rendering logic is unchanged from slice 53 + slice
  // 52c — the layoutId machinery for cross-zone glide animations is
  // preserved verbatim regardless of which surrounding layout the
  // rows mount into.
  //
  // Slice 70-K.1 critic IMPORTANT-1 — perspective is now threaded
  // to BattlefieldRowGroup so opponent pods get the smaller
  // --card-size-small (72/100) slot vs local's --card-size-medium
  // (80/112). Picture-catalog §2.A/B/C/D contract.
  const battlefieldRows = (
    <div className="flex flex-col gap-1.5">
      {battlefield.length === 0 ? (
        <span className="text-xs text-zinc-600 italic">
          No permanents yet.
        </span>
      ) : (
        legacyOrderedRows.map((row) => {
          const items = rows[row];
          if (items.length === 0) return null;
          return (
            <BattlefieldRowGroup
              key={row}
              row={row}
              permanents={items}
              perspective={perspective}
              canAct={canAct}
              onObjectClick={onObjectClick}
              eligibleTargetIds={eligibleTargetIds}
              eligibleCombatIds={eligibleCombatIds}
              combatRoles={combatRoles}
            />
          );
        })
      )}
    </div>
  );

  // Slice 70-K — REDESIGN branch. Per picture-catalog §2.1 +
  // §2.A/§2.D, JSX order varies by position:
  //
  //   - top opponent (§2.A): portrait near TOP edge of pod region
  //     (closer to screen top), rows in DOM AFTER portrait so
  //     they paint visually below the portrait toward the focal
  //     zone. From the top opponent's POV this reads as "rows
  //     above the portrait" (their cards approach the center).
  //     DOM: [PlayerFrame, battlefieldRows]
  //
  //   - bottom local (§2.D): rows ABOVE the portrait (DOM order
  //     [battlefieldRows, PlayerFrame]) so portrait sits at the
  //     bottom of the pod region (just above the hand fan) and
  //     rows expand upward toward the central focal zone — the
  //     standard MTG self-row layout.
  //
  //   - left opponent (§2.B): portrait pinned to left edge, rows
  //     to the right (flex-row, DOM [PlayerFrame, battlefieldRows]).
  //
  //   - right opponent (§2.C): mirror of left (flex-row-reverse so
  //     visual is rows-on-left + frame-on-right while DOM stays
  //     [PlayerFrame, battlefieldRows]).
  //
  // Slice 70-K shipped with [PlayerFrame, battlefieldRows] for ALL
  // positions; that matched §2.A but VIOLATED §2.D (bottom pod
  // had portrait above rows). Slice 70-K.1 critic IMPORTANT-3
  // caught it — fixed below by branching the bottom case.
  //
  // Pod chrome dropped per picture-catalog §6.3 — pods float on the
  // battlefield without a panel container. CommandZone strip
  // dropped because the commander identity is shown via portrait.
  // LEGACY-BRANCH-FORK — slice 70-X.13 (Wave 4) cleanup marker. When
  // VITE_FEATURE_REDESIGN flips default-on, search the repo for
  // "LEGACY-BRANCH-FORK" / "LEGACY-BRANCH-END" pairs and:
  //   1. delete the `if (!REDESIGN) return ...` legacy block at the
  //      bottom of this function (look for LEGACY-BRANCH-END);
  //   2. unwrap this `if (REDESIGN) { ... }` shell so the redesign
  //      tree becomes the unconditional return;
  //   3. remove the `import { REDESIGN } from '../featureFlags'` if
  //      no longer used.
  // Mechanical, no behavior change. Defer the physical-file split
  // (`PlayerArea.redesign.tsx` etc.) until the flag actually flips —
  // doing it now means maintaining two physical files in lockstep
  // that will be reunified anyway.
  if (REDESIGN) {
    const isVertical = position === 'top' || position === 'bottom';
    // Slice 70-Z polish round 20 (user direction 2026-04-30) — the
    // TOP opponent pod renders DOM order [PlayerFrame,
    // battlefieldAreaRedesign]. PlayerFrameInfoCluster (the
    // Lib/Hand/Grave/Exile chip strip) is `absolute top-full` of the
    // PlayerFrame and dangles ~24px below the frame's content box.
    // gap-3 (12px) wasn't enough to clear the cluster, so the top
    // pod's lands row visibly overlapped with the chip strip text.
    // Bumped to gap-10 (40px) so the cluster fits cleanly between
    // PlayerFrame and the lands row. Bottom pod is unaffected — it
    // uses slotPart='rows'/'frame' splitting in Battlefield.tsx, so
    // this flexClass only fires for the no-slotPart fallback.
    // Side-pod gap (2026-05-03): bumped from gap-3 (12px) to gap-8
    // (32px) so battlefield rows can't visually crowd or overlap the
    // commander portrait. The portrait halo + life badge already
    // extend past the strict frame bounding box; the prior 12px gap
    // wasn't enough to clear them at busy boards.
    const flexClass = isVertical
      ? position === 'top'
        ? 'flex flex-col gap-10'
        : 'flex flex-col gap-3'
      : position === 'right'
        ? 'flex flex-row-reverse gap-8'
        : 'flex flex-row gap-8';
    // Drop-target ring stays as the only visible chrome on the pod
    // wrapper — it's a transient interaction state, not background
    // chrome, so it doesn't violate the "pods float" principle.
    const playerFrame = (
      <PlayerFrame
        player={player}
        perspective={perspective}
        position={position}
        onPlayerClick={onObjectClick}
        targetable={targetable}
        eligibleTargetIds={eligibleTargetIds}
        canAct={canAct}
        onObjectClick={onObjectClick}
      />
    );

    // Slice 70-Z.1 (user direction 2026-04-30) — REDESIGN
    // battlefield-area composition. The legacy `battlefieldRows`
    // built above is a flat top-to-bottom stack of all three rows
    // (creatures + artifacts + lands). REDESIGN splits it into TWO
    // regions per picture-catalog §2.1.0:
    //   - MAIN ROWS: creatures + lands ONLY (artifacts handled
    //     separately). Cards lay LEFT→RIGHT (horizontal) for
    //     top/bottom pods, TOP→BOTTOM (vertical) for left/right
    //     pods. Order per `rowOrder(perspective)`: creatures
    //     always sit closest to the focal zone; lands always sit
    //     closest to the player's screen edge.
    //   - ARTIFACT BOX: small fixed-size side region containing
    //     artifacts/enchantments/battles/unknown. Renders ONLY
    //     when non-empty (no placeholder per user direction).
    //     Position: vertical column to the side for top/bottom
    //     pods, horizontal strip at the bottom for left/right pods.
    // Cards inside each region shrink uniformly when count grows
    // (BattlefieldRowGroup contract); zone dimensions never
    // change.
    // Per-row card orientation is unchanged: top/bottom pods lay
    // cards left→right inside each row; side pods stack cards
    // top→bottom inside each row. The 2026-05-03 fix is at the
    // ROW-OF-ROWS level, not within a row.
    const rowsOrientation: 'horizontal' | 'vertical' = isVertical
      ? 'horizontal'
      : 'vertical';
    const artifactsOrientation: 'horizontal' | 'vertical' = isVertical
      ? 'vertical'
      : 'vertical';

    // Layout 2026-05-03 (user direction "All zones should be stacking
    // vertically instead of horizontally for left and right player
    // zones"). Side pods previously placed the creatures row and the
    // lands row as TWO SIDE-BY-SIDE COLUMNS (flex-row), spreading
    // permanents across the pod's horizontal axis. They now stack
    // vertically (flex-col) so the side pod is one tall narrow
    // region with cards going strictly DOWN. row-reverse is no
    // longer meaningful for side pods (single column has no
    // left/right orientation).
    const mainRowsClass = isVertical
      ? 'flex flex-col gap-1.5 flex-1 min-w-0 min-h-0'
      : 'flex flex-col gap-2 flex-1 min-w-0 min-h-0';
    // Slice 70-Z.1 critic Tech IMP-2 — when both main buckets are
    // empty (e.g. an artifacts-only opening hand: turn-1 Mox), skip
    // the wrapper entirely so the artifact box doesn't sit next to
    // an invisible flex-1 div consuming the remaining axis space.
    const mainRowsEmpty =
      rows.creatures.length === 0 && rows.lands.length === 0;
    const mainRowsRedesign = mainRowsEmpty ? null : (
      <div className={mainRowsClass} data-testid="battlefield-main-rows">
        {orderedRows.map((row) => {
          const items = rows[row];
          if (items.length === 0) return null;
          return (
            <BattlefieldRowGroup
              key={row}
              row={row}
              permanents={items}
              perspective={perspective}
              orientation={rowsOrientation}
              canAct={canAct}
              onObjectClick={onObjectClick}
              eligibleTargetIds={eligibleTargetIds}
              eligibleCombatIds={eligibleCombatIds}
              combatRoles={combatRoles}
            />
          );
        })}
      </div>
    );

    // Artifact box — only rendered when non-empty (catalog §2.1
    // "If artifact box is empty, render nothing"). Fixed dimension
    // along the perpendicular axis to the main rows: narrow column
    // (~100px wide) for top/bottom pods, short row (~100px tall)
    // for left/right pods. The 100px estimate matches a single
    // opponent-card slot (small variant) — final size pending live
    // playtest review per user direction "I can confirm once we see
    // it live whether we need to change it."
    // Slice 70-Z.1 critic UI IMP-6 — artifact box must remain a
    // STATIC rectangle per catalog §2.1.0. The wrapper stretches to
    // the parent's cross-axis (h-full for vertical column, w-full
    // for horizontal strip) so the inner BattlefieldRowGroup's own
    // h-full / shrink-uniform logic resolves against a definite
    // dimension instead of collapsing to its content height/width.
    //
    // Slice 70-X.9 (user feedback 2026-04-30) — artifact-box width
    // now matches BattlefieldRowGroup's uniform tileSize so the
    // box hosts cards at the SAME size as the main rows. Previous
    // perspective-branched sizing made opponent artifact boxes
    // narrower than self, contributing to the "right pod cards
    // are smaller than mine" complaint.
    const artifactBoxAcrossAxis = 'calc(var(--card-size-medium) * 7 / 5)';
    // Layout 2026-05-03 — for side pods (left/right), the artifact
    // box is now another vertical-orientation row in the same single
    // column as creatures + lands. Drop the fixed cross-axis height
    // and let the cards' intrinsic stacked height flow within the
    // parent flex-col. Top/bottom pods keep the fixed-width column
    // sidecar (catalog §2.1.0).
    const artifactsBoxRedesign =
      rows.artifacts.length > 0 ? (
        <div
          data-testid="artifact-zone"
          className={
            isVertical
              ? 'flex-shrink-0 h-full min-h-0'
              : 'flex-shrink-0 w-full min-w-0'
          }
          style={
            isVertical
              ? { width: artifactBoxAcrossAxis }
              : undefined
          }
        >
          <BattlefieldRowGroup
            row="artifacts"
            permanents={rows.artifacts}
            perspective={perspective}
            orientation={artifactsOrientation}
            canAct={canAct}
            onObjectClick={onObjectClick}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
        </div>
      ) : null;

    // Battlefield area = main rows + artifact box composed per pod.
    // - Top/Bottom (vertical pod): horizontal split (main left,
    //   artifacts right).
    // - Left/Right (horizontal pod): vertical split (main top,
    //   artifacts bottom).
    const battlefieldAreaClass = isVertical
      ? 'flex flex-row gap-2 min-w-0 min-h-0'
      : 'flex flex-col gap-2 min-w-0 min-h-0 h-full';
    // Empty-board fallback: when EVERY bucket is empty, show the
    // "No permanents yet." placeholder (preserves the legacy UX).
    const allEmpty = battlefield.length === 0;
    const battlefieldAreaRedesign = allEmpty ? (
      <div className="flex flex-col gap-1.5">
        {/* Slice 70-Z.1 critic UI IMP-5 — caption color via the
            --color-text-secondary token (#9BA8B0) instead of the
            hardcoded text-zinc-600 (#52525B) which read as too dark
            against the canvas. */}
        <span
          className="text-xs italic"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          No permanents yet.
        </span>
      </div>
    ) : (
      <div
        data-testid="battlefield-area"
        className={battlefieldAreaClass}
      >
        {mainRowsRedesign}
        {artifactsBoxRedesign}
      </div>
    );
    // Slice 70-Z polish round 17 — slotPart-driven rendering.
    // - 'rows':  only battlefield rows (drop target stays here).
    // - 'frame': only PlayerFrame (no rows, no drop target).
    // - undefined: both, legacy/opponent layout (default).
    if (slotPart === 'frame') {
      return (
        <div
          data-testid={`player-area-${perspective}-frame`}
          data-position={position}
          data-player-id={player.playerId}
          data-active={player.isActive || undefined}
          data-priority={player.hasPriority || undefined}
        >
          {playerFrame}
        </div>
      );
    }
    if (slotPart === 'rows') {
      return (
        <div
          data-testid={`player-area-${perspective}-rows`}
          data-position={position}
          data-player-id={player.playerId}
          data-droppable="board"
          data-drop-target={isDropTarget || undefined}
          data-active={player.isActive || undefined}
          data-priority={player.hasPriority || undefined}
          data-tabletop-zone={variant === 'tabletop' || undefined}
          tabIndex={player.hasLeft ? undefined : tabIndex}
          onPointerUp={onBoardDrop}
          className={
            'transition-colors ' +
            (isDropTarget
              ? 'rounded ring-2 ring-fuchsia-500/40 outline outline-dashed outline-fuchsia-500'
              : '')
          }
          style={tabletopZoneStyle}
        >
          {battlefieldAreaRedesign}
        </div>
      );
    }
    return (
      <div
        data-testid={`player-area-${perspective}`}
        data-position={position}
        // Slice 70-N — exposes the player's UUID so the StackZone
        // combat-mode arrow renderer can target the defending
        // player's pod (defender of attacker → defender arrows
        // when the attacker isn't blocked). REDESIGN-branch only;
        // legacy markup below leaves it off intentionally.
        data-player-id={player.playerId}
        data-droppable="board"
        data-drop-target={isDropTarget || undefined}
        data-active={player.isActive || undefined}
        data-priority={player.hasPriority || undefined}
        data-tabletop-zone={variant === 'tabletop' || undefined}
        tabIndex={player.hasLeft ? undefined : tabIndex}
        onPointerUp={onBoardDrop}
        style={tabletopZoneStyle}
        className={
          flexClass +
          ' transition-colors ' +
          (isDropTarget
            ? 'rounded ring-2 ring-fuchsia-500/40 outline outline-dashed outline-fuchsia-500'
            : '')
        }
      >
        {position === 'bottom' ? (
          <>
            {battlefieldAreaRedesign}
            {playerFrame}
          </>
        ) : (
          <>
            {playerFrame}
            {battlefieldAreaRedesign}
          </>
        )}
      </div>
    );
  }

  // LEGACY-BRANCH-END — slice 70-X.13 (Wave 4). Delete from here to
  // the closing `}` of the function when REDESIGN flips default-on.
  // Legacy branch — unchanged from slice 70-H.5.
  return (
    <div
      data-testid={`player-area-${perspective}`}
      data-droppable="board"
      data-drop-target={isDropTarget || undefined}
      data-active={player.isActive || undefined}
      data-priority={player.hasPriority || undefined}
      // Slice 70-E critic UX-2 — eliminated seats drop their explicit
      // tabIndex so they're not dead keyboard stops. The
      // targetable-name button is suppressed inside PlayerFrame
      // (eliminated players aren't legal targets); landing focus on
      // an unactionable div with only an "alice, eliminated"
      // aria-label wastes a tab stop. SR users still reach the seat
      // via linear traversal — only keyboard tab order skips it.
      tabIndex={player.hasLeft ? undefined : tabIndex}
      // Slice 70-D critic UX-C1 — no role="region" without an
      // aria-label (ARIA spec: an unlabeled region is dropped from
      // the landmark list). The inner PlayerFrame's labeled
      // role="group" is the sole nameable container; the outer is
      // now a plain div so SR users hit one labeled landmark per
      // seat instead of two awkwardly nested ones.
      onPointerUp={onBoardDrop}
      style={statusBoxShadow ? { boxShadow: statusBoxShadow } : undefined}
      className={
        'rounded border bg-zinc-900/40 p-3 transition-colors ' +
        (isDropTarget
          ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/40 border-dashed'
          : 'border-zinc-800')
      }
    >
      <PlayerFrame
        player={player}
        perspective={perspective}
        onPlayerClick={onObjectClick}
        targetable={targetable}
        eligibleTargetIds={eligibleTargetIds}
        canAct={canAct}
        onObjectClick={onObjectClick}
      />
      {battlefieldRows}
      <CommandZone entries={player.commandList} />
    </div>
  );
}
