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
  canAct,
  onObjectClick,
  eligibleCombatIds,
  combatRoles,
}: {
  row: BattlefieldRow;
  permanents: WebPermanentView[];
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  return (
    <div
      data-testid="battlefield-row"
      data-row={row}
      className="flex flex-wrap gap-2 min-h-[16px]"
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
