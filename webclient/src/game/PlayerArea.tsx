import { bucketBattlefield, rowOrder } from './battlefieldRows';
import type { WebPlayerView } from '../api/schemas';
import { CommandZone } from './CommandZone';
import { LifeTotal } from './LifeTotal';
import { ManaPool } from './ManaPool';
import { ZoneCounter } from './ZoneBrowser';
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
