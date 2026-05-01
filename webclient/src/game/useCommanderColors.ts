import { useGameStore } from './store';
import type { WebCardView } from '../api/schemas';

/**
 * Slice 70-Z polish — given a {@link WebCardView}, returns the
 * commander's color identity if the card matches a commander entry
 * in any player's commandList. Used by {@link CardFace} to render
 * a color-identity halo bloom behind the card whenever it appears
 * (battlefield, hand, stack, command zone, return-glide overlay,
 * etc.). User direction 2026-04-30: "the commander card, regardless
 * of where it is, should always have the card glow/bloom effect
 * using the commander's color identity."
 *
 * <p>Match key: the card's printed {@code name} (commandList stores
 * the commander as a {@link WebCommandObjectView}, NOT a
 * WebCardView, so cardId/id space is disjoint; name is the only
 * stable cross-zone discriminator). For mirror-match games (both
 * players play the same legend), the FIRST matching player's color
 * identity wins — fine since both seats have the same identity by
 * definition.
 *
 * <p>Non-reactive: read from the store imperatively. Components that
 * need reactivity should subscribe to {@code gameView} themselves
 * and call this on each render — most card-render sites do exactly
 * that already.
 */
export function commanderColorsForCard(
  card: Pick<WebCardView, 'name'>,
): readonly string[] | null {
  const gv = useGameStore.getState().gameView;
  if (!gv) return null;
  for (const p of gv.players) {
    const match = p.commandList.find(
      (e) => e.kind === 'commander' && e.name === card.name,
    );
    if (match) {
      return p.colorIdentity ?? null;
    }
  }
  return null;
}
