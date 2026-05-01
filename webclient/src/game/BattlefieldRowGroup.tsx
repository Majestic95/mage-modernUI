import { AnimatePresence, motion } from 'framer-motion';
import type { WebPermanentView } from '../api/schemas';
import { slow } from '../animation/debug';
import {
  BATTLEFIELD_ENTER_EXIT,
  UNTAP_STAGGER_DELAY_MS,
} from '../animation/transitions';
import { BattlefieldTile } from './BattlefieldTile';
import type { BattlefieldRow } from './battlefieldRows';

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
export function BattlefieldRowGroup({
  row,
  permanents,
  perspective = 'self',
  orientation = 'horizontal',
  canAct,
  onObjectClick,
  eligibleCombatIds,
  combatRoles,
}: {
  row: BattlefieldRow;
  permanents: WebPermanentView[];
  /**
   * Slice 70-K.1 critic IMPORTANT-1 — drives the per-tile max-size.
   * Per picture-catalog §2.A/B/C/D: opponent pods use
   * --card-size-small (72px card → 100px slot), local pod uses
   * --card-size-medium (80px card → 112px slot). Defaults to 'self'
   * for back-compat with the legacy code path; PlayerArea passes
   * the actual perspective.
   */
  perspective?: 'self' | 'opponent';
  /**
   * Slice 70-Z.1 (user direction 2026-04-30) — row direction.
   * - 'horizontal' (default): cards lay LEFT→RIGHT in a row. Used
   *   by top + bottom pods (catalog §2.A / §2.D). Container has a
   *   FIXED width-constrained main axis; cards shrink uniformly
   *   in WIDTH as count grows.
   * - 'vertical': cards lay TOP→BOTTOM in a column. Used by left
   *   + right opponents (catalog §2.B / §2.C) where the rows sit
   *   beside the portrait in a tall narrow strip. Container has a
   *   FIXED height-constrained main axis; cards shrink uniformly
   *   in HEIGHT.
   * Slot stays square in both modes so tap-rotation (90°) fits.
   */
  orientation?: 'horizontal' | 'vertical';
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  // Slice 70-X.9 (user feedback 2026-04-30) — uniform tile size
  // across every pod. Previously perspective='opponent' used a
  // smaller token than 'self'; this caused opponents' cards to
  // render visibly smaller than the local player's cards even
  // when both pods had identical board states. The user wants
  // ONE size everywhere so the battlefield reads as a single
  // shared surface, not "my cards are bigger than yours."
  //
  // The `perspective` prop is still accepted (other call sites
  // may rely on it for non-sizing concerns), but we no longer
  // branch on it for tileSize.
  //
  // Slot side = card-width × 7/5 (5:7 portrait card aspect, slot
  // is square so a tap-rotated card fits within the same bounds).
  // --card-size-medium = 80px → slot = 112px. Single source of
  // truth for every pod regardless of perspective.
  const tileSize = 'calc(var(--card-size-medium) * 7 / 5)';
  // Slice 70-X.9 — fixed tile size, NOT flex-1-1-0 with shrink.
  // The previous `flex: 1 1 0; min-(w|h): 56px; max-(w|h): tileMaxSize`
  // pattern caused tiles to shrink to fit the container, which made
  // pods with more cards display them smaller than pods with fewer
  // cards. User reported the right opponent's cards were shrunk
  // while the local pod's were full size — uneven across the pod
  // grid. Fix: every tile is exactly tileSize, regardless of count.
  // When a row can't fit all tiles, it overflows; the row container
  // gains `overflow-(x|y)-auto` so the user can scroll within the
  // pod instead of seeing micro-shrunk cards.
  const isVertical = orientation === 'vertical';

  // Slice 70-K.1 + 70-Z.1 (picture-catalog §2.1 "Card sizing under
  // board complexity") — rows are STATIC rectangles. When card
  // count grows beyond what fits at full size, cards shrink
  // uniformly along the row's MAIN AXIS (width for horizontal,
  // height for vertical). NEVER wrap or grow the row's bounds —
  // that violates the catalog's "rows fixed, cards shrink" contract.
  //
  // Mechanism: flex container in the main-axis direction with no
  // wrap, children with `flex: 1 1 0` + `max-(width|height)`. Slot
  // is forced square via `aspect-square` so the perpendicular
  // dimension follows the main one — both width and height shrink
  // together, preserving the square slot a tap-rotated card needs.
  // `min-w-0` / `min-h-0` on the container lets it respect parent
  // bounds (without it the intrinsic main-axis size of children
  // locks the container to their sum, defeating the shrink).
  return (
    <div
      data-testid="battlefield-row"
      data-row={row}
      data-orientation={orientation}
      className={
        isVertical
          ? 'flex flex-col gap-2 min-h-0 min-w-[16px] h-full items-center overflow-y-auto'
          : 'flex flex-row gap-2 min-w-0 min-h-[16px] justify-center overflow-x-auto'
      }
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
              data-card-id={perm.card.cardId || undefined}
              initial={{ opacity: 0, y: 24, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.85 }}
              transition={slow(BATTLEFIELD_ENTER_EXIT)}
              // Slice 70-X.9 — fixed SQUARE slot at uniform tileSize.
              // No flex-shrink: every tile renders at the same
              // dimensions regardless of pod or card count. Rows
              // overflow + scroll when too many cards (handled by
              // the parent's overflow-(x|y)-auto).
              className="aspect-square flex-shrink-0"
              style={{
                width: tileSize,
                height: tileSize,
              }}
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
