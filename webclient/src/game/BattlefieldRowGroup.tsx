import { AnimatePresence, motion } from 'framer-motion';
import type { WebPermanentView } from '../api/schemas';
import { slow } from '../animation/debug';
import {
  BATTLEFIELD_ENTER_EXIT,
  UNTAP_STAGGER_DELAY_MS,
} from '../animation/transitions';
import { BattlefieldTile } from './BattlefieldTile';
import {
  groupWithAttachmentsAndStacks,
  type StackedGroup,
  type BattlefieldRow,
} from './battlefieldRows';

/** Stable empty Set so the optional prop default doesn't recreate
 *  on every render (would defeat downstream useMemo). */
const EMPTY_ID_SET: Set<string> = new Set();

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
  eligibleTargetIds = EMPTY_ID_SET,
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
  /**
   * Slice 70-Z bug fix — UUIDs the engine reports as legal targets
   * for the active gameTarget dialog. Each tile pulses (via
   * CardFace's existing {@code targetableForDialog} affordance) when
   * its id is in this set. Previously the eligibility was only used
   * to highlight player frames; battlefield permanents got no
   * affordance, which made opponent creatures look unclickable to
   * the user even though the click router accepted them. Optional
   * (defaults to an empty set) so legacy tests don't need to thread
   * the prop explicitly.
   */
  eligibleTargetIds?: Set<string>;
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
  // Param accepted for back-compat but no longer drives sizing.
  void perspective;
  const tileSize = 'calc(var(--card-size-medium) * 7 / 5)';
  // Slice 70-Y / Bug 3 — group attachments under host before render.
  // Pure derivation from the row's perms. Empty attachments arrays
  // for non-host perms don't change render shape vs the legacy
  // flat-row mode.
  const groups = groupWithAttachmentsAndStacks(permanents);
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
        // 2026-05-02 — replace overflow-(x|y)-auto with flex-wrap so
        // rows expand into a second line/column instead of triggering
        // a native scrollbar in the corner of the pod. User direction:
        // "no scroll wheels triggered on one row of cards." The pod's
        // outer flex layout absorbs the extra height/width, sharing
        // the available space with neighboring rows.
        isVertical
          ? 'flex flex-col flex-wrap content-start gap-2 min-h-0 min-w-[16px] h-full items-center'
          : 'flex flex-row flex-wrap content-start gap-2 min-w-0 min-h-[16px] justify-center'
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
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
            rotateDelay={(index * UNTAP_STAGGER_DELAY_MS) / 1000}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Slice 70-Y / Bug 3 (revised 2026-05-01) — render one host + its
 * attachments as a horizontal fan. All cards (host + auras) render at
 * full {@code tileSize}; each successive aura is offset 30% of card
 * width to the right of the previous, and the host's slot expands so
 * neighboring permanents in the same row push aside to make room.
 *
 * <p>Z-order: host on top of stack (dominant face); first aura just
 * behind host; second aura behind first; etc. Each aura's rightmost
 * ~30% strip peeks out from behind the previous card and is fully
 * hoverable / clickable (the higher-z card above absorbs pointer
 * events on the overlapping portion; the visible strip is reachable).
 *
 * <p>Replaces the 2026-05-01 morning's two-mode toggle (stack vs
 * adjacent). User direction: same-size cards, horizontal offset
 * (no diagonal), each attachment readable on hover. Per the
 * playtest 2026-05-01: attachments were "disappearing" because the
 * old stack mode used a tiny diagonal offset behind the host —
 * effectively invisible.
 */
