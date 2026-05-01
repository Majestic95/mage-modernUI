import { AnimatePresence, motion } from 'framer-motion';
import type { WebPermanentView } from '../api/schemas';
import { slow } from '../animation/debug';
import {
  BATTLEFIELD_ENTER_EXIT,
  UNTAP_STAGGER_DELAY_MS,
} from '../animation/transitions';
import { BattlefieldTile } from './BattlefieldTile';
import {
  groupWithAttachments,
  type AttachmentGroup,
  type BattlefieldRow,
} from './battlefieldRows';
import { useUIPrefs } from './useUIPrefs';

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
  // Slice 70-Y / Bug 3 — group attachments under host before render.
  // Pure derivation from the row's perms. Empty attachments arrays
  // for non-host perms don't change render shape vs the legacy
  // flat-row mode.
  const groups = groupWithAttachments(permanents);
  const auraDisplayMode = useUIPrefs((s) => s.auraDisplayMode);
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
        {groups.map((group, index) => (
          <AttachmentGroupSlot
            key={group.host.card.id}
            group={group}
            tileSize={tileSize}
            canAct={canAct}
            onObjectClick={onObjectClick}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
            rotateDelay={(index * UNTAP_STAGGER_DELAY_MS) / 1000}
            mode={auraDisplayMode}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Slice 70-Y / Bug 3 — render one host + its attachments. Two visual
 * modes per the user-controlled {@code auraDisplayMode} preference:
 *
 * <ul>
 *   <li><b>'stack'</b> — attachments rendered SMALLER (60% scale),
 *     overlapping the host with a slight offset. Host face stays
 *     dominant. Attachment count visible as the stack depth.</li>
 *   <li><b>'adjacent'</b> — attachments rendered as smaller cards
 *     immediately next to the host. Each attachment fully visible.</li>
 * </ul>
 */
function AttachmentGroupSlot({
  group,
  tileSize,
  canAct,
  onObjectClick,
  eligibleCombatIds,
  combatRoles,
  rotateDelay,
  mode,
}: {
  group: AttachmentGroup;
  tileSize: string;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
  rotateDelay: number;
  mode: 'stack' | 'adjacent';
}) {
  const { host, attachments } = group;
  const hasAttachments = attachments.length > 0;
  const layoutId = host.card.cardId ? host.card.cardId : undefined;
  // Stacked mode: container is host-sized (offset auras absolute-position
  // behind the host). Adjacent mode: container is wider so auras fit
  // beside the host without clipping.
  const containerStyle =
    mode === 'adjacent' && hasAttachments
      ? {
          width: `calc(${tileSize} * (1 + ${attachments.length} * 0.5))`,
          height: tileSize,
        }
      : { width: tileSize, height: tileSize };
  return (
    <motion.div
      key={host.card.id}
      layout
      layoutId={layoutId}
      data-layout-id={layoutId}
      data-card-id={host.card.cardId || undefined}
      data-attachment-host={hasAttachments || undefined}
      data-attachment-mode={hasAttachments ? mode : undefined}
      data-attachment-count={hasAttachments ? attachments.length : undefined}
      initial={{ opacity: 0, y: 24, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.85 }}
      transition={slow(BATTLEFIELD_ENTER_EXIT)}
      className="relative flex-shrink-0 flex items-center"
      style={containerStyle}
    >
      {/* Host tile fills its slot. Adjacent mode: host occupies the
          left of the wider container. Stacked mode: host fills the
          container; auras position absolute behind it. */}
      <div
        className="flex-shrink-0"
        style={{ width: tileSize, height: tileSize }}
      >
        <BattlefieldTile
          perm={host}
          canAct={canAct}
          onClick={onObjectClick}
          isEligibleCombat={eligibleCombatIds.has(host.card.id)}
          combatRole={combatRoles.get(host.card.id) ?? null}
          rotateDelay={rotateDelay}
        />
      </div>
      {hasAttachments && mode === 'adjacent' && (
        <div className="flex flex-row gap-1 ml-1 items-center">
          {attachments.map((att) => (
            <div
              key={att.card.id}
              data-attachment-of={host.card.id}
              data-card-id={att.card.cardId || undefined}
              className="flex-shrink-0"
              style={{
                width: `calc(${tileSize} * 0.5)`,
                height: `calc(${tileSize} * 0.7)`,
              }}
            >
              <BattlefieldTile
                perm={att}
                canAct={canAct}
                onClick={onObjectClick}
                isEligibleCombat={eligibleCombatIds.has(att.card.id)}
                combatRole={combatRoles.get(att.card.id) ?? null}
                rotateDelay={rotateDelay}
              />
            </div>
          ))}
        </div>
      )}
      {hasAttachments && mode === 'stack' && (
        <div className="absolute inset-0 pointer-events-none">
          {attachments.map((att, idx) => (
            <div
              key={att.card.id}
              data-attachment-of={host.card.id}
              data-card-id={att.card.cardId || undefined}
              // Stack auras BEHIND host (lower z) with a small offset
              // per layer so each is slightly visible at the edges.
              // pointer-events-auto on inner tile so click-routing
              // still works on the attachment itself (e.g. to
              // unattach via activated ability or click-to-target).
              className="absolute pointer-events-auto"
              style={{
                width: `calc(${tileSize} * 0.7)`,
                height: `calc(${tileSize} * 0.7)`,
                top: `calc(${tileSize} * ${0.05 + idx * 0.04})`,
                left: `calc(${tileSize} * ${0.05 + idx * 0.04})`,
                zIndex: -1 - idx,
              }}
            >
              <BattlefieldTile
                perm={att}
                canAct={canAct}
                onClick={onObjectClick}
                isEligibleCombat={eligibleCombatIds.has(att.card.id)}
                combatRole={combatRoles.get(att.card.id) ?? null}
                rotateDelay={rotateDelay}
              />
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
