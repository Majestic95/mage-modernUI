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
  // Slot max-size: 112 for self (medium card), 100 for opponent
  // (small card). The slot is always square (aspect-square on the
  // motion.div below), so the same max applies to width AND height.
  const tileMaxSize = perspective === 'opponent' ? '100px' : '112px';
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
          ? 'flex flex-col gap-2 min-h-0 min-w-[16px] h-full items-center'
          : 'flex flex-row gap-2 min-w-0 min-h-[16px] justify-center'
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
              initial={{ opacity: 0, y: 24, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.85 }}
              transition={slow(BATTLEFIELD_ENTER_EXIT)}
              // Slice 70-K.1 + 70-Z.1 — flex-shrink-able SQUARE slot.
              // `aspect-square` forces width:height = 1:1 so the slot
              // shrinks uniformly in both dimensions when the main
              // axis tightens. flex: 1 1 0 distributes available main-
              // axis space equally; min-(width|height): 0 lets the
              // child shrink below its intrinsic content size.
              className="aspect-square"
              style={
                isVertical
                  ? { flex: '1 1 0', minHeight: 0, maxHeight: tileMaxSize }
                  : { flex: '1 1 0', minWidth: 0, maxWidth: tileMaxSize }
              }
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
