import type { WebGameView } from '../api/schemas';
import { isCommanderEntry } from './commanderPredicates';

/**
 * Slice 70-O (picture-catalog §1.2) — derives the header lobby-name
 * string from the game view. Format:
 * <ul>
 *   <li>4 players + commander → "COMMANDER — 4 PLAYER FREE-FOR-ALL"</li>
 *   <li>3 players + commander → "COMMANDER — 3 PLAYER FREE-FOR-ALL"</li>
 *   <li>2 players + commander → "COMMANDER — 1V1"</li>
 *   <li>Non-commander → drops the "COMMANDER —" prefix</li>
 * </ul>
 *
 * <p>Commander detection is "any player has a commandList entry of
 * kind === 'commander'". Empty / null gameView returns a safe
 * fallback string so the header doesn't render bare.
 *
 * <p>Lives in its own module so {@link GameHeader} can stay
 * react-refresh-clean (only-export-components).
 */
export function synthesizeLobbyName(gameView: WebGameView | null): string {
  if (!gameView) return 'GAME';
  const playerCount = gameView.players.length;
  // Slice 70-O Tech critic I-7 — defensive for the empty-players
  // edge case (malformed fixture, between-games clear that doesn't
  // null gameView). "0 PLAYER FREE-FOR-ALL" would be nonsensical.
  if (playerCount === 0) return 'GAME';
  const isCommander = gameView.players.some((p) =>
    p.commandList.some(isCommanderEntry),
  );

  const formatTail =
    playerCount === 2 ? '1V1' : `${playerCount} PLAYER FREE-FOR-ALL`;

  return isCommander ? `COMMANDER — ${formatTail}` : formatTail;
}
