import { createContext, createElement, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { WebCardView, WebGameView } from '../api/schemas';

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
 * <p>Slice 70-X.13 — was a non-reactive {@code useGameStore.getState()}
 * read from each CardFace render. That had two problems: (1) staleness
 * — the halo could flicker stale when CardFace re-rendered for a
 * non-snapshot reason (animation key, hover, damage flash) and the
 * commandList had moved on; (2) per-card commandList scan, ~80 array
 * walks per snapshot in 4-player Commander. The lookup is now built
 * once at GameTable level into a {@link Map} (name → colorIdentity)
 * and propagated via React context, so every CardFace's read is
 * O(1) and reactive to the same gameView snapshot the rest of the
 * tree is rendering against.
 */

const EMPTY_LOOKUP: ReadonlyMap<string, readonly string[]> = new Map();

const CommanderColorsContext =
  createContext<ReadonlyMap<string, readonly string[]>>(EMPTY_LOOKUP);

interface ProviderProps {
  gameView: WebGameView | null;
  children: ReactNode;
}

export function CommanderColorsProvider({ gameView, children }: ProviderProps) {
  const lookup = useMemo<ReadonlyMap<string, readonly string[]>>(() => {
    if (!gameView) return EMPTY_LOOKUP;
    const map = new Map<string, readonly string[]>();
    for (const p of gameView.players) {
      for (const entry of p.commandList) {
        if (entry.kind === 'commander' && entry.name && !map.has(entry.name)) {
          map.set(entry.name, p.colorIdentity ?? []);
        }
      }
    }
    return map;
  }, [gameView]);
  return createElement(
    CommanderColorsContext.Provider,
    { value: lookup },
    children,
  );
}

/**
 * Reactive hook — returns the commander color identity for a card by
 * name, or {@code null} when the card isn't a commander in any
 * player's commandList. Reads from the {@link CommanderColorsContext}
 * provided by {@link GameTable}; outside the provider returns null
 * (test fixtures that don't mount GameTable simply see no halo, the
 * pre-slice-70-Z behavior).
 */
export function useCommanderColorsForCard(
  card: Pick<WebCardView, 'name'>,
): readonly string[] | null {
  const lookup = useContext(CommanderColorsContext);
  if (!card.name) return null;
  return lookup.get(card.name) ?? null;
}
