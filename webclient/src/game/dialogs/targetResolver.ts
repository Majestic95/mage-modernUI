import type { WebGameView } from '../../api/schemas';

export interface ResolvedTarget {
  id: string;
  label: string;
  subtitle: string;
}

/**
 * Resolve a target UUID to a friendly display tuple by walking every
 * place in the game view where the engine might be referencing.
 * Falls back to a short-id stub so the modal always has *something*
 * clickable — better to render an opaque ID than to strand the user
 * with an empty modal and a required pick (e.g. end-of-turn discard).
 */
export function resolveTarget(id: string, gv: WebGameView | null): ResolvedTarget {
  if (gv) {
    const player = gv.players.find((p) => p.playerId === id);
    if (player) {
      return { id, label: 'Player', subtitle: player.name || '<unknown>' };
    }
    const inMyHand = gv.myHand[id];
    if (inMyHand) {
      return { id, label: inMyHand.name, subtitle: inMyHand.typeLine };
    }
    for (const p of gv.players) {
      const onBattlefield = p.battlefield[id];
      if (onBattlefield) {
        return {
          id,
          label: onBattlefield.card.name,
          subtitle: onBattlefield.card.typeLine,
        };
      }
      const graveCard = p.graveyard[id];
      if (graveCard) {
        return { id, label: graveCard.name, subtitle: 'graveyard' };
      }
      const exileCard = p.exile[id];
      if (exileCard) {
        return { id, label: exileCard.name, subtitle: 'exile' };
      }
      const sideboardCard = p.sideboard[id];
      if (sideboardCard) {
        return { id, label: sideboardCard.name, subtitle: 'sideboard' };
      }
    }
  }
  // Last-ditch: short-id stub. Better than an empty modal.
  return { id, label: 'Target', subtitle: id.slice(0, 8) };
}
