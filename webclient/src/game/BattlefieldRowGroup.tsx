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
  canAct,
  onObjectClick,
  eligibleCombatIds,
  combatRoles,
}: {
  row: BattlefieldRow;
  permanents: WebPermanentView[];
  /**
   * Slice 70-K.1 critic IMPORTANT-1 — drives the per-tile max-width.
   * Per picture-catalog §2.A/B/C/D: opponent pods use
   * --card-size-small (72px card → 100px slot), local pod uses
   * --card-size-medium (80px card → 112px slot). Defaults to 'self'
   * for back-compat with the legacy code path; PlayerArea passes
   * the actual perspective.
   */
  perspective?: 'self' | 'opponent';
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  // Slot max-width: 112 for self (medium card), 100 for opponent
  // (small card). The slot is always square (aspect-square in
  // BattlefieldTile), so max-width caps both dimensions. Cards
  // render at slot-width × 5/7 portrait via CardFace's fluid mode.
  const tileMaxWidth = perspective === 'opponent' ? '100px' : '112px';
  // Slice 70-K.1 (picture-catalog §2.1 + design-system §7.1
  // "Card sizing under board complexity") — rows are STATIC
  // rectangles. When card count grows beyond what fits at full
  // size, cards shrink uniformly down to a minimum readable
  // size. Below that, they begin overlapping (slice 70-Z polish
  // adds the negative-margin overlap). NEVER wrap to a second
  // line — that grows the row vertically off-screen and
  // violates the catalog's "rows fixed" contract.
  //
  // Mechanism: flex container with no wrap, children with
  // `flex: 1 1 0` + `max-width: 112px` so they grow to fill
  // available width up to the default tile size, and shrink
  // uniformly when the row is too narrow. `min-w-0` on the
  // container lets it respect parent width (without it the
  // intrinsic width of children locks the container to their
  // sum, defeating the shrink).
  return (
    <div
      data-testid="battlefield-row"
      data-row={row}
      className="flex gap-2 min-w-0 min-h-[16px]"
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
              // Slice 70-K.1 — flex-shrink-able slot. flex: 1 1 0
              // means grow=1 / shrink=1 / basis=0. Each tile takes
              // an equal share of the row's width up to its
              // max-width (set on BattlefieldTile's outer slot,
              // 112px). With many tiles, the per-tile share drops
              // below 112 and tiles shrink uniformly. min-width: 0
              // is necessary because a flex item's default min-width
              // is `auto` (intrinsic content), which prevents the
              // shrink. Without min-width: 0 the child would refuse
              // to go below its intrinsic 112px and force the
              // container to overflow horizontally.
              style={{ flex: '1 1 0', minWidth: 0, maxWidth: tileMaxWidth }}
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
