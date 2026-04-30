import { bucketBattlefield, rowOrder } from './battlefieldRows';
import type { WebPlayerView } from '../api/schemas';
import { CommandZone } from './CommandZone';
import { PlayerFrame } from './PlayerFrame';
import { BattlefieldRowGroup } from './BattlefieldRowGroup';
import { REDESIGN } from '../featureFlags';

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
  eligibleCombatIds,
  combatRoles,
  isDropTarget,
  onBoardDrop,
  tabIndex,
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
}) {
  const battlefield = Object.values(player.battlefield);
  // Slice 53 â€” group permanents into MTGA-style rows (creatures /
  // other / lands), mirrored for the opponent so lands sit closest
  // to each player's hand. Empty rows render nothing so a turn-1
  // board with one Forest shows just the lands row.
  const rows = bucketBattlefield(battlefield);
  const orderedRows = rowOrder(perspective);

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
        orderedRows.map((row) => {
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
  if (REDESIGN) {
    const isVertical = position === 'top' || position === 'bottom';
    const flexClass = isVertical
      ? 'flex flex-col gap-3'
      : position === 'right'
        ? 'flex flex-row-reverse gap-3'
        : 'flex flex-row gap-3';
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
      />
    );
    return (
      <div
        data-testid={`player-area-${perspective}`}
        data-position={position}
        data-droppable="board"
        data-drop-target={isDropTarget || undefined}
        data-active={player.isActive || undefined}
        data-priority={player.hasPriority || undefined}
        tabIndex={player.hasLeft ? undefined : tabIndex}
        onPointerUp={onBoardDrop}
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
            {battlefieldRows}
            {playerFrame}
          </>
        ) : (
          <>
            {playerFrame}
            {battlefieldRows}
          </>
        )}
      </div>
    );
  }

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
      />
      {battlefieldRows}
      <CommandZone entries={player.commandList} />
    </div>
  );
}
