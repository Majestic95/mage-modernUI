/**
 * Slice B-12-A → B-12-B — commander slot for the tabletop variant.
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
 * <p>B-12-A shipped a placeholder. B-12-B (this slice) wires up live
 * commander art rendering via {@link usePlayerCommanders} + Scryfall.
 * Fall-back ladder: art image (when set+collector resolve) → name
 * text (when no image but commander exists) → "Commander" placeholder
 * (no commander in commandList).
 *
 * <p>Click-to-cast affordance and empty-state label deferred to B-12-C.
 */
import type { WebPlayerView } from '../api/schemas';
import { scryfallCommanderImageUrl } from './scryfall';
import { usePlayerCommanders } from './usePlayerCommanders';
import { filterCommanders } from './commanderPredicates';

export function TabletopCommanderSlot({ player }: { player: WebPlayerView }) {
  // `usePlayerCommanders` returns from snapshot ∪ live commandList —
  // it surfaces the commander even after it leaves the command zone
  // (cast, exiled, etc.) per slice 70-X.14's snapshot fallback.
  // For the slot's empty-vs-on-battlefield distinction we ALSO need
  // the live commandList to know if the commander is *currently* in
  // the command zone (and therefore cast'able from the slot).
  const commanders = usePlayerCommanders(player);
  const commander = commanders[0] ?? null;
  const liveCommanders = filterCommanders(player.commandList);
  const inCommandZone = liveCommanders.length > 0;
  const imageUrl = commander
    ? scryfallCommanderImageUrl(commander, 'art_crop')
    : null;

  // No commander known at all (snapshot empty AND commandList empty)
  // → bright "Commander" placeholder. Pre-game / non-Commander
  // formats / fixture without commandList land here.
  if (!commander) {
    return (
      <div
        data-testid="tabletop-commander-slot"
        data-player-id={player.playerId}
        data-state="empty"
        title="Commander"
        className="rounded border-2 border-zinc-600 bg-zinc-900/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-300 shadow-lg"
      >
        Commander
      </div>
    );
  }

  // Commander known but NOT currently in the command zone (snapshot
  // has it; live commandList doesn't) → on battlefield (or graveyard
  // / exile / library — anywhere except command zone). Per element #5
  // spec, render a faint "Commander" label so the slot keeps its
  // visual presence but signals nothing-to-cast-from-here.
  if (!inCommandZone) {
    return (
      <div
        data-testid="tabletop-commander-slot"
        data-player-id={player.playerId}
        data-state="on-battlefield"
        title={`${commander.name} (not in command zone)`}
        className="rounded border-2 border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500 shadow-md"
      >
        Commander
      </div>
    );
  }

  // Commander known but no resolvable image → name text fallback.
  if (!imageUrl) {
    return (
      <div
        data-testid="tabletop-commander-slot"
        data-player-id={player.playerId}
        data-state="name-only"
        title={commander.name}
        className="rounded border-2 border-zinc-600 bg-zinc-900/80 px-3 py-2 max-w-[140px] text-[11px] font-semibold text-zinc-200 shadow-lg"
      >
        {commander.name}
      </div>
    );
  }

  // Full art treatment — small rounded card thumbnail with the
  // commander's art_crop. Card-aspect-ratio container (~5:7).
  return (
    <div
      data-testid="tabletop-commander-slot"
      data-player-id={player.playerId}
      data-state="art"
      title={commander.name}
      className="rounded-md border-2 border-zinc-600 bg-zinc-900 shadow-lg overflow-hidden"
      style={{ width: '90px', height: '64px' }}
    >
      <img
        src={imageUrl}
        alt={commander.name}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}
