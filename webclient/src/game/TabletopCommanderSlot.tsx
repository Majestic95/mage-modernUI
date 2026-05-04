/**
 * Slice B-12-A — placeholder commander slot for the tabletop variant.
 *
 * <p>Per element #5 of {@code docs/design/variant-tabletop.md}, every
 * pod has a dedicated commander slot at its outside corner:
 * <ul>
 *   <li>TOP opp: right of pod</li>
 *   <li>BOTTOM user: right of pod</li>
 *   <li>LEFT opp: below pod (bottom of vertical column)</li>
 *   <li>RIGHT opp: below pod (bottom of vertical column)</li>
 * </ul>
 *
 * <p>This slice ships the slot as a <b>placeholder only</b> — a small
 * bordered box with the text "Commander". Subsequent slices fill in
 * the live commander-card rendering (when the commander is in the
 * command zone), the click-to-cast affordance, the hover-card-detail
 * popover, and the empty-state label when the commander is on the
 * battlefield.
 *
 * <p>The slot is mounted by Battlefield.tsx as an absolute-positioned
 * sibling inside each pod's cell wrapper (which gets {@code relative}
 * for tabletop). Doesn't displace the colored battlefield zone since
 * it's out of the flow.
 */
import type { WebPlayerView } from '../api/schemas';

export function TabletopCommanderSlot({ player }: { player: WebPlayerView }) {
  return (
    <div
      data-testid="tabletop-commander-slot"
      data-player-id={player.playerId}
      title="Commander"
      className="rounded border-2 border-zinc-600 bg-zinc-900/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 shadow-lg"
    >
      Commander
    </div>
  );
}
