import { AnimatePresence } from 'framer-motion';
import { bucketBattlefield, rowOrder } from './battlefieldRows';
import type { WebPlayerView } from '../api/schemas';
import { CommandZone } from './CommandZone';
import { LifeCounter } from './LifeCounter';
import { ManaPool } from './ManaPool';
import { PriorityTag } from './PriorityTag';
import { ZoneIcon } from './ZoneIcon';
import { BattlefieldRowGroup } from './BattlefieldRowGroup';

export function PlayerArea({
  player,
  perspective,
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

  // Slice 69b (ADR 0010 v2 D13) â€” aria-label on the focusable
  // container. With tabIndex set (D13 keyboard-nav contract), screen
  // readers will announce the seat when it gains focus; without an
  // explicit label the announcement is "group" or the entire
  // concatenated text content of the seat (life total, mana, every
  // permanent name) â€” unusable. Synthesizes the seat's persona
  // (name + life + status flags) into one short announcement.
  const ariaLabel = [
    player.name || 'Unknown player',
    `${player.life} life`,
    perspective === 'self' ? 'your seat' : null,
    player.isActive ? 'active turn' : null,
    player.hasPriority ? 'has priority' : null,
    player.hasLeft ? 'eliminated' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      data-testid={`player-area-${perspective}`}
      data-droppable="board"
      data-drop-target={isDropTarget || undefined}
      data-active={player.isActive || undefined}
      data-priority={player.hasPriority || undefined}
      tabIndex={tabIndex}
      role="group"
      aria-label={ariaLabel}
      onPointerUp={onBoardDrop}
      style={statusBoxShadow ? { boxShadow: statusBoxShadow } : undefined}
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
            // Slice 70-C critic UI-#2 — migrated off legacy
            // bg-fuchsia-500/20 text-fuchsia-300 to align visually
            // with the sibling PriorityTag (which uses
            // bg-accent-primary). The ACTIVE pill is a slice-70-C
            // temp affordance — slice 70-D's PlayerFrame will route
            // active-player signaling through the frame halo per
            // design-system §7.3, so this whole pill goes away then.
            <span
              className="text-xs px-1.5 py-0.5 rounded font-medium"
              style={{
                backgroundColor: 'var(--color-team-active-glow)',
                color: 'var(--color-text-on-accent)',
              }}
            >
              ACTIVE
            </span>
          )}
          {/*
            Slice 70-C — extracted into <PriorityTag>. Wrapped in
            AnimatePresence so the fade-in/fade-out (PRIORITY_TAG_FADE)
            runs on enter AND exit. The atom itself owns the motion;
            this parent owns the conditional render.

            Critic Tech-I1 — direct children of AnimatePresence MUST
            carry a stable key for exit animations to fire reliably
            (Framer's documented contract). Without the key the toggle
            from element → false sometimes works but is technically
            undefined behavior.
          */}
          <AnimatePresence>
            {player.hasPriority && <PriorityTag key="priority" />}
          </AnimatePresence>
        </div>
        <div className="flex items-baseline gap-4 text-sm text-zinc-400">
          <LifeCounter value={player.life} />

          <ZoneIcon
            zone="library"
            count={player.libraryCount}
            playerName={player.name}
          />
          <span>
            <span className="text-text-secondary">Hand</span>{' '}
            <span className="font-mono">{player.handCount}</span>
          </span>
          <ZoneIcon
            label="Grave"
            zone="graveyard"
            playerName={player.name}
            cards={player.graveyard}
          />
          <ZoneIcon
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