function AttachmentGroupSlot({
  group,
  tileSize,
  canAct,
  onObjectClick,
  eligibleTargetIds = EMPTY_ID_SET,
  eligibleCombatIds,
  combatRoles,
  rotateDelay,
}: {
  group: StackedGroup;
  tileSize: string;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleTargetIds?: Set<string>;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
  rotateDelay: number;
}) {
  const { host, attachments, stackedDuplicates } = group;
  // Slice 70-Y / Issue 1 (2026-05-01) — identical-permanent stacking.
  // stackedDuplicates is non-empty when N copies of the same Forest
  // (or identical token) share the slot. Render them BEHIND host
  // with the same fan offset as auras. Plus a count badge on the
  // front showing the stack depth so the player can read "5 Forests"
  // at a glance.
  const hasAttachments = attachments.length > 0;
  const hasDuplicates = stackedDuplicates.length > 0;
  // Total fan-out count: duplicates + attachments. Both go right of
  // host with 30% offset each. Order: duplicates first (closer to
  // host), then attachments to the far right.
  const fanCount = stackedDuplicates.length + attachments.length;
  const layoutId = host.card.cardId ? host.card.cardId : undefined;
  // Container width grows linearly so siblings in the row's flex
  // layout get pushed aside (no overlap with unrelated permanents).
  // 30% of tileSize per fan layer is enough to clearly reveal the
  // right edge of each card.
  const FAN_OFFSET = 0.3;
  const containerWidth =
    fanCount > 0
      ? `calc(${tileSize} * (1 + ${fanCount} * ${FAN_OFFSET}))`
      : tileSize;
  // Z-base: host on top; each fan layer one z below the previous so
  // each layer's right strip peeks out from under the previous.
  const hostZ = fanCount + 1;
  // Combine duplicates + attachments in render order (duplicates
  // first since they sit closer to host visually).
  const fanLayers = [...stackedDuplicates, ...attachments];
  // Stack count badge — only visible when 2+ identical perms (i.e.
  // duplicates >= 1, total >= 2). "×N" reads the full stack depth.
  const stackCount = stackedDuplicates.length + 1;
  return (
    <motion.div
      key={host.card.id}
      layout
      layoutId={layoutId}
      data-layout-id={layoutId}
      data-card-id={host.card.cardId || undefined}
      data-attachment-host={hasAttachments || undefined}
      data-attachment-count={hasAttachments ? attachments.length : undefined}
      data-stack-count={hasDuplicates ? stackCount : undefined}
      initial={{ opacity: 0, y: 24, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.85 }}
      transition={slow(BATTLEFIELD_ENTER_EXIT)}
      className="relative flex-shrink-0"
      style={{ width: containerWidth, height: tileSize }}
    >
      {/* Host: absolute-positioned at left:0 with the highest z so the
          duplicates / auras stack behind. */}
      <div
        className="absolute top-0 left-0"
        style={{ width: tileSize, height: tileSize, zIndex: hostZ }}
      >
        <BattlefieldTile
          perm={host}
          canAct={canAct}
          onClick={onObjectClick}
          targetableForDialog={eligibleTargetIds.has(host.card.id)}
          isEligibleCombat={eligibleCombatIds.has(host.card.id)}
          combatRole={combatRoles.get(host.card.id) ?? null}
          rotateDelay={rotateDelay}
        />
        {hasDuplicates && (
          <span
            data-testid="stack-count-badge"
            aria-label={`${stackCount} copies`}
            className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded-full bg-zinc-900/85 border border-zinc-600 text-[11px] font-mono font-semibold text-zinc-100 pointer-events-none shadow"
          >
            ×{stackCount}
          </span>
        )}
      </div>
      {fanLayers.map((perm, idx) => (
        <div
          key={perm.card.id}
          data-attachment-of={
            idx >= stackedDuplicates.length ? host.card.id : undefined
          }
          data-stacked-with={
            idx < stackedDuplicates.length ? host.card.id : undefined
          }
          data-card-id={perm.card.cardId || undefined}
          className="absolute top-0"
          style={{
            // (idx+1) so first layer offsets 30% right of host (not
            // overlapping flush). Each subsequent layer another 30%.
            left: `calc(${tileSize} * ${FAN_OFFSET} * ${idx + 1})`,
            width: tileSize,
            height: tileSize,
            // Behind host with descending z so each layer's right
            // strip peeks out.
            zIndex: hostZ - 1 - idx,
          }}
        >
          <BattlefieldTile
            perm={perm}
            canAct={canAct}
            onClick={onObjectClick}
            targetableForDialog={eligibleTargetIds.has(perm.card.id)}
            isEligibleCombat={eligibleCombatIds.has(perm.card.id)}
            combatRole={combatRoles.get(perm.card.id) ?? null}
            rotateDelay={rotateDelay}
          />
        </div>
      ))}
    </motion.div>
  );
}
